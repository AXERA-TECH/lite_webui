import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/components/app.js';
import { store } from '../src/store.js';

function setViewport(width) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
}

function mountApp() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const app = new App(root);
  app._render();
  app._syncSidebarLayout();
  app._loadCurrentConversation();
  app.settingsModal.render();
  app._updateContextInfo();
  return { app, root };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('App sidebar layout', () => {
  it('keeps the sidebar visible on desktop when selecting another conversation', () => {
    setViewport(1280);
    const first = store.createConversation('model-a');
    const second = store.createConversation('model-a');
    store.setCurrentConversationId(first.id);

    const { app, root } = mountApp();
    const sidebar = root.querySelector('#sidebar');

    expect(sidebar.className).not.toContain('-translate-x-full');

    app._selectConversation(second.id);

    expect(sidebar.className).not.toContain('-translate-x-full');
    expect(sidebar.className).not.toContain('fixed');
    expect(root.querySelector('#new-chat-btn')).not.toBeNull();
  });

  it('does not hide the sidebar on desktop after creating multiple new chats', () => {
    setViewport(1280);
    const { app, root } = mountApp();

    app._newChat();
    app._newChat();

    const sidebar = root.querySelector('#sidebar');
    expect(sidebar.className).not.toContain('-translate-x-full');
    expect(root.querySelectorAll('#conv-list [role="option"]').length).toBe(2);
  });

  it('uses off-canvas sidebar behaviour only on mobile widths', () => {
    setViewport(640);
    const first = store.createConversation('model-a');
    const second = store.createConversation('model-a');
    store.setCurrentConversationId(first.id);

    const { app, root } = mountApp();
    const sidebar = root.querySelector('#sidebar');

    expect(sidebar.className).toContain('-translate-x-full');
    expect(sidebar.className).toContain('fixed');

    app._toggleMobileSidebar();
    expect(sidebar.className).toContain('translate-x-0');
    expect(sidebar.className).not.toContain('-translate-x-full');

    app._selectConversation(second.id);
    expect(sidebar.className).toContain('-translate-x-full');
  });
});

describe('App model state', () => {
  it('uses the globally selected model instead of per-conversation model', () => {
    setViewport(1280);
    store.saveSettings({ baseUrl: 'http://a.local' });
    store.saveAvailableModels('http://a.local', ['model-a']);
    store.setCurrentModel('http://a.local', 'model-a');

    const first = store.createConversation('legacy-model');
    store.setCurrentConversationId(first.id);

    const { app } = mountApp();

    expect(app.modelPicker.getModel()).toBe('model-a');
    expect(app.inputBar._currentModel).toBe('model-a');
  });

  it('activates Speak mode on first load even when no conversation exists', () => {
    setViewport(1280);
    store.saveSettings({ baseUrl: 'http://a.local' });
    store.saveAvailableModels('http://a.local', ['gguf/VoxCPM2-BaseLM-F16.gguf']);
    store.setCurrentModel('http://a.local', 'gguf/VoxCPM2-BaseLM-F16.gguf');

    const { app } = mountApp();

    expect(app.modelPicker.getModel()).toBe('gguf/VoxCPM2-BaseLM-F16.gguf');
    expect(app.inputBar._ttsMode).toBe(true);
    expect(app.inputBar._currentModel).toBe('gguf/VoxCPM2-BaseLM-F16.gguf');
  });

  it('clears the current model after models:changed when current URL no longer provides it', () => {
    setViewport(1280);
    store.saveSettings({ baseUrl: 'http://a.local' });
    store.saveAvailableModels('http://a.local', ['model-a']);
    store.setCurrentModel('http://a.local', 'model-a');

    const { app } = mountApp();
    store.saveAvailableModels('http://a.local', ['model-b']);
    document.dispatchEvent(new CustomEvent('models:changed'));

    expect(app.modelPicker.getModel()).toBe('');
    expect(app.inputBar._currentModel).toBe('');
  });
});

