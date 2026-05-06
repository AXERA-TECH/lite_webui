import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from '../src/components/settings-modal.js';
import { store } from '../src/store.js';

function mountModal() {
  const modal = new SettingsModal();
  modal.render();
  modal.show();
  return modal;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('SettingsModal', () => {
  it('shows only fetched models for the current baseUrl', () => {
    store.saveSettings({ baseUrl: 'http://a.local' });
    store.saveAvailableModels('http://a.local', ['model-a']);
    store.saveAvailableModels('http://b.local', ['model-b']);

    const modal = mountModal();
    const text = modal.el.querySelector('#model-caps-list').textContent;

    expect(text).toContain('model-a');
    expect(text).not.toContain('model-b');
  });

  it('saves fetched models under the current baseUrl', async () => {
    store.saveSettings({ baseUrl: 'http://a.local', apiKey: '' });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'model-a' }] }),
    });

    const modal = mountModal();
    await modal._fetchModels();

    expect(store.getAvailableModels('http://a.local')).toEqual(['model-a']);
  });

  it('does not close when clicking inside the modal panel while editing inputs', () => {
    const modal = mountModal();
    const panel = modal.el.querySelector('.modal-panel');
    const input = modal.el.querySelector('#settings-base-url');

    panel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(document.body.contains(modal.el)).toBe(true);
    expect(modal.visible).toBe(true);
  });

  it('closes only when the backdrop itself is clicked', () => {
    const modal = mountModal();

    modal.el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    modal.el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(document.body.contains(modal.el)).toBe(false);
    expect(modal.visible).toBe(false);
  });

  it('clears selected model when switching to a URL without that model', () => {
    store.saveAvailableModels('http://a.local', ['model-a']);
    store.setCurrentModel('http://a.local', 'model-a');
    store.saveSettings({ baseUrl: 'http://a.local' });

    const modal = mountModal();
    modal.el.querySelector('#settings-base-url').value = 'http://b.local';
    modal.el.querySelector('#settings-save').click();

    expect(store.getSettings().baseUrl).toBe('http://b.local');
    expect(store.getCurrentModel('http://b.local')).toBe('');
  });
});
