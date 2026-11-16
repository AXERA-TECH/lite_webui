const DEV_PROXY_BASE = '/lw-proxy';
const NON_ASCII_TOKEN_ESTIMATE = 1;
const ASCII_CHARS_PER_TOKEN = 4;
const IMAGE_MESSAGE_TOKEN_ESTIMATE = 256;

/**
 * Builds the fetch URL and headers for a given API call.
 * In dev mode: routes through the Vite CORS proxy (/lw-proxy) using X-LW-Target.
 * In prod mode: calls the baseUrl directly (server must have CORS configured).
 *
 * Exported for unit testing with an explicit isDev parameter.
 */
export function buildRequestConfig(baseUrl, apiKey, isDev = import.meta.env.DEV, options = {}) {
  const cleanBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  const { contentType = 'application/json' } = options;
  const headers = {};
  if (contentType) headers['Content-Type'] = contentType;
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  if (isDev) {
    headers['X-LW-Target'] = cleanBase;
    return { urlBase: DEV_PROXY_BASE, headers };
  }
  return { urlBase: cleanBase, headers };
}

export async function fetchModels(baseUrl, apiKey) {
  const { urlBase, headers } = buildRequestConfig(baseUrl, apiKey);
  const url = `${urlBase}/v1/models`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch models (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  // OpenAI returns { data: [{ id, ... }] }
  const list = data.data || data.models || data;
  return Array.isArray(list) ? list.map(m => (typeof m === 'string' ? m : m.id)).filter(Boolean).sort() : [];
}

export async function checkEndpointHealth(baseUrl, apiKey) {
  const startedAt = performance.now();
  try {
    const models = await fetchModels(baseUrl, apiKey);
    return {
      ok: true,
      baseUrl,
      latencyMs: Math.round(performance.now() - startedAt),
      models,
      error: '',
    };
  } catch (err) {
    return {
      ok: false,
      baseUrl,
      latencyMs: Math.round(performance.now() - startedAt),
      models: [],
      error: err?.message || String(err),
    };
  }
}

function extractAudioText(payload) {
  if (typeof payload === 'string') return payload.trim();
  if (typeof payload?.text === 'string') return payload.text.trim();
  if (typeof payload?.transcript === 'string') return payload.transcript.trim();
  if (typeof payload?.output_text === 'string') return payload.output_text.trim();
  if (Array.isArray(payload?.segments)) {
    return payload.segments
      .map((segment) => String(segment?.text || '').trim())
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  return '';
}

async function submitAudioTextRequest(baseUrl, apiKey, model, file, endpoint, options = {}) {
  const { prompt = '', language = '', signal } = options;
  const { urlBase, headers } = buildRequestConfig(baseUrl, apiKey, import.meta.env.DEV, { contentType: null });
  const url = `${urlBase}${endpoint}`;
  const body = new FormData();

  body.append('file', file, file?.name || 'audio.wav');
  if (model) body.append('model', model);
  if (prompt) body.append('prompt', prompt);
  if (language) body.append('language', language);
  body.append('response_format', 'json');

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let errMsg = `API error (${res.status})`;
    try {
      const json = JSON.parse(text);
      errMsg = json.error?.message || errMsg;
    } catch {
      if (text) errMsg += ': ' + text.slice(0, 200);
    }
    throw new Error(errMsg);
  }

  const payload = await res.json().catch(async () => {
    const text = await res.text().catch(() => '');
    return { text };
  });
  const text = extractAudioText(payload);
  if (!text) throw new Error('Audio API returned an empty text result');
  return text;
}

export async function transcribeAudio(baseUrl, apiKey, model, file, options = {}) {
  return submitAudioTextRequest(baseUrl, apiKey, model, file, '/v1/audio/transcriptions', options);
}

export function estimateTextTokens(text) {
  const value = String(text || '');
  let asciiChars = 0;
  let nonAsciiTokens = 0;

  for (const char of value) {
    if (/\s/.test(char)) continue;
    if (char.charCodeAt(0) <= 0x7f) {
      asciiChars += 1;
    } else {
      nonAsciiTokens += NON_ASCII_TOKEN_ESTIMATE;
    }
  }

  return nonAsciiTokens + Math.ceil(asciiChars / ASCII_CHARS_PER_TOKEN);
}

function estimateContentTokens(content) {
  if (typeof content === 'string') return estimateTextTokens(content);
  if (!Array.isArray(content)) return 0;

  return content.reduce((total, part) => {
    if (part?.type === 'text') return total + estimateTextTokens(part.text);
    if (part?.type === 'image_url') return total + IMAGE_MESSAGE_TOKEN_ESTIMATE;
    if (part?.type === 'video_url') return total + IMAGE_MESSAGE_TOKEN_ESTIMATE * 8; // rough: ~8 keyframes
    return total;
  }, 0);
}

export function estimateMessageTokens(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;

  return messages.reduce((total, message) => {
    return total + 4 + (
      typeof message.apiContent === 'string'
        ? estimateTextTokens(message.apiContent)
        : estimateContentTokens(message.content)
    );
  }, 2);
}

export function formatCompactTokenCount(tokens) {
  const safe = Math.max(0, Math.round(Number(tokens) || 0));

  if (safe < 1000) return String(safe);
  if (safe < 100000) return `${(safe / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(safe / 1000)}k`;
}

function pickFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

/**
 * Extracts server-reported performance metrics from a streaming `usage` object.
 *
 * This is a display UI: the frontend never estimates these numbers itself. It
 * shows only what the backend reports (see README → Performance Metrics), so the
 * values reflect real server-side inference rather than browser/network timing.
 * Returns null when the backend provided none of the recognised fields.
 *
 * @param {object?} usage  Final `usage` object from the stream, if any.
 */
export function extractServerMetrics(usage) {
  if (!usage || typeof usage !== 'object') return null;

  // llama.cpp reports native timing fields beside `usage` in the final SSE or
  // completion JSON object. Normalize them onto the same metric interface while
  // retaining the explicit fields preferred by AXERA backends.
  const timings = usage.timings && typeof usage.timings === 'object' ? usage.timings : {};
  const tokenDetails = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object'
    ? usage.prompt_tokens_details
    : {};

  const ttftRaw = pickFiniteNumber(
    usage.ttft_ms,
    usage.time_to_first_token_ms,
    timings.prompt_ms,
  );
  const prefillRaw = pickFiniteNumber(
    usage.prefill_tps,
    usage.prefill_tokens_per_second,
    timings.prompt_per_second,
  );
  const decodeRaw = pickFiniteNumber(
    usage.decode_tps,
    usage.tokens_per_second,
    timings.predicted_per_second,
  );
  const inputRaw = pickFiniteNumber(usage.prompt_tokens, usage.input_tokens);
  const outputRaw = pickFiniteNumber(usage.completion_tokens, usage.output_tokens);
  const prefillTokRaw = pickFiniteNumber(
    usage.prefill_tokens,
    usage.prefilled_tokens,
    tokenDetails.cached_tokens != null && inputRaw != null
      ? Math.max(0, inputRaw - tokenDetails.cached_tokens)
      : null,
  );

  // Include only the metrics the backend actually reported. The UI renders one
  // pill per present field and nothing when the object is empty — it never
  // computes or estimates any value itself. A non-positive speed / token count
  // is treated as "not reported" (avoids showing a bogus "0").
  const metrics = {};
  if (ttftRaw != null && ttftRaw >= 0) metrics.ttftMs = ttftRaw;
  if (prefillRaw != null && prefillRaw > 0) metrics.prefillTps = prefillRaw;
  if (decodeRaw != null && decodeRaw > 0) metrics.decodeTps = decodeRaw;
  if (inputRaw != null && inputRaw > 0) metrics.inputTokens = inputRaw;
  // Newly-prefilled token count: 0 is valid (whole prompt served from KV cache),
  // so accept >= 0. The UI shows it only when it is less than the input count.
  if (prefillTokRaw != null && prefillTokRaw >= 0) metrics.prefillTokens = prefillTokRaw;
  if (outputRaw != null && outputRaw > 0) metrics.completionTokens = outputRaw;

  return Object.keys(metrics).length ? metrics : null;
}

/** Formats a time-to-first-token value (ms) for display, e.g. "82 ms" / "1.24 s". */
export function formatTtft(ms) {
  if (ms == null) return '';
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

/** Formats a throughput value (tokens/sec) for display, e.g. "45.6 tok/s" / "220 tok/s". */
export function formatTps(tps) {
  const value = Number(tps);
  if (!Number.isFinite(value) || value <= 0) return '';
  const num = value >= 100 ? String(Math.round(value)) : value.toFixed(1);
  return `${num} tok/s`;
}

export async function* streamCompletion(baseUrl, apiKey, model, messages, options = {}) {
  const {
    onUsage, onMetrics, signal,
    temperature = null, maxTokens = null, topP = null, seed = null,
    idleTimeoutMs = 0, retries = 0,
  } = options;
  const { urlBase, headers } = buildRequestConfig(baseUrl, apiKey);
  const url = `${urlBase}/v1/chat/completions`;

  let serverUsage = null;

  const bodyObj = { model, messages, stream: true, stream_options: { include_usage: true } };
  if (temperature !== null && temperature !== '' && Number.isFinite(Number(temperature))) {
    bodyObj.temperature = Number(temperature);
  }
  if (maxTokens !== null && maxTokens !== '' && Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0) {
    bodyObj.max_tokens = Math.round(Number(maxTokens));
  }
  if (topP !== null && topP !== '' && Number.isFinite(Number(topP))) {
    bodyObj.top_p = Number(topP);
  }
  if (seed !== null && seed !== '' && Number.isFinite(Number(seed))) {
    bodyObj.seed = Math.floor(Number(seed));
  }

  // Internal controller: combines the caller's abort signal with an idle timeout.
  // The idle timer is re-armed on every chunk received, so a long but healthy
  // stream never trips it — only a truly stalled connection does.
  const ctl = new AbortController();
  let idleTimer = null;
  const armIdle = () => {
    if (idleTimeoutMs <= 0) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      ctl.abort(new DOMException('Stream idle timeout', 'TimeoutError'));
    }, idleTimeoutMs);
  };
  const disarmIdle = () => { clearTimeout(idleTimer); idleTimer = null; };
  const onUserAbort = () => ctl.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) ctl.abort(signal.reason);
    else signal.addEventListener('abort', onUserAbort, { once: true });
  }

  // Retry only the initial handshake (before streaming starts). Once the stream
  // begins we cannot safely resume mid-stream.
  let res = null;
  let lastErr = null;
  const attempts = Math.max(0, Math.round(retries)) + 1;
  for (let i = 0; i < attempts; i++) {
    if (ctl.signal.aborted) break;
    try {
      armIdle();
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyObj),
        signal: ctl.signal,
      });
      disarmIdle();
      break;
    } catch (err) {
      disarmIdle();
      lastErr = err;
      if (ctl.signal.aborted || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  if (!res) throw lastErr || new Error('Request failed');

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let errMsg = `API error (${res.status})`;
    try {
      const json = JSON.parse(text);
      errMsg = json.error?.message || errMsg;
    } catch {
      if (text) errMsg += ': ' + text.slice(0, 200);
    }
    throw new Error(errMsg);
  }

  // Non-streaming fallback: some backends ignore stream=true and return a plain
  // JSON object. Handle that instead of crashing on res.body === null.
  if (!res.body) {
    const json = await res.json().catch(() => null);
    if (json) {
      const content = json.choices?.[0]?.message?.content;
      if (content) yield content;
      captureFinalMetrics(json);
    }
    if (onMetrics) {
      const metrics = extractServerMetrics(serverUsage);
      if (metrics) onMetrics(metrics);
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reasoningOpen = false;

  function captureFinalMetrics(json) {
    const usage = json?.usage && typeof json.usage === 'object' ? json.usage : {};
    const timings = json?.timings && typeof json.timings === 'object' ? json.timings : null;
    if (!Object.keys(usage).length && !timings) return;

    // Keep the public `usage` shape, but attach llama.cpp's top-level timings so
    // extractServerMetrics can normalize both AXERA extensions and native fields.
    serverUsage = timings
      ? { ...usage, timings: { ...(usage.timings || {}), ...timings } }
      : usage;
    if (usage.total_tokens != null) onUsage?.(usage);
  }

  // Emit reasoning as an inline <think> block so the existing renderer folds it.
  const emitDelta = (delta) => {
    let out = '';
    if (delta?.reasoning_content) {
      if (!reasoningOpen) { reasoningOpen = true; out += '<think>'; }
      out += delta.reasoning_content;
    }
    if (delta?.content) {
      if (reasoningOpen) { reasoningOpen = false; out += '</think>'; }
      out += delta.content;
    }
    return out;
  };

  try {
    let streamDone = false;
    while (true) {
      armIdle();
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (!trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') { streamDone = true; break; }

        try {
          const json = JSON.parse(data);
          captureFinalMetrics(json);
          const delta = json.choices?.[0]?.delta;
          const text = emitDelta(delta);
          if (text) yield text;
        } catch {
          // ignore malformed SSE lines
        }
      }
      if (streamDone) break;
    }

    // flush any remaining buffer
    if (buffer.trim().startsWith('data: ')) {
      const data = buffer.trim().slice(6);
      if (data && data !== '[DONE]') {
        try {
          const json = JSON.parse(data);
          captureFinalMetrics(json);
          const delta = json.choices?.[0]?.delta;
          const text = emitDelta(delta);
          if (text) yield text;
        } catch { /* ignore */ }
      }
    }
    if (reasoningOpen) yield '</think>';
  } finally {
    disarmIdle();
    if (signal) signal.removeEventListener('abort', onUserAbort);
    // Emit whatever performance metrics the backend reported (normal end, early
    // stop, or abort). The frontend never fabricates these — no server data,
    // no metrics shown.
    if (onMetrics) {
      const metrics = extractServerMetrics(serverUsage);
      if (metrics) onMetrics(metrics);
    }
  }
}

/** Converts a data URL (base64 or plain) to a Blob for FormData uploads. */
async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

export async function generateImage(baseUrl, apiKey, model, prompt, options = {}) {
  const { size = '512x512', responseFormat = 'url', image = null, seed = null, signal } = options;
  // image = { dataUrl, file } when doing img2img, null for txt2img
  // Normalize seed: must be a finite integer; null / empty / NaN → omit from request.
  const seedInt = (seed !== null && seed !== '' && Number.isFinite(Number(seed)))
    ? Math.floor(Number(seed)) : null;

  let endpoint, body, headers;
  if (image?.dataUrl) {
    // img2img: POST /v1/images/edits with multipart FormData
    const { urlBase, headers: h } = buildRequestConfig(baseUrl, apiKey, undefined, { contentType: null });
    const form = new FormData();
    const blob = await dataUrlToBlob(image.dataUrl);
    form.append('image', blob, image.file?.name || 'image.png');
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('response_format', responseFormat);
    if (seedInt !== null) form.append('seed', String(seedInt));
    endpoint = `${urlBase}/v1/images/edits`;
    body = form;
    headers = h;
  } else {
    // txt2img: POST /v1/images/generations with JSON
    const { urlBase, headers: h } = buildRequestConfig(baseUrl, apiKey);
    endpoint = `${urlBase}/v1/images/generations`;
    body = JSON.stringify({
      model, prompt, size, response_format: responseFormat,
      ...(seedInt !== null ? { seed: seedInt } : {}),
    });
    headers = h;
  }

  const res = await fetch(endpoint, { method: 'POST', headers, body, signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let errMsg = `Image generation failed (${res.status})`;
    try {
      const json = JSON.parse(text);
      errMsg = json.error?.message || errMsg;
    } catch {
      if (text) errMsg += ': ' + text.slice(0, 200);
    }
    throw new Error(errMsg);
  }
  const json = await res.json();
  const items = json.data || [];
  const cleanBase = String(baseUrl || '').replace(/\/+$/, '');
  const images = items.map(item => {
    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    const url = item.url || null;
    if (!url) return null;
    // If the backend returns a relative URL, prepend the base URL.
    return url.startsWith('http') ? url : `${cleanBase}${url.startsWith('/') ? '' : '/'}${url}`;
  }).filter(Boolean);
  // Read seed from response (backend may echo it back); fall back to what we sent.
  const responseSeed = items[0]?.seed ?? null;
  const effectiveSeed = responseSeed !== null ? responseSeed : seedInt;
  return { images, seed: effectiveSeed };
}

/**
 * Generates speech through an OpenAI-compatible `/v1/audio/speech` endpoint.
 * Unlike the chat/image helpers, the successful response is binary audio.
 */
export async function generateSpeech(baseUrl, apiKey, model, input, options = {}) {
  const {
    responseFormat = 'wav',
    seed = null,
    signal,
  } = options;

  if (!String(input || '').trim()) {
    throw new Error('Speech text is empty');
  }

  const seedInt = (seed !== null && seed !== '' && Number.isFinite(Number(seed)))
    ? Math.floor(Number(seed)) : null;
  const { urlBase, headers } = buildRequestConfig(baseUrl, apiKey);

  const res = await fetch(`${urlBase}/v1/audio/speech`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      input,
      response_format: responseFormat,
      ...(seedInt !== null ? { seed: seedInt } : {}),
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let errMsg = `Speech generation failed (${res.status})`;
    try {
      const json = JSON.parse(text);
      errMsg = json.error?.message || errMsg;
    } catch {
      if (text) errMsg += ': ' + text.slice(0, 300);
    }
    throw new Error(errMsg);
  }

  const blob = await res.blob();
  if (!blob?.size) {
    throw new Error('Speech API returned an empty audio result');
  }

  return {
    blob,
    contentType: blob.type || `audio/${responseFormat}`,
    seed: seedInt,
  };
}

export function parsePcmSampleRate(headers, fallback = 48000) {
  const explicit = headers?.get?.('x-sample-rate') || headers?.get?.('x-audio-sample-rate');
  if (explicit && Number.isFinite(Number(explicit))) return Math.round(Number(explicit));

  const contentType = String(headers?.get?.('content-type') || '');
  const match = /(?:rate|sample[-_]?rate)\s*=\s*(\d+)/i.exec(contentType);
  if (match && Number.isFinite(Number(match[1]))) return Math.round(Number(match[1]));
  return fallback;
}

/**
 * Opens a raw PCM speech stream. Each yielded value is one binary network
 * chunk, normally little-endian signed 16-bit mono PCM.
 */
export async function* streamSpeech(baseUrl, apiKey, model, input, options = {}) {
  const {
    seed = null,
    signal,
    onResponse,
  } = options;

  if (!String(input || '').trim()) throw new Error('Speech text is empty');
  const seedInt = (seed !== null && seed !== '' && Number.isFinite(Number(seed)))
    ? Math.floor(Number(seed)) : null;
  const { urlBase, headers } = buildRequestConfig(baseUrl, apiKey);
  const res = await fetch(`${urlBase}/v1/audio/speech`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      input,
      response_format: 'pcm',
      stream: true,
      ...(seedInt !== null ? { seed: seedInt } : {}),
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let errMsg = `Speech generation failed (${res.status})`;
    try {
      const json = JSON.parse(text);
      errMsg = json.error?.message || errMsg;
    } catch {
      if (text) errMsg += ': ' + text.slice(0, 300);
    }
    throw new Error(errMsg);
  }

  const contentType = res.headers?.get?.('content-type') || '';
  const sampleRate = parsePcmSampleRate(res.headers, 48000);
  onResponse?.({ contentType, sampleRate });

  if (/json/i.test(contentType)) {
    const text = await res.text().catch(() => '');
    throw new Error(`Speech stream returned JSON instead of PCM: ${text.slice(0, 200)}`);
  }
  if (!res.body) {
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength) yield buffer;
    return;
  }

  const reader = res.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) yield value;
    }
  } finally {
    reader.releaseLock?.();
  }
}

