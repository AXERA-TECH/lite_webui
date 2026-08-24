import { describe, it, expect, vi } from 'vitest';
import {
  buildRequestConfig,
  fetchModels,
  streamCompletion,
  transcribeAudio,
  extractServerMetrics,
  formatTtft,
  formatDecodeTps,
} from '../src/api.js';

// ─── buildRequestConfig ──────────────────────────────────────────────────────

describe('buildRequestConfig – dev mode (isDev=true)', () => {
  it('uses /lw-proxy as urlBase', () => {
    const { urlBase } = buildRequestConfig('http://10.168.21.119:8000', '', true);
    expect(urlBase).toBe('/lw-proxy');
  });

  it('sets X-LW-Target header to the cleaned baseUrl', () => {
    const { headers } = buildRequestConfig('http://10.168.21.119:8000/', '', true);
    expect(headers['X-LW-Target']).toBe('http://10.168.21.119:8000');
  });

  it('strips trailing slash from X-LW-Target', () => {
    const { headers } = buildRequestConfig('http://localhost:8000/', '', true);
    expect(headers['X-LW-Target']).toBe('http://localhost:8000');
  });

  it('does NOT add Authorization header when apiKey is empty', () => {
    const { headers } = buildRequestConfig('http://localhost:8000', '', true);
    expect(headers['Authorization']).toBeUndefined();
  });

  it('adds Authorization header when apiKey is provided', () => {
    const { headers } = buildRequestConfig('http://localhost:8000', 'sk-test', true);
    expect(headers['Authorization']).toBe('Bearer sk-test');
  });
});

describe('buildRequestConfig – prod mode (isDev=false)', () => {
  it('uses cleaned baseUrl as urlBase', () => {
    const { urlBase } = buildRequestConfig('http://10.168.21.119:8000/', '', false);
    expect(urlBase).toBe('http://10.168.21.119:8000');
  });

  it('does NOT set X-LW-Target header', () => {
    const { headers } = buildRequestConfig('http://localhost:8000', '', false);
    expect(headers['X-LW-Target']).toBeUndefined();
  });

  it('does NOT add Authorization header when apiKey is empty', () => {
    const { headers } = buildRequestConfig('http://localhost:8000', '', false);
    expect(headers['Authorization']).toBeUndefined();
  });

  it('adds Authorization header when apiKey is provided', () => {
    const { headers } = buildRequestConfig('http://localhost:8000', 'sk-key', false);
    expect(headers['Authorization']).toBe('Bearer sk-key');
  });
});

// ─── fetchModels ──────────────────────────────────────────────────────────────

describe('fetchModels (dev mode via buildRequestConfig isDev=true default in Vitest)', () => {
  it('calls /lw-proxy/v1/models and sets X-LW-Target', async () => {
    const captured = {};
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      captured.url = url;
      captured.headers = opts?.headers ?? {};
      return { ok: true, json: async () => ({ data: [{ id: 'model-a' }] }) };
    }));

    await fetchModels('http://10.168.21.119:8000', '');
    expect(captured.url).toBe('/lw-proxy/v1/models');
    expect(captured.headers['X-LW-Target']).toBe('http://10.168.21.119:8000');
    vi.unstubAllGlobals();
  });

  it('parses OpenAI-style { data: [{id}] } response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'AXERA-TECH/Qwen3-VL-2B-Instruct' }] }),
    })));

    const models = await fetchModels('http://10.168.21.119:8000', '');
    expect(models).toContain('AXERA-TECH/Qwen3-VL-2B-Instruct');
    vi.unstubAllGlobals();
  });

  it('parses flat string-array response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ['model-x', 'model-y'],
    })));

    const models = await fetchModels('http://localhost:8000', '');
    expect(models).toContain('model-x');
    vi.unstubAllGlobals();
  });

  it('does NOT add Authorization header when apiKey is empty', async () => {
    const captured = {};
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      captured.headers = opts?.headers ?? {};
      return { ok: true, json: async () => ({ data: [] }) };
    }));

    await fetchModels('http://localhost:8000', '');
    expect(captured.headers['Authorization']).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('adds Authorization header when apiKey is provided', async () => {
    const captured = {};
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      captured.headers = opts?.headers ?? {};
      return { ok: true, json: async () => ({ data: [] }) };
    }));

    await fetchModels('http://localhost:8000', 'sk-my-key');
    expect(captured.headers['Authorization']).toBe('Bearer sk-my-key');
    vi.unstubAllGlobals();
  });

  it('throws on non-OK HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 500, text: async () => 'Internal error',
    })));

    await expect(fetchModels('http://localhost:8000', '')).rejects.toThrow('500');
    vi.unstubAllGlobals();
  });
});

