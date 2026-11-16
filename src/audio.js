export const ASR_SAMPLE_RATE = 16000;
export const DEFAULT_TTS_PCM_SAMPLE_RATE = 48000;

function writeAscii(view, offset, value) {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

export function floatSamplesToWav(samples, sampleRate = ASR_SAMPLE_RATE) {
  const input = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
  const buffer = new ArrayBuffer(44 + input.length * 2);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + input.length * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, input.length * 2, true);

  let offset = 44;
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function joinFloat32Samples(chunks = []) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function pcmBytesToWavBlob(chunks = [], sampleRate = DEFAULT_TTS_PCM_SAMPLE_RATE) {
  const bytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const frameBytes = Math.floor(bytes / 2) * 2;
  const pcm = new Uint8Array(frameBytes);
  let copied = 0;
  for (const chunk of chunks) {
    const source = new Uint8Array(chunk);
    const length = Math.min(source.length, frameBytes - copied);
    if (length > 0) {
      pcm.set(source.subarray(0, length), copied);
      copied += length;
    }
    if (copied >= frameBytes) break;
  }

  const buffer = new ArrayBuffer(44 + frameBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + frameBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, frameBytes, true);

  new Uint8Array(buffer, 44).set(pcm);
  return new Blob([buffer], { type: 'audio/wav' });
}

export class MicrophoneRecorder {
  constructor({ sampleRate = ASR_SAMPLE_RATE, onDuration } = {}) {
    this.sampleRate = sampleRate;
    this.onDuration = onDuration;
    this.recording = false;
    this._stream = null;
    this._context = null;
    this._source = null;
    this._processor = null;
    this._mute = null;
    this._chunks = [];
    this._samples = 0;
    this._lastDurationReported = -1;
  }

  get duration() {
    return this._samples / this.sampleRate;
  }

  async start() {
    if (this.recording) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone permission API is unavailable');
    }

    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio API is unavailable');
    this._context = new AudioContextClass({ sampleRate: this.sampleRate });
    await this._context.resume?.();
    this._source = this._context.createMediaStreamSource(this._stream);
    this._processor = this._context.createScriptProcessor(4096, 1, 1);
    this._mute = this._context.createGain();
    this._mute.gain.value = 0;

    this._processor.onaudioprocess = (event) => {
      if (!this.recording) return;
      const input = event.inputBuffer.getChannelData(0);
      // ScriptProcessor reuses its internal buffer; copy before queueing.
      this._chunks.push(input.slice());
      this._samples += input.length;
      const duration = this.duration;
      if (this.onDuration && Math.floor(duration * 2) !== this._lastDurationReported) {
        this._lastDurationReported = Math.floor(duration * 2);
        this.onDuration(duration);
      }
    };

    this._source.connect(this._processor);
    this._processor.connect(this._mute);
    this._mute.connect(this._context.destination);
    this.recording = true;
  }

  async stop({ discard = false } = {}) {
    if (!this.recording) return null;
    this.recording = false;

    const samples = discard ? null : joinFloat32Samples(this._chunks);
    this._release();

    if (discard || !samples?.length) return null;
    const blob = floatSamplesToWav(samples, this.sampleRate);
    return new File([blob], `microphone-${Date.now()}.wav`, {
      type: 'audio/wav',
      lastModified: Date.now(),
    });
  }

  _release() {
    try { this._processor && (this._processor.onaudioprocess = null); } catch {}
    try { this._source?.disconnect(); } catch {}
    try { this._processor?.disconnect(); } catch {}
    try { this._mute?.disconnect(); } catch {}
    try { this._context?.close(); } catch {}
    this._stream?.getTracks?.().forEach(track => track.stop());
    this._stream = null;
    this._context = null;
    this._source = null;
    this._processor = null;
    this._mute = null;
    this._chunks = [];
    this._samples = 0;
  }
}

export class PcmStreamPlayer {
  constructor(sampleRate = DEFAULT_TTS_PCM_SAMPLE_RATE) {
    this.sampleRate = sampleRate;
    this.context = null;
    this._nextTime = 0;
    this._sources = new Set();
    this.bytes = 0;
  }

  async start() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio API is unavailable');
    this.context = new AudioContextClass();
    await this.context.resume?.();
    this._nextTime = this.context.currentTime + 0.04;
  }

  push(buffer) {
    if (!this.context) throw new Error('PCM player has not started');
    const byteLength = Math.floor(buffer.byteLength / 2) * 2;
    if (!byteLength) return;

    const input = new Uint8Array(buffer, 0, byteLength);
    const samples = new Float32Array(byteLength / 2);
    const view = new DataView(input.buffer, input.byteOffset, byteLength);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = view.getInt16(i * 2, true) / 32768;
    }

    const audioBuffer = this.context.createBuffer(1, samples.length, this.sampleRate);
    audioBuffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.context.destination);
    const when = Math.max(this._nextTime, this.context.currentTime + 0.015);
    source.start(when);
    this._nextTime = when + audioBuffer.duration;
    this.bytes += byteLength;
    this._sources.add(source);
    source.onended = () => this._sources.delete(source);
  }

  get duration() {
    return this.bytes / 2 / this.sampleRate;
  }

  async finish() {
    if (!this.context) return;
    const waitMs = Math.max(0, (this._nextTime - this.context.currentTime) * 1000 + 80);
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
    await this.stop();
  }

  async stop() {
    for (const source of this._sources) {
      try { source.stop(); } catch {}
    }
    this._sources.clear();
    await this.context?.close?.();
    this.context = null;
    this._nextTime = 0;
  }
}