/**
 * Heuristic repetition detector for streamed model output.
 * Returns true when the tail of `text` ends with the same chunk repeated
 * at least `minRepeats` times (classic "复读机" loop).
 */
export function isRepeatingOutput(text, {
  minPeriod = 16,
  maxPeriod = 300,
  minRepeats = 4,
  lookback = 2400,
} = {}) {
  if (!text || text.length < minPeriod * minRepeats) return false;
  const tail = text.slice(-lookback);

  for (let period = minPeriod; period <= maxPeriod; period++) {
    if (period * minRepeats > tail.length) break;
    const seg = tail.slice(-period);
    if (!seg.trim()) continue;
    let repeats = 1;
    while ((repeats + 1) * period <= tail.length &&
           tail.slice(-period * (repeats + 1), -period * repeats) === seg) {
      repeats++;
      if (repeats >= minRepeats) return true;
    }
  }
  return false;
}

export function formatMessagesForApi(messages) {
  // Find the index of the last user message so we can preserve its media dataUrls.
  // Historical video messages are stripped (huge dataUrls, already processed by the model).
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIdx = i; break; }
  }

  return messages.map((msg, i) => {
    if (msg.role === 'assistant') return { role: 'assistant', content: msg.content };

    // Document messages expose a friendly title in the UI and their full text
    // only in apiContent. This keeps the wire format standard text-only.
    if (typeof msg.apiContent === 'string') {
      return { role: 'user', content: msg.apiContent };
    }

    // For the most recent user message keep content verbatim (includes any media dataUrl).
    if (i === lastUserIdx || !Array.isArray(msg.content)) {
      return { role: 'user', content: msg.content };
    }

    // For historical user messages: replace video_url parts with a text note so the
    // API payload stays small and uses only standard content types.
    const nImages = msg.content.filter(part => part?.type === 'image_url').length;
    const content = (nImages > 2
      // many images means sampled video frames: drop them from history to keep payloads small
      ? [{ type: 'text', text: `[Video attachment: ${nImages} frames]` }]
      : msg.content.map(part => {
          if (part?.type === 'video_url') return { type: 'text', text: '[Video attachment]' };
          return part;
        }));
    return { role: 'user', content };
  });
}
