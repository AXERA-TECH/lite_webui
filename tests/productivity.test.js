import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../src/components/sidebar.js';
import { InputBar } from '../src/components/input-bar.js';
import { Chat } from '../src/components/chat.js';
import { App } from '../src/components/app.js';
import { store } from '../src/store.js';

function makeStreamFetch(text) {
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    'data: [DONE]\n\n',
  ];
  let index = 0;
  const reader = {
    read: vi.fn(async () => (
      index >= chunks.length
        ? { done: true }
        : { done: false, value: new TextEncoder().encode(chunks[index++]) }
    )),
  };
  return vi.fn(async () => ({ ok: true, body: { getReader: () => reader } }));
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Prompt Library', () => {
  it('provides built-in prompts and saves custom prompts', () => {
    const bar = new InputBar();
    document.body.appendChild(bar.render());

    bar._togglePromptPanel(true);
    expect(bar.el.querySelector('#prompt-list').textContent).toContain('Code review');

    bar.el.querySelector('#message-input').value = 'Summarize this AXERA benchmark table.';
    bar.el.querySelector('#prompt-name-input').value = 'Benchmark summary';
    bar._saveCurrentPrompt();

    const custom = store.getPrompts().find(prompt => prompt.name === 'Benchmark summary');
    expect(custom?.content).toContain('benchmark table');
    expect(custom.builtin).toBe(false);
    expect(bar._promptOpen).toBe(false);
  });

  it('inserts a prompt at the cursor and deletes custom prompts', () => {
    const bar = new InputBar();
    document.body.appendChild(bar.render());
    const saved = store.savePrompt({ name: 'Translation', content: 'Translate to English:' });
    expect(saved).toBeTruthy();

    bar._usePrompt(saved.id);
    expect(bar.el.querySelector('#message-input').value).toContain('Translate to English:');

    expect(store.deletePrompt(saved.id)).toBe(true);
    expect(store.getPrompts().some(prompt => prompt.id === saved.id)).toBe(false);
  });
});

describe('Conversation search', () => {
  it('filters conversations by title and message content', () => {
    const alpha = store.createConversation('model-a');
    store.updateConversationTitle(alpha.id, 'Kernel debugging');
    store.addMessage(alpha.id, { role: 'user', content: 'axera mmap failed', timestamp: 'u1' });
    const beta = store.createConversation('model-b');
    store.updateConversationTitle(beta.id, 'Marketing copy');

    const sidebar = new Sidebar();
    document.body.appendChild(sidebar.render());
    const input = sidebar.el.querySelector('#conversation-search');
    input.value = 'axera mmap';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const items = [...sidebar.el.querySelectorAll('[role="option"]')];
    expect(items.map(item => item.dataset.convId)).toEqual([alpha.id]);

    input.value = 'marketing';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect([...sidebar.el.querySelectorAll('[role="option"]')].map(item => item.dataset.convId)).toEqual([beta.id]);
  });
});