describe('App context reset accounting', () => {
  function seedConversation(model = 'model-a') {
    const conv = store.createConversation(model);
    store.setCurrentConversationId(conv.id);
    store.addMessage(conv.id, { role: 'user', content: 'a'.repeat(100), timestamp: 'user-1' });
    store.addMessage(conv.id, { role: 'assistant', content: 'b'.repeat(100), timestamp: 'assistant-1' });
    return conv;
  }

  it('/reset clears persisted API context and resets the ctx badge', async () => {
    setViewport(1280);
    seedConversation();
    store.saveSettings({ baseUrl: 'http://a.local' });
    store.saveAvailableModels('http://a.local', ['model-a']);
    store.setCurrentModel('http://a.local', 'model-a');

    const { app } = mountApp();
    expect(app.inputBar.el.querySelector('#context-info').textContent).not.toBe('ctx 0/4.1k');

    await app._handleSend('/reset', null, null, null);

    expect(store.getCurrentConversation().messages).toHaveLength(0);
    expect(app.inputBar.el.querySelector('#context-info').textContent).toBe('ctx 0/4.1k');
  });

  it('switching models resets the API-context counter while preserving visual history', () => {
    setViewport(1280);
    const conv = seedConversation();
    store.saveSettings({ baseUrl: 'http://a.local' });
    store.saveAvailableModels('http://a.local', ['model-a', 'model-b']);
    store.setCurrentModel('http://a.local', 'model-a');

    const { app } = mountApp();
    app._bindEvents();
    app._pushSessionMsg(conv.id, { role: 'user', content: 'visual user', timestamp: 'visual-user' });
    app._pushSessionMsg(conv.id, { role: 'assistant', content: 'visual assistant', timestamp: 'visual-assistant' });
    expect(app.inputBar.el.querySelector('#context-info').textContent).not.toBe('ctx 0/4.1k');

    document.dispatchEvent(new CustomEvent('model:changed', { detail: { model: 'model-b' } }));

    expect(app._activeContextModel).toBe('model-b');
    expect(store.getCurrentConversation().messages).toHaveLength(0);
    expect(app._sessionMessages.get(conv.id)).toHaveLength(2);
    expect(app.inputBar.el.querySelector('#context-info').textContent).toBe('ctx 0/4.1k');
    expect(app.chat.el.textContent).toContain('Context /reset');
  });
});

describe('App model metadata in messages', () => {
  function makeStreamFetch(text) {
    const sseChunks = [
      `data: {"choices":[{"delta":{"content":"${text}"}}]}\n\n`,
      `data: [DONE]\n\n`,
    ];
    let idx = 0;
    const reader = {
      read: vi.fn(async () =>
        idx >= sseChunks.length
          ? { done: true }
          : { done: false, value: new TextEncoder().encode(sseChunks[idx++]) }
      ),
    };
    return vi.fn(async () => ({
      ok: true, body: { getReader: () => reader },
    }));
  }

  it('saves model name on assistant message after streaming response', async () => {
    setViewport(1280);
    store.saveSettings({ baseUrl: 'http://a.local', apiKey: '' });
    store.saveAvailableModels('http://a.local', ['gpt-test']);
    store.setCurrentModel('http://a.local', 'gpt-test');
    globalThis.fetch = makeStreamFetch('Hello world');

    const { app } = mountApp();
    await app._handleSend('Hi', null, null, null);

    const conv = store.getCurrentConversation();
    const last = conv.messages.at(-1);
    expect(last.role).toBe('assistant');
    expect(last.model).toBe('gpt-test');
  });

  it('renders model name badge in the chat DOM after streaming', async () => {
    setViewport(1280);
    store.saveSettings({ baseUrl: 'http://a.local', apiKey: '' });
    store.saveAvailableModels('http://a.local', ['my-model-v2']);
    store.setCurrentModel('http://a.local', 'my-model-v2');
    globalThis.fetch = makeStreamFetch('Response text');

    const { app, root } = mountApp();
    await app._handleSend('test', null, null, null);

    const chatEl = root.querySelector('#chat-messages');
    expect(chatEl?.innerHTML).toContain('my-model-v2');
  });

  it('renders model badge when loading conversation from store', () => {
    setViewport(1280);
    const conv = store.createConversation('some-model');
    store.setCurrentConversationId(conv.id);
    store.addMessage(conv.id, { role: 'user', content: 'hello', timestamp: '2024-01-01T00:00:00Z' });
    store.addMessage(conv.id, { role: 'assistant', content: 'world', model: 'some-model', timestamp: '2024-01-01T00:00:01Z' });

    const { root } = mountApp();
    const chatEl = root.querySelector('#chat-messages');
    expect(chatEl?.innerHTML).toContain('some-model');
  });

  it('does not show model badge when model is absent on message', () => {
    setViewport(1280);
    const conv = store.createConversation('x');
    store.setCurrentConversationId(conv.id);
    store.addMessage(conv.id, { role: 'user', content: 'hi', timestamp: '2024-01-01T00:00:00Z' });
    store.addMessage(conv.id, { role: 'assistant', content: 'hey', timestamp: '2024-01-01T00:00:01Z' });

    const { root } = mountApp();
    const chatEl = root.querySelector('#chat-messages');
    // No model badge — the info icon should not appear
    expect(chatEl?.querySelectorAll('[title^="Model:"]').length).toBe(0);
  });
});