// ─── streamCompletion ────────────────────────────────────────────────────────

describe('streamCompletion (dev mode)', () => {
  it('calls /lw-proxy/v1/chat/completions and sets X-LW-Target', async () => {
    const captured = {};
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    let idx = 0;
    const reader = {
      read: vi.fn(async () =>
        idx >= sseChunks.length
          ? { done: true }
          : { done: false, value: new TextEncoder().encode(sseChunks[idx++]) }
      ),
    };

    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      captured.url = url;
      captured.headers = opts?.headers ?? {};
      return { ok: true, body: { getReader: () => reader } };
    }));

    const chunks = [];
    for await (const chunk of streamCompletion('http://10.168.21.119:8000', '', 'model', [])) {
      chunks.push(chunk);
    }
    expect(captured.url).toBe('/lw-proxy/v1/chat/completions');
    expect(captured.headers['X-LW-Target']).toBe('http://10.168.21.119:8000');
    expect(chunks).toContain('Hi');
    vi.unstubAllGlobals();
  });
});

describe('audio uploads', () => {
  it('transcribeAudio posts multipart form data to /v1/audio/transcriptions', async () => {
    const captured = {};
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      captured.url = url;
      captured.method = opts?.method;
      captured.headers = opts?.headers ?? {};
      captured.body = opts?.body;
      return { ok: true, json: async () => ({ text: 'hello transcript' }) };
    }));

    const file = new File(['audio'], 'meeting.wav', { type: 'audio/wav' });
    const text = await transcribeAudio('http://localhost:8000', 'sk-key', 'audio-model', file);

    expect(captured.url).toBe('/lw-proxy/v1/audio/transcriptions');
    expect(captured.method).toBe('POST');
    expect(captured.headers['Content-Type']).toBeUndefined();
    expect(captured.headers['Authorization']).toBe('Bearer sk-key');
    expect(captured.body).toBeInstanceOf(FormData);
    expect(captured.body.get('model')).toBe('audio-model');
    expect(captured.body.get('file').name).toBe(file.name);
    expect(captured.body.get('file').type).toBe(file.type);
    expect(text).toBe('hello transcript');
    vi.unstubAllGlobals();
  });
});

// ─── performance metrics (TTFT / decode speed) ────────────────────────────────

describe('extractServerMetrics', () => {
  it('returns null when no usage is provided', () => {
    expect(extractServerMetrics(null)).toBeNull();
    expect(extractServerMetrics({})).toBeNull();
  });

  it('returns null when usage has no recognised metric fields', () => {
    // Standard token counts alone are not performance metrics.
    expect(extractServerMetrics({ prompt_tokens: 10, total_tokens: 20 })).toBeNull();
  });

  it('reads server-reported ttft_ms and decode_tps verbatim', () => {
    const m = extractServerMetrics({ completion_tokens: 512, ttft_ms: 39.96, decode_tps: 36.13 });
    expect(m.ttftMs).toBe(39.96);
    expect(m.decodeTps).toBe(36.13);
    expect(m.completionTokens).toBe(512);
  });

  it('accepts documented field aliases', () => {
    const m = extractServerMetrics({ time_to_first_token_ms: 40, tokens_per_second: 30, output_tokens: 100 });
    expect(m.ttftMs).toBe(40);
    expect(m.decodeTps).toBe(30);
    expect(m.completionTokens).toBe(100);
  });

  it('treats a zero/negative completion_tokens as unreported (no bogus "0 tok")', () => {
    expect(extractServerMetrics({ completion_tokens: 0 })).toBeNull();
    const m = extractServerMetrics({ completion_tokens: 0, ttft_ms: 40 });
    expect(m.ttftMs).toBe(40);
    expect(m.completionTokens).toBeNull();
  });

  it('surfaces partial metrics when only some fields are present', () => {
    const m = extractServerMetrics({ decode_tps: 36.13 });
    expect(m.ttftMs).toBeNull();
    expect(m.decodeTps).toBe(36.13);
    expect(m.completionTokens).toBeNull();
  });

  it('never derives metrics from client timing (that argument no longer exists)', () => {
    // Only the usage object matters — there is no wall-clock fallback anymore.
    expect(extractServerMetrics(undefined)).toBeNull();
  });
});

