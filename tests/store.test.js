import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../src/store.js';

describe('store – default settings', () => {
  it('default apiKey is empty string', () => {
    expect(store.getSettings().apiKey).toBe('');
  });

  it('default baseUrl points to localhost:8000', () => {
    expect(store.getSettings().baseUrl).toBe('http://127.0.0.1:8000');
  });

  it('default theme is dark', () => {
    expect(store.getSettings().theme).toBe('dark');
  });

  it('default contextLimitTokens is 4096', () => {
    expect(store.getSettings().contextLimitTokens).toBe(4096);
  });

  it('default contextResetThresholdPercent is 85', () => {
    expect(store.getSettings().contextResetThresholdPercent).toBe(85);
  });
});

describe('store – saveSettings', () => {
  it('persists and retrieves settings', () => {
    store.saveSettings({ apiKey: 'sk-abc', baseUrl: 'http://example.com', theme: 'dark' });
    const s = store.getSettings();
    expect(s.apiKey).toBe('sk-abc');
    expect(s.baseUrl).toBe('http://example.com');
  });

  it('missing keys fall back to defaults', () => {
    store.saveSettings({ apiKey: 'sk-test' }); // no baseUrl
    expect(store.getSettings().baseUrl).toBe('http://127.0.0.1:8000');
  });

  it('invalid context settings are normalized back to safe defaults', () => {
    store.saveSettings({ contextLimitTokens: null, contextResetThresholdPercent: 999 });
    const settings = store.getSettings();
    expect(settings.contextLimitTokens).toBe(4096);
    expect(settings.contextResetThresholdPercent).toBe(95);
  });
});

describe('store – conversations', () => {
  it('starts with empty conversation list', () => {
    expect(store.getConversations()).toEqual([]);
  });

  it('createConversation uses provided model', () => {
    const conv = store.createConversation('my-model');
    expect(conv.model).toBe('my-model');
  });

  it('createConversation defaults to empty string model (not hardcoded gpt-4o)', () => {
    const conv = store.createConversation();
    expect(conv.model).toBe('');
  });

  it('createConversation prepends to list', () => {
    store.createConversation('a');
    store.createConversation('b');
    const convs = store.getConversations();
    expect(convs[0].model).toBe('b'); // most recent first
  });

  it('deleteConversation removes correct conversation', () => {
    const c1 = store.createConversation('m1');
    const c2 = store.createConversation('m2');
    store.deleteConversation(c1.id);
    const ids = store.getConversations().map(c => c.id);
    expect(ids).not.toContain(c1.id);
    expect(ids).toContain(c2.id);
  });

  it('addMessage appends to conversation', () => {
    const conv = store.createConversation('m');
    store.addMessage(conv.id, { role: 'user', content: 'hello', timestamp: new Date().toISOString() });
    const updated = store.getCurrentConversation() ?? store.getConversations().find(c => c.id === conv.id);
    expect(updated.messages).toHaveLength(1);
    expect(updated.messages[0].content).toBe('hello');
  });

  it('updateConversationTitle updates correctly', () => {
    const conv = store.createConversation('m');
    store.updateConversationTitle(conv.id, 'My Title');
    const updated = store.getConversations().find(c => c.id === conv.id);
    expect(updated.title).toBe('My Title');
  });
});

describe('store – clearMessages', () => {
  it('clears all messages from a conversation', () => {
    const conv = store.createConversation('m');
    store.addMessage(conv.id, { role: 'user', content: 'hello', timestamp: 't1' });
    store.addMessage(conv.id, { role: 'assistant', content: 'hi', timestamp: 't2' });
    store.clearMessages(conv.id);
    const updated = store.getConversations().find(c => c.id === conv.id);
    expect(updated.messages).toHaveLength(0);
  });

  it('preserves conversation metadata (title, model) after clearMessages', () => {
    const conv = store.createConversation('my-model');
    store.updateConversationTitle(conv.id, 'My Chat');
    store.addMessage(conv.id, { role: 'user', content: 'msg', timestamp: 't1' });
    store.clearMessages(conv.id);
    const updated = store.getConversations().find(c => c.id === conv.id);
    expect(updated.title).toBe('My Chat');
    expect(updated.model).toBe('my-model');
    expect(updated.messages).toHaveLength(0);
  });

  it('does nothing for non-existent conversation id', () => {
    expect(() => store.clearMessages('no-such-id')).not.toThrow();
  });
});

describe('store – model capabilities', () => {
  it('starts empty', () => {
    expect(store.getModelCapabilities()).toEqual({});
  });

  it('saves and retrieves capabilities', () => {
    store.saveModelCapabilities({ 'my-model': { text: true, image: true, audio: false } });
    expect(store.getModelCapabilities()['my-model'].image).toBe(true);
  });

  it('scopes available models by baseUrl', () => {
    store.saveAvailableModels('http://a.local', ['model-a', 'model-b']);
    store.saveAvailableModels('http://b.local', ['model-c']);
    expect(store.getAvailableModels('http://a.local')).toEqual(['model-a', 'model-b']);
    expect(store.getAvailableModels('http://b.local')).toEqual(['model-c']);
  });

  it('scopes current model selection by baseUrl', () => {
    store.setCurrentModel('http://a.local', 'model-a');
    store.setCurrentModel('http://b.local', 'model-b');
    expect(store.getCurrentModel('http://a.local')).toBe('model-a');
    expect(store.getCurrentModel('http://b.local')).toBe('model-b');
  });

  it('scopes capability overrides by baseUrl', () => {
    store.saveModelCapabilities('http://a.local', { 'model-a': { text: true, image: true, audio: false } });
    store.saveModelCapabilities('http://b.local', { 'model-a': { text: true, image: false, audio: false } });
    expect(store.getModelCapabilities('http://a.local')['model-a'].image).toBe(true);
    expect(store.getModelCapabilities('http://b.local')['model-a'].image).toBe(false);
  });
});