describe('App performance metrics', () => {
  function makeMetricStreamFetch(prefillTokens = 5) {
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"Answer"}}]}\n\n',
      `data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":512,"total_tokens":521,"ttft_ms":82,"prefill_tps":210,"decode_tps":45.6,"prefill_tokens":${prefillTokens}}}\n\n`,
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
    return vi.fn(async () => ({ ok: true, body: { getReader: () => reader } }));
  }

  it('renders all server-reported metrics as pills under the assistant message', async () => {
    setViewport(1280);
    store.saveSettings({ baseUrl: 'http://a.local', apiKey: '' });
    store.saveAvailableModels('http://a.local', ['gpt-test']);
    store.setCurrentModel('http://a.local', 'gpt-test');
    globalThis.fetch = makeMetricStreamFetch(5); // 5 newly prefilled of 9 input → reuse

    const { app, root } = mountApp();
    await app._handleSend('Hi', null, null, null);

    const chatEl = root.querySelector('#chat-messages');
    expect(chatEl?.textContent).toContain('TTFT 82 ms');
    expect(chatEl?.textContent).toContain('prefill 210 tok/s');
    expect(chatEl?.textContent).toContain('decode 45.6 tok/s');
    expect(chatEl?.textContent).toContain('in 9');
    expect(chatEl?.textContent).toContain('new 5');
    expect(chatEl?.textContent).toContain('out 512');
  });

  it('renders metrics from native llama.cpp timing fields', async () => {
    setViewport(1280);
    store.saveSettings({ baseUrl: 'http://a.local', apiKey: '' });
    store.saveAvailableModels('http://a.local', ['llama-cpp']);
    store.setCurrentModel('http://a.local', 'llama-cpp');

    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"上海"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":16,"completion_tokens":16,"prompt_tokens_details":{"cached_tokens":10}},"timings":{"prompt_ms":35.496,"prompt_per_second":450.755,"predicted_per_second":129.022}}\n\n',
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
    globalThis.fetch = vi.fn(async () => ({ ok: true, body: { getReader: () => reader } }));

    const { app, root } = mountApp();
    await app._handleSend('Hi', null, null, null);

    const chatEl = root.querySelector('#chat-messages');
    expect(chatEl?.textContent).toContain('TTFT 35 ms');
    expect(chatEl?.textContent).toContain('prefill 451 tok/s');
    expect(chatEl?.textContent).toContain('decode 129 tok/s');
    expect(chatEl?.textContent).toContain('in 16');
    expect(chatEl?.textContent).toContain('new 6');
    expect(chatEl?.textContent).toContain('out 16');
  });

  it('hides the "new" pill when nothing was reused (prefill_tokens == input)', async () => {
    setViewport(1280);
    store.saveSettings({ baseUrl: 'http://a.local', apiKey: '' });
    store.saveAvailableModels('http://a.local', ['gpt-test']);
    store.setCurrentModel('http://a.local', 'gpt-test');
    globalThis.fetch = makeMetricStreamFetch(9); // all 9 freshly prefilled → no reuse

    const { app, root } = mountApp();
    await app._handleSend('Hi', null, null, null);

    const chatEl = root.querySelector('#chat-messages');
    expect(chatEl?.textContent).toContain('in 9');
    expect(chatEl?.textContent).not.toContain('new ');
  });

  it('persists metrics on the stored assistant message', async () => {
    setViewport(1280);
    store.saveSettings({ baseUrl: 'http://a.local', apiKey: '' });
    store.saveAvailableModels('http://a.local', ['gpt-test']);
    store.setCurrentModel('http://a.local', 'gpt-test');
    globalThis.fetch = makeMetricStreamFetch(5);

    const { app } = mountApp();
    await app._handleSend('Hi', null, null, null);

    const last = store.getCurrentConversation().messages.at(-1);
    expect(last.metrics.ttftMs).toBe(82);
    expect(last.metrics.prefillTps).toBe(210);
    expect(last.metrics.decodeTps).toBe(45.6);
    expect(last.metrics.inputTokens).toBe(9);
    expect(last.metrics.prefillTokens).toBe(5);
    expect(last.metrics.completionTokens).toBe(512);
  });
});