describe('formatTtft', () => {
  it('formats sub-second values in milliseconds', () => {
    expect(formatTtft(82.4)).toBe('82 ms');
  });
  it('formats values >= 1s in seconds', () => {
    expect(formatTtft(1240)).toBe('1.24 s');
  });
  it('returns empty string for invalid input', () => {
    expect(formatTtft(null)).toBe('');
    expect(formatTtft(-5)).toBe('');
  });
});

describe('formatDecodeTps', () => {
  it('shows one decimal below 100', () => {
    expect(formatDecodeTps(45.62)).toBe('45.6 tok/s');
  });
  it('rounds to integer at or above 100', () => {
    expect(formatDecodeTps(128.7)).toBe('129 tok/s');
  });
  it('returns empty string for invalid input', () => {
    expect(formatDecodeTps(0)).toBe('');
    expect(formatDecodeTps(NaN)).toBe('');
  });
});

describe('streamCompletion – metrics interface', () => {
  it('requests usage via stream_options and surfaces server-reported metrics', async () => {
    const captured = {};
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"choices":[],"usage":{"completion_tokens":123,"total_tokens":150,"ttft_ms":74,"decode_tps":52.3}}\n\n',
      'data: [DONE]\n\n',
    ];
    let idx = 0;
    const reader = {
      read: vi.fn(async () =>
        idx >= sseChunks.length
          ? { done: true }
          : { done: false, value: new TextEncoder().encode(sseChunks[idx++]) }
      ),
    };
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      captured.body = opts?.body;
      return { ok: true, body: { getReader: () => reader } };
    }));

    let metrics = null;
    const chunks = [];
    for await (const chunk of streamCompletion('http://a.local', '', 'model', [], {
      onMetrics: (m) => { metrics = m; },
    })) {
      chunks.push(chunk);
    }

    expect(JSON.parse(captured.body).stream_options).toEqual({ include_usage: true });
    expect(chunks).toContain('Hi');
    expect(metrics).not.toBeNull();
    expect(metrics.ttftMs).toBe(74);
    expect(metrics.decodeTps).toBe(52.3);
    expect(metrics.completionTokens).toBe(123);
    vi.unstubAllGlobals();
  });

  it('reports no metrics when the backend omits the fields (no client estimate)', async () => {
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      // Backend sends a usage chunk but without ttft_ms / decode_tps, and with
      // completion_tokens=0 — mirrors the current AXERA backend behaviour.
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":0,"total_tokens":10}}\n\n',
      'data: [DONE]\n\n',
    ];
    let idx = 0;
    const reader = {
      read: vi.fn(async () =>
        idx >= sseChunks.length
          ? { done: true }
          : { done: false, value: new TextEncoder().encode(sseChunks[idx++]) }
      ),
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: { getReader: () => reader } })));

    let metricsCalled = false;
    let metrics = 'sentinel';
    const chunks = [];
    for await (const chunk of streamCompletion('http://a.local', '', 'model', [], {
      onMetrics: (m) => { metricsCalled = true; metrics = m; },
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toContain('你好');
    // No recognised metric fields → onMetrics is never fired, nothing to show.
    expect(metricsCalled).toBe(false);
    expect(metrics).toBe('sentinel');
    vi.unstubAllGlobals();
  });
});
