import { describe, it, expect, vi } from 'vitest';
import {
  buildRequestConfig,
  fetchModels,
  streamCompletion,
  transcribeAudio,
  generateSpeech,
  extractServerMetrics,
  formatTtft,
  formatTps,
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

  it('generateSpeech posts JSON and returns the binary audio blob', async () => {
    const captured = {};
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      captured.url = url;
      captured.method = opts?.method;
      captured.headers = opts?.headers ?? {};
      captured.body = opts?.body;
      return {
        ok: true,
        blob: async () => new Blob(['RIFF'], { type: 'audio/wav' }),
      };
    }));

    const result = await generateSpeech('http://localhost:18082', '', 'voxcpm2', '今天天气很好。', {
      seed: 42,
    });

    expect(captured.url).toBe('/lw-proxy/v1/audio/speech');
    expect(captured.method).toBe('POST');
    expect(captured.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(captured.body)).toEqual({
      model: 'voxcpm2',
      input: '今天天气很好。',
      response_format: 'wav',
      seed: 42,
    });
    expect(result.contentType).toBe('audio/wav');
    expect(result.seed).toBe(42);
    expect(result.blob.size).toBeGreaterThan(0);
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
    // total_tokens alone is not a displayed metric (redundant with in/out).
    expect(extractServerMetrics({ total_tokens: 20 })).toBeNull();
  });

  it('reads server-reported metrics verbatim', () => {
    const m = extractServerMetrics({
      prompt_tokens: 10, completion_tokens: 512, prefill_tokens: 6,
      ttft_ms: 39.96, prefill_tps: 220.5, decode_tps: 36.13,
    });
    expect(m.ttftMs).toBe(39.96);
    expect(m.prefillTps).toBe(220.5);
    expect(m.decodeTps).toBe(36.13);
    expect(m.inputTokens).toBe(10);
    expect(m.prefillTokens).toBe(6);
    expect(m.completionTokens).toBe(512);
  });

  it('accepts documented field aliases', () => {
    const m = extractServerMetrics({
      time_to_first_token_ms: 40, prefill_tokens_per_second: 200,
      tokens_per_second: 30, input_tokens: 7, output_tokens: 100, prefilled_tokens: 3,
    });
    expect(m.ttftMs).toBe(40);
    expect(m.prefillTps).toBe(200);
    expect(m.decodeTps).toBe(30);
    expect(m.inputTokens).toBe(7);
    expect(m.prefillTokens).toBe(3);
    expect(m.completionTokens).toBe(100);
  });

  it('normalizes native llama.cpp timings and cached-token details', () => {
    const m = extractServerMetrics({
      prompt_tokens: 16,
      completion_tokens: 24,
      prompt_tokens_details: { cached_tokens: 10 },
      timings: {
        prompt_ms: 35.496,
        prompt_per_second: 450.755,
        predicted_per_second: 129.022,
      },
    });

    expect(m.ttftMs).toBe(35.496);
    expect(m.prefillTps).toBe(450.755);
    expect(m.decodeTps).toBe(129.022);
    expect(m.inputTokens).toBe(16);
    expect(m.prefillTokens).toBe(6);
    expect(m.completionTokens).toBe(24);
  });

  it('keeps prefill_tokens=0 (whole prompt served from KV cache)', () => {
    expect(extractServerMetrics({ prompt_tokens: 20, prefill_tokens: 0 }))
      .toEqual({ inputTokens: 20, prefillTokens: 0 });
  });

  it('omits non-positive speeds/counts (no bogus "0")', () => {
    expect(extractServerMetrics({ completion_tokens: 0, decode_tps: 0, prompt_tokens: 0 })).toBeNull();
    const m = extractServerMetrics({ completion_tokens: 0, ttft_ms: 40 });
    expect(m.ttftMs).toBe(40);
    expect(m.completionTokens).toBeUndefined();
  });

  it('includes only the fields the backend reported', () => {
    expect(extractServerMetrics({ decode_tps: 36.13 })).toEqual({ decodeTps: 36.13 });
  });

  it('surfaces input tokens on their own (standard prompt_tokens)', () => {
    // A stock OpenAI usage chunk carries prompt_tokens → shows "in N".
    expect(extractServerMetrics({ prompt_tokens: 10, total_tokens: 10 })).toEqual({ inputTokens: 10 });
  });

  it('never derives metrics from client timing (usage object is the only source)', () => {
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

describe('formatTps', () => {
  it('shows one decimal below 100', () => {
    expect(formatTps(45.62)).toBe('45.6 tok/s');
  });
  it('rounds to integer at or above 100', () => {
    expect(formatTps(220.7)).toBe('221 tok/s');
  });
  it('returns empty string for invalid input', () => {
    expect(formatTps(0)).toBe('');
    expect(formatTps(NaN)).toBe('');
  });
});

describe('streamCompletion – metrics interface', () => {
  it('requests usage via stream_options and surfaces server-reported metrics', async () => {
    const captured = {};
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":123,"total_tokens":132,"ttft_ms":74,"prefill_tps":210,"decode_tps":52.3}}\n\n',
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
    expect(metrics.prefillTps).toBe(210);
    expect(metrics.decodeTps).toBe(52.3);
    expect(metrics.inputTokens).toBe(9);
    expect(metrics.completionTokens).toBe(123);
    vi.unstubAllGlobals();
  });

  it('captures llama.cpp top-level timings from the final SSE chunk', async () => {
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"上海"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":16,"completion_tokens":16,"total_tokens":32,"prompt_tokens_details":{"cached_tokens":0}},"timings":{"prompt_ms":35.496,"prompt_per_second":450.755,"predicted_per_second":129.022}}\n\n',
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

    let metrics = null;
    const chunks = [];
    for await (const chunk of streamCompletion('http://a.local', '', 'model', [], {
      onMetrics: (m) => { metrics = m; },
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toContain('上海');
    expect(metrics).toEqual({
      ttftMs: 35.496,
      prefillTps: 450.755,
      decodeTps: 129.022,
      inputTokens: 16,
      prefillTokens: 16,
      completionTokens: 16,
    });
    vi.unstubAllGlobals();
  });

  it('emits only the fields the backend provides (no client estimate)', async () => {
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      // Backend sends usage without ttft/decode/prefill and with completion_tokens=0,
      // but a real prompt_tokens — only input tokens should surface.
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

    let metrics = 'sentinel';
    const chunks = [];
    for await (const chunk of streamCompletion('http://a.local', '', 'model', [], {
      onMetrics: (m) => { metrics = m; },
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toContain('你好');
    expect(metrics).toEqual({ inputTokens: 10 });
    vi.unstubAllGlobals();
  });
});