describe('App audio workflows', () => {
  it('uploads audio and returns transcription text', async () => {
    setViewport(1280);
    store.saveSettings({ baseUrl: 'http://a.local' });
    store.saveAvailableModels('http://a.local', ['audio-model']);
    store.setCurrentModel('http://a.local', 'audio-model');
    store.saveModelCapabilities({ 'audio-model': { text: true, image: false, audio: true } });

    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/v1/audio/transcriptions')) {
        return { ok: true, json: async () => ({ text: '会议录音转写文本' }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { app } = mountApp();
    const file = new File(['audio'], 'meeting.wav', { type: 'audio/wav' });
    await app._handleSend('', null, null, { file, mode: 'transcribe' });

    const conv = store.getCurrentConversation();
    expect(conv.messages.at(-1).content).toBe('会议录音转写文本');
  });

  it('uploads audio and can return translated text via instruction', async () => {
    setViewport(1280);
    store.saveSettings({ baseUrl: 'http://a.local' });
    store.saveAvailableModels('http://a.local', ['audio-model']);
    store.setCurrentModel('http://a.local', 'audio-model');
    store.saveModelCapabilities({ 'audio-model': { text: true, image: false, audio: true } });

    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"Translated meeting notes"}}]}\n\n',
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

    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/v1/audio/transcriptions')) {
        return { ok: true, json: async () => ({ text: 'Bonjour tout le monde' }) };
      }
      if (String(url).includes('/v1/chat/completions')) {
        return { ok: true, body: { getReader: () => reader } };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { app } = mountApp();
    const file = new File(['audio'], 'speech.m4a', { type: 'audio/mp4' });
    await app._handleSend('Translate this audio to English', null, null, { file });

    const conv = store.getCurrentConversation();
    expect(conv.messages.at(-1).content).toBe('Translated meeting notes');
  });

  it('uploads audio with an instruction and returns processed text', async () => {
    setViewport(1280);
    store.saveSettings({ baseUrl: 'http://a.local' });
    store.saveAvailableModels('http://a.local', ['audio-model']);
    store.setCurrentModel('http://a.local', 'audio-model');
    store.saveModelCapabilities({ 'audio-model': { text: true, image: false, audio: true } });

    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"待办事项：整理纪要"}}]}\n\n',
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

    let capturedChatBody = '';
    globalThis.fetch = vi.fn(async (url, opts) => {
      if (String(url).includes('/v1/audio/transcriptions')) {
        return { ok: true, json: async () => ({ text: '原始会议录音文本' }) };
      }
      if (String(url).includes('/v1/chat/completions')) {
        capturedChatBody = opts?.body || '';
        return { ok: true, body: { getReader: () => reader } };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { app } = mountApp();
    const file = new File(['audio'], 'call.wav', { type: 'audio/wav' });
    await app._handleSend('提取会议待办事项', null, null, { file });

    const conv = store.getCurrentConversation();
    expect(conv.messages.at(-1).content).toBe('待办事项：整理纪要');
    expect(capturedChatBody).toContain('提取会议待办事项');
    expect(capturedChatBody).toContain('原始会议录音文本');
  });
});