describe('Message edit and branches', () => {
  it('dispatches an edit request from the user message action', () => {
    const chat = new Chat();
    document.body.appendChild(chat.render());
    chat.loadConversation({
      branches: [{ id: 'branch-1', label: 'Original', createdAt: '2026-01-01T00:00:00Z', messages: [] }],
      messages: [
        { role: 'user', content: 'original question', timestamp: 'u1' },
        { role: 'assistant', content: 'answer', timestamp: 'a1' },
      ],
    });

    expect(chat.el.textContent).toContain('Branch');
    chat.el.querySelector('button[title="Edit this message and rerun from this point"]').click();
    const editor = chat.el.querySelector('textarea[aria-label="Edit user message"]');
    editor.value = 'better question';

    const handler = vi.fn();
    document.addEventListener('chat:edit-user', handler, { once: true });
    [...chat.el.querySelectorAll('button')].find(button => button.textContent === 'Save & rerun').click();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      detail: { msgTimestamp: 'u1', text: 'better question' },
    }));
  });

  it.each([undefined, '2026-11-16T12:30:00Z'])('keeps an accessible edit action below the bubble with timestamp %s', (timestamp) => {
    const chat = new Chat();
    document.body.appendChild(chat.render());
    chat.loadConversation({ messages: [{ role: 'user', content: 'A long document instruction '.repeat(30), timestamp, meta: { type: 'document', fileName: 'Long document title.pdf', kind: 'pdf' } }] });
    const button = chat.el.querySelector('button[title="Edit this message and rerun from this point"]');
    const meta = button.closest('[data-user-message-meta]');
    const bubble = chat.el.querySelector('.user-bubble');
    expect(button.title).toBe('Edit this message and rerun from this point');
    expect(button.getAttribute('aria-label')).toBe('Edit & rerun');
    expect(button.textContent.trim()).toBe('');
    expect(button.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
    expect(meta.parentElement).toBe(bubble.parentElement);
    expect(bubble.nextElementSibling).toBe(meta);
    expect(meta.querySelector('span') !== null).toBe(Boolean(timestamp));
    expect(chat.el.textContent).not.toContain('Invalid Date');
    button.click();
    expect(chat.el.querySelector('textarea[aria-label="Edit user message"]').value).toContain('A long document instruction');
    expect(button.disabled).toBe(true);
  });

  it.each(['Cancel', 'Escape'])('restores the bubble and edit focus on %s without rerunning', (action) => {
    const chat = new Chat();
    document.body.appendChild(chat.render());
    chat.loadConversation({ messages: [{ role: 'user', content: 'Original question', timestamp: '2026-11-16T12:30:00Z' }] });
    const button = chat.el.querySelector('button[title="Edit this message and rerun from this point"]');
    const handler = vi.fn();
    document.addEventListener('chat:edit-user', handler);
    try {
      button.click();
      const editor = chat.el.querySelector('textarea[aria-label="Edit user message"]');
      editor.value = 'Draft edits';
      // Repeated activation must not replace the current edit draft.
      button.click();
      expect(chat.el.querySelectorAll('textarea[aria-label="Edit user message"]')).toHaveLength(1);
      expect(editor.value).toBe('Draft edits');
      if (action === 'Escape') editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else [...chat.el.querySelectorAll('button')].find(control => control.textContent === 'Cancel').click();
      expect(chat.el.querySelector('textarea[aria-label="Edit user message"]')).toBeNull();
      expect(chat.el.querySelector('.user-bubble').textContent).toBe('Original question');
      expect(button.disabled).toBe(false);
      expect(document.activeElement).toBe(button);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('chat:edit-user', handler);
    }
  });

  it('saves the old path, truncates history, and reruns an edited prompt', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    globalThis.fetch = makeStreamFetch('better answer');
    store.saveEndpoints([{ id: 'local', name: 'Local', baseUrl: 'http://a.local', apiKey: '' }]);
    store.saveAvailableModels('http://a.local', ['model-a']);
    store.setCurrentModel('http://a.local', 'model-a');

    const conv = store.createConversation('model-a');
    store.setCurrentConversationId(conv.id);
    store.addMessage(conv.id, { role: 'user', content: 'original', timestamp: 'u1' });
    store.addMessage(conv.id, { role: 'assistant', content: 'old answer', timestamp: 'a1' });
    store.addMessage(conv.id, { role: 'user', content: 'follow up', timestamp: 'u2' });

    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = new App(root);
    app.init();
    await app._editUserMessage('u1', 'edited prompt');

    const updated = store.getCurrentConversation();
    expect(updated.messages.map(message => message.content)).toEqual(['edited prompt', 'better answer']);
    expect(updated.branches).toHaveLength(1);
    expect(updated.branches[0].messages).toHaveLength(3);
  });

  it('snapshots the active path when restoring a branch', () => {
    const conv = store.createConversation('model-a');
    store.setCurrentConversationId(conv.id);
    store.addMessage(conv.id, { role: 'user', content: 'new path', timestamp: 'n1' });
    const branch = store.saveConversationBranch(conv.id, 'Old path', [
      { role: 'user', content: 'old path', timestamp: 'o1' },
    ]);

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = new App(root);
    app.init();
    app._restoreConversationBranch(branch.id);

    const updated = store.getCurrentConversation();
    expect(updated.messages.map(message => message.content)).toEqual(['old path']);
    expect(updated.branches.some(item => item.messages.some(message => message.content === 'new path'))).toBe(true);
  });
});
