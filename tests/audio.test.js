import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MicrophoneRecorder,
  PcmStreamPlayer,
  floatSamplesToWav,
  pcmBytesToWavBlob,
} from '../src/audio.js';
import { parsePcmSampleRate, streamSpeech } from '../src/api.js';
import { InputBar } from '../src/components/input-bar.js';
import { App } from '../src/components/app.js';
import { store } from '../src/store.js';

afterEach(() => {
  document.body.innerHTML = '';
  delete window.AudioContext;
  delete navigator.mediaDevices;
  vi.restoreAllMocks();
});

function makeHeaderMap(headers = {}) {
  return {
    get: (name) => headers[name.toLowerCase()] ?? headers[name] ?? null,
  };
}

function streamResponse(chunks, headers = {}) {
  let index = 0;
  const reader = {
    read: vi.fn(async () => (
      index >= chunks.length
        ? { done: true }
        : { done: false, value: chunks[index++] }
    )),
    releaseLock: vi.fn(),
  };
  return {
    ok: true,
    headers: makeHeaderMap(headers),
    body: { getReader: () => reader },
  };
}

describe('WAV helpers', () => {
  it('encodes mono 16-bit float samples', async () => {
    const blob = floatSamplesToWav(new Float32Array([0, 1, -1]), 16000);
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    expect(blob.type).toBe('audio/wav');
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
  });

  it('combines PCM chunks into a WAV replay blob', async () => {
    const blob = pcmBytesToWavBlob([
      new Uint8Array([0x01, 0x00, 0xff]),
      new Uint8Array([0x7f, 0x00, 0x80]),
    ], 48000);
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.byteLength).toBe(50);
    expect(view.getUint16(44, true)).toBe(1);
    expect(view.getUint16(46, true)).toBe(32767);
    expect(view.getUint16(48, true)).toBe(32768);
    expect(view.getInt16(48, true)).toBe(-32768);
  });
});

describe('microphone recorder', () => {
  it('records Web Audio input into a 16 kHz WAV File', async () => {
    class FakeGain {
      constructor() { this.gain = { value: 1 }; }
      connect() {}
      disconnect() {}
    }
    class FakeNode {
      connect() {}
      disconnect() {}
    }
    class FakeContext {
      constructor({ sampleRate }) {
        this.sampleRate = sampleRate;
        this.destination = {};
      }
      async resume() {}
      createMediaStreamSource() { return new FakeNode(); }
      createScriptProcessor() { return new FakeNode(); }
      createGain() { return new FakeGain(); }
      async close() {}
    }
    const stop = vi.fn();
    navigator.mediaDevices = { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) };
    window.AudioContext = FakeContext;

    const recorder = new MicrophoneRecorder();
    await recorder.start();
    expect(recorder.recording).toBe(true);

    recorder._processor.onaudioprocess({
      inputBuffer: { getChannelData: () => new Float32Array([0, 0.5, -0.5]) },
    });
    const file = await recorder.stop();

    expect(file.name).toMatch(/^microphone-\d+\.wav$/);
    expect(file.type).toBe('audio/wav');
    expect(file.size).toBe(50);
    expect(stop).toHaveBeenCalled();
  });

  it('shows a microphone control and stores the stopped recording as pending audio', async () => {
    store.saveModelCapabilities('http://a.local', {
      'asr-model': { text: true, image: false, audio: true, imageGen: false, tts: false },
    });
    store.saveEndpoints([{ id: 'local', name: 'Local', baseUrl: 'http://a.local', apiKey: '' }]);
    store.saveAvailableModels('http://a.local', ['asr-model']);
    store.setCurrentModel('http://a.local', 'asr-model');

    const bar = new InputBar();
    document.body.appendChild(bar.render());
    bar.setModel('asr-model');
    const button = bar.el.querySelector('#record-audio-btn');
    expect(button.disabled).toBe(false);

    const file = new File([new ArrayBuffer(10)], 'mic.wav', { type: 'audio/wav' });
    bar._recorder = {
      recording: true,
      duration: 1.25,
      stop: vi.fn(async () => file),
    };
    button.click();
    await vi.waitFor(() => expect(bar._pendingAudio).toEqual({ file, source: 'microphone' }));

    expect(bar._pendingAudio).toEqual({ file, source: 'microphone' });
    expect(bar.el.querySelector('#audio-file-name').textContent).toBe('mic.wav');
    expect(bar.el.querySelector('#audio-mode-label').textContent).toContain('Recorded 00:01');
  });
});

describe('streaming speech', () => {
  it('parses sample-rate metadata', () => {
    expect(parsePcmSampleRate(makeHeaderMap({ 'x-sample-rate': '24000' }))).toBe(24000);
    expect(parsePcmSampleRate(makeHeaderMap({ 'content-type': 'audio/pcm;rate=16000' }))).toBe(16000);
    expect(parsePcmSampleRate(makeHeaderMap({}), 44100)).toBe(44100);
  });

  it('requests raw PCM with stream enabled and yields network chunks', async () => {
    const chunks = [new Uint8Array([1, 0]), new Uint8Array([2, 0])];
    globalThis.fetch = vi.fn(async () => streamResponse(chunks, { 'content-type': 'audio/pcm;rate=48000' }));
    const received = [];
    const responseMeta = [];

    for await (const chunk of streamSpeech('http://a.local', '', 'voxcpm2', 'hello', {
      onResponse: responseMeta.push.bind(responseMeta),
    })) {
      received.push(chunk);
    }

    expect(globalThis.fetch.mock.calls[0][1].body).toContain('"response_format":"pcm"');
    expect(globalThis.fetch.mock.calls[0][1].body).toContain('"stream":true');
    expect(responseMeta).toEqual([{ contentType: 'audio/pcm;rate=48000', sampleRate: 48000 }]);
    expect(received.map(chunk => Array.from(chunk))).toEqual([[1, 0], [2, 0]]);
  });

  it('plays PCM chunks and returns replayable WAV metrics', async () => {
    class FakeBufferSource {
      constructor() { this.buffer = null; }
      connect() {}
      start() {}
      stop() {}
    }
    class FakeContext {
      constructor() {
        this.currentTime = 0;
        this.destination = {};
      }
      async resume() {}
      createBuffer(channels, length, sampleRate) {
        return {
          duration: length / sampleRate,
          copyToChannel: vi.fn(),
        };
      }
      createBufferSource() { return new FakeBufferSource(); }
      async close() {}
    }
    window.AudioContext = FakeContext;
    globalThis.fetch = vi.fn(async () => streamResponse([
      new Uint8Array([0, 0, 0x80, 0x7f]),
      new Uint8Array([0xff, 0x7f]),
    ], { 'content-type': 'audio/pcm;rate=48000' }));

    const app = new App(document.createElement('div'));
    const result = await app._generateSpeechResult({
      cfg: { baseUrl: 'http://a.local', apiKey: '' },
      model: 'voxcpm2',
      text: '你好',
      seed: 1,
      signal: undefined,
      settings: { streamTTS: true },
    });

    expect(result.contentType).toBe('audio/wav');
    expect(result.blob.size).toBe(50);
    expect(result.metrics.streamed).toBe(true);
    expect(result.metrics.firstAudioMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.audioSeconds).toBe(0.0001);
    expect(result.metrics.sampleRate).toBe(48000);
  });
});