describe('App speech generation', () => {
  it('posts to /v1/audio/speech and renders a playable result', async () => {
    setViewport(1280);
    store.saveSettings({ baseUrl: 'http://a.local', apiKey: '' });
    const advertisedModel = 'gguf/VoxCPM2-BaseLM-F16.gguf';
    store.saveAvailableModels('http://a.local', [advertisedModel]);
    store.setCurrentModel('http://a.local', advertisedModel);

    const captured = {};
    globalThis.fetch = vi.fn(async (url, opts) => {
      captured.url = url;
      captured.body = opts?.body;
      return {
        ok: true,
        blob: async () => new Blob(['RIFF-audio'], { type: 'audio/wav' }),
      };
    });

    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:speech-test');
    const { app, root } = mountApp();

    try {
      await app._handleSend('今天天气很好。', null, null, null, false, 42, true);
    } finally {
      if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL;
      else delete URL.createObjectURL;
    }

    expect(captured.url).toBe('/lw-proxy/v1/audio/speech');
    expect(JSON.parse(captured.body)).toMatchObject({
      model: 'voxcpm2',
      input: '今天天气很好。',
      response_format: 'wav',
      seed: 42,
    });

    const conv = store.getCurrentConversation();
    const stored = conv.messages.at(-1);
    expect(stored.content).toBe('语音已生成');
    expect(stored.generatedAudio.url).toBeUndefined();
    expect(stored.generatedAudio.contentType).toBe('audio/wav');

    const sessionMessage = app._sessionMessages.get(conv.id).at(-1);
    expect(sessionMessage.model).toBe(advertisedModel);
    expect(sessionMessage.generatedAudio.url).toBe('blob:speech-test');
    expect(root.querySelector('audio[src="blob:speech-test"]')).not.toBeNull();
    expect(root.textContent).toContain('Download');
  });
});

describe('App image generation – data URL persistence', () => {
  function makeImageFetch(imageUrl) {
    // First call: image generation API → returns HTTP URL
    // Subsequent calls: fetching the image itself → returns a fake PNG blob
    let generationDone = false;
    return vi.fn(async (url) => {
      if (!generationDone && String(url).includes('/v1/images/')) {
        generationDone = true;
        return {
          ok: true,
          json: async () => ({ data: [{ url: imageUrl, seed: 42 }] }),
        };
      }
      // Simulates fetching the image URL to convert to data URL
      if (String(url) === imageUrl) {
        const pngBytes = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
        return {
          ok: true,
          blob: async () => new Blob([pngBytes], { type: 'image/png' }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  }

  it('stores a base64 data URL (not HTTP URL) in the conversation after image generation', async () => {
    setViewport(1280);
    store.saveSettings({ baseUrl: 'http://a.local', apiKey: '' });
    store.saveAvailableModels('http://a.local', ['flux-dev']);
    store.setCurrentModel('http://a.local', 'flux-dev');
    store.saveModelCapabilities({ 'flux-dev': { text: true, image: false, audio: false, imageGen: true } });

    const imageUrl = 'http://a.local/images/generated/test-img.png';
    globalThis.fetch = makeImageFetch(imageUrl);

    const { app } = mountApp();
    await app._handleSend('a cat', null, null, null, true);

    const conv = store.getCurrentConversation();
    const lastMsg = conv.messages.at(-1);
    expect(lastMsg.generatedImages).toBeDefined();
    expect(lastMsg.generatedImages.length).toBeGreaterThan(0);
    // Must be a data URL, NOT the original HTTP URL
    expect(lastMsg.generatedImages[0]).toMatch(/^data:/);
    expect(lastMsg.generatedImages[0]).not.toBe(imageUrl);
  });

  it('falls back to HTTP URL when image fetch fails', async () => {
    setViewport(1280);
    store.saveSettings({ baseUrl: 'http://a.local', apiKey: '' });
    store.saveAvailableModels('http://a.local', ['flux-dev']);
    store.setCurrentModel('http://a.local', 'flux-dev');
    store.saveModelCapabilities({ 'flux-dev': { text: true, image: false, audio: false, imageGen: true } });

    const imageUrl = 'http://a.local/images/generated/fail-img.png';
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/v1/images/')) {
        return { ok: true, json: async () => ({ data: [{ url: imageUrl, seed: 7 }] }) };
      }
      // Image fetch fails (backend unreachable)
      throw new Error('Network error');
    });

    const { app } = mountApp();
    await app._handleSend('a dog', null, null, null, true);

    const conv = store.getCurrentConversation();
    const lastMsg = conv.messages.at(-1);
    expect(lastMsg.generatedImages?.[0]).toBe(imageUrl);
  });
});
