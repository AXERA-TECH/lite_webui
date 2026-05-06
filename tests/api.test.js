import { describe, it, expect, vi } from 'vitest';
import {
  buildRequestConfig,
  fetchModels,
  streamCompletion,
  transcribeAudio,
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
