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
