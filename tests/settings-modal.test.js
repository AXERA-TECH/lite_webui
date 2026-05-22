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
  it('shows fetched models inline in their endpoint card', () => {
    store.saveEndpoints([{ id: 'ep1', name: 'Local', baseUrl: 'http://a.local', apiKey: '' }]);
    store.saveAvailableModels('http://a.local', ['model-a']);
    // model-b is from an unconfigured endpoint — should NOT appear
    store.saveAvailableModels('http://b.local', ['model-b']);

    const modal = mountModal();
    // Models are shown inline in the endpoint card, not in a global list
    const card = modal.el.querySelector('.endpoint-card[data-endpoint-id="ep1"]');
    const epModels = card?.querySelector('.ep-models');

    expect(epModels?.textContent).toContain('model-a');
    expect(modal.el.textContent).not.toContain('model-b');
  });

  it('saves fetched models under the current endpoint baseUrl', async () => {
    store.saveEndpoints([{ id: 'ep1', name: 'Local', baseUrl: 'http://a.local', apiKey: '' }]);
    store.setActiveEndpointId('ep1');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'model-a' }] }),
    });

    const modal = mountModal();
    await modal._fetchModels('ep1');

    expect(store.getAvailableModels('http://a.local')).toEqual(['model-a']);
  });

  it('auto-saves endpoint inputs before fetching (no manual Save required)', async () => {
    store.saveEndpoints([{ id: 'ep1', name: 'Old Name', baseUrl: 'http://old.local', apiKey: '' }]);
    store.setActiveEndpointId('ep1');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'model-x' }] }),
    });

    const modal = mountModal();
    // User types a new URL without clicking Save
    const card = modal.el.querySelector('.endpoint-card[data-endpoint-id="ep1"]');
    card.querySelector('.ep-url').value = 'http://new.local';
    card.querySelector('.ep-name').value = 'New Name';

    await modal._fetchModels('ep1');

    // The new URL/name should have been saved automatically
    const savedEps = store.getEndpoints();
    expect(savedEps[0].baseUrl).toBe('http://new.local');
    expect(savedEps[0].name).toBe('New Name');
    // Models fetched against the new URL
    expect(store.getAvailableModels('http://new.local')).toEqual(['model-x']);
  });

  it('shows fetched models inline in card after fetch', async () => {
    store.saveEndpoints([{ id: 'ep1', name: 'Local', baseUrl: 'http://a.local', apiKey: '' }]);
    store.setActiveEndpointId('ep1');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'llama3' }] }),
    });

    const modal = mountModal();
    await modal._fetchModels('ep1');

    const card = modal.el.querySelector('.endpoint-card[data-endpoint-id="ep1"]');
    const epModels = card?.querySelector('.ep-models');
    expect(epModels?.classList.contains('hidden')).toBe(false);
    expect(epModels?.textContent).toContain('llama3');
  });

  it('does not close when clicking inside the modal panel while editing inputs', () => {
    const modal = mountModal();
    const panel = modal.el.querySelector('.modal-panel');
    const input = modal.el.querySelector('.ep-url');

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

  it('clears selected model when the endpoint URL changes to one without that model', () => {
    store.saveEndpoints([{ id: 'ep1', name: 'Local', baseUrl: 'http://a.local', apiKey: '' }]);
    store.saveAvailableModels('http://a.local', ['model-a']);
    store.setCurrentModel('http://a.local', 'model-a');
    store.setActiveEndpointId('ep1');

    const modal = mountModal();
    // Change the URL in the first endpoint card
    const urlInput = modal.el.querySelector('.ep-url');
    urlInput.value = 'http://b.local';
    modal.el.querySelector('#settings-save').click();

    // Active endpoint should now have b.local
    expect(store.getActiveEndpoint().baseUrl).toBe('http://b.local');
    expect(store.getCurrentModel('http://b.local')).toBe('');
  });

  it('shows multiple endpoint cards when multiple endpoints are configured', () => {
    store.saveEndpoints([
      { id: 'ep1', name: 'Local', baseUrl: 'http://a.local', apiKey: '' },
      { id: 'ep2', name: 'Remote', baseUrl: 'http://b.remote', apiKey: 'sk-xyz' },
    ]);

    const modal = mountModal();
    const cards = modal.el.querySelectorAll('.endpoint-card');
    expect(cards).toHaveLength(2);
  });

  it('adds a new endpoint card when Add Endpoint is clicked', () => {
    store.saveEndpoints([{ id: 'ep1', name: 'Local', baseUrl: 'http://a.local', apiKey: '' }]);

    const modal = mountModal();
    modal.el.querySelector('#add-endpoint-btn').click();

    const cards = modal.el.querySelectorAll('.endpoint-card');
    expect(cards).toHaveLength(2);
  });
});
