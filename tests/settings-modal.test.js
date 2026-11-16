import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from '../src/components/settings-modal.js';
import { store } from '../src/store.js';

const mountedModals = [];
afterEach(() => {
  for (const modal of mountedModals.splice(0)) modal.hide();
});

function mountModal() {
  const modal = new SettingsModal();
  mountedModals.push(modal);
  modal.render();
  modal.show();
  return modal;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('SettingsModal', () => {
  it('loads and saves the optional device metrics URL', () => {
    store.saveSettings({ deviceMetricsUrl: 'http://10.126.35.46:8888/api/all' });
    const modal = mountModal();
    const input = modal.el.querySelector('#settings-device-metrics-url');

    expect(input.value).toBe('http://10.126.35.46:8888/api/all');

    input.value = 'http://10.126.35.46:8888/api/all/';
    modal.el.querySelector('#settings-save').click();

    expect(store.getSettings().deviceMetricsUrl).toBe('http://10.126.35.46:8888/api/all');
  });

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

  it('shows the Speak capability switch for TTS models', () => {
    store.saveEndpoints([{ id: 'ep1', name: 'VoxCPM2', baseUrl: 'http://a.local', apiKey: '' }]);
    store.saveAvailableModels('http://a.local', ['voxcpm2']);

    const modal = mountModal();
    const card = modal.el.querySelector('.endpoint-card[data-endpoint-id="ep1"]');
    const checkbox = card?.querySelector('[data-model="voxcpm2"] [data-cap="tts"]');

    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(true);
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

  it('Set Active button switches the active endpoint and re-renders', () => {
    store.saveEndpoints([
      { id: 'ep1', name: 'Local', baseUrl: 'http://a.local', apiKey: '' },
      { id: 'ep2', name: 'Remote', baseUrl: 'http://b.remote', apiKey: 'sk-xyz' },
    ]);
    store.setActiveEndpointId('ep1');

    const modal = mountModal();
    // ep2 card should have a "Use" button (not active)
    const ep2Card = modal.el.querySelector('.endpoint-card[data-endpoint-id="ep2"]');
    const useBtn = ep2Card.querySelector('.ep-set-active-btn');
    expect(useBtn).not.toBeNull();
    expect(useBtn.textContent).toBe('Use');

    useBtn.click();

    expect(store.getActiveEndpointId()).toBe('ep2');
    // ep2 card should now show "Active" badge
    const ep2CardAfter = modal.el.querySelector('.endpoint-card[data-endpoint-id="ep2"]');
    expect(ep2CardAfter.textContent).toContain('Active');
    expect(ep2CardAfter.querySelector('.ep-set-active-btn')).toBeNull();
  });

  it('API key toggle changes input type between password and text', () => {
    store.saveEndpoints([{ id: 'ep1', name: 'Local', baseUrl: 'http://a.local', apiKey: 'sk-abc' }]);

    const modal = mountModal();
    const card = modal.el.querySelector('.endpoint-card[data-endpoint-id="ep1"]');
    const keyInput = card.querySelector('.ep-key');
    const toggleBtn = card.querySelector('.ep-key-toggle');

    expect(keyInput.type).toBe('password');
    toggleBtn.click();
    expect(keyInput.type).toBe('text');
    toggleBtn.click();
    expect(keyInput.type).toBe('password');
  });

  it('name header display updates live as user types in name input', () => {
    store.saveEndpoints([{ id: 'ep1', name: 'Old Name', baseUrl: 'http://a.local', apiKey: '' }]);

    const modal = mountModal();
    const card = modal.el.querySelector('.endpoint-card[data-endpoint-id="ep1"]');
    const nameInput = card.querySelector('.ep-name');
    const nameDisplay = card.querySelector('.ep-name-display');

    nameInput.value = 'New Display Name';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(nameDisplay.textContent).toBe('New Display Name');
  });

  it('fetch status shows model count after successful fetch', async () => {
    store.saveEndpoints([{ id: 'ep1', name: 'Local', baseUrl: 'http://a.local', apiKey: '' }]);
    store.setActiveEndpointId('ep1');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'model-a' }, { id: 'model-b' }] }),
    });

    const modal = mountModal();
    await modal._fetchModels('ep1');

    const card = modal.el.querySelector('.endpoint-card[data-endpoint-id="ep1"]');
    const statusEl = card.querySelector('.ep-fetch-status');
    expect(statusEl.textContent).toBe('2 models loaded');
  });
});

describe('default context window settings', () => {
  it('shows the 256Ki default and restores it when cleared and saved', () => {
    const modal = mountModal();
    const input = modal.el.querySelector('#settings-context-limit');
    expect(input.value).toBe('262144');
    expect(input.placeholder).toBe('262144');
    expect(modal.el.querySelector('#settings-context-threshold').value).toBe('85');
    input.value = '';
    modal.el.querySelector('#settings-save').click();
    expect(store.getSettings().contextLimitTokens).toBe(262144);
    expect(store.getSettings().contextResetThresholdPercent).toBe(85);
    modal.hide();
    modal.show();
    expect(input.value).toBe('262144');
  });

  it('shows and retains an existing explicit 4096-token setting', () => {
    store.saveSettings({ contextLimitTokens: 4096 });
    const modal = mountModal();
    expect(modal.el.querySelector('#settings-context-limit').value).toBe('4096');
    modal.el.querySelector('#settings-save').click();
    expect(store.getSettings().contextLimitTokens).toBe(4096);
  });
});

describe('Settings keyboard accessibility', () => {
  function key(modal, key, extra = {}) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
    document.activeElement.dispatchEvent(event);
    return event;
  }

  it('labels the dialog, focuses it, wraps Tab and restores the trigger and inert state', () => {
    const trigger = document.createElement('button');
    const existingInert = document.createElement('section');
    existingInert.setAttribute('inert', 'original');
    document.body.append(trigger, existingInert);
    trigger.focus();
    const modal = mountModal();
    expect(modal.el.getAttribute('role')).toBe('dialog');
    expect(modal.el.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(modal.el.getAttribute('aria-labelledby')).textContent).toBe('Settings');
    expect(document.activeElement.id).toBe('settings-close');
    expect(trigger.inert).toBe(true);
    expect(modal.el.hasAttribute('inert')).toBe(false);
    key(modal, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(modal._focusableControls().at(-1));
    key(modal, 'Tab');
    expect(document.activeElement.id).toBe('settings-close');
    key(modal, 'Escape');
    expect(modal.visible).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(trigger.hasAttribute('inert')).toBe(false);
    expect(existingInert.getAttribute('inert')).toBe('original');
  });

  it('excludes collapsed, hidden, disabled and negative-tabindex controls and adapts dynamically', () => {
    store.saveAvailableModels('http://127.0.0.1:8000', ['a']);
    const modal = mountModal();
    const fixture = document.createElement('details');
    fixture.innerHTML = '<summary>Advanced</summary><label><select><option>a</option></select></label>';
    modal.el.querySelector('.modal-panel').append(fixture);
    const select = fixture.querySelector('select');
    expect(modal._focusableControls()).not.toContain(select);
    const summary = fixture.querySelector('summary');
    expect(modal._focusableControls()).toContain(summary);
    fixture.open = true;
    expect(modal._focusableControls()).toContain(select);
    const fetch = modal.el.querySelector('.ep-fetch-btn');
    fetch.disabled = true;
    const keyToggle = modal.el.querySelector('.ep-key-toggle');
    expect(modal._focusableControls()).toContain(keyToggle);
    keyToggle.tabIndex = -1;
    expect(modal._focusableControls()).not.toContain(keyToggle);
    select.closest('label').hidden = true;
    expect(modal._focusableControls()).not.toContain(select);
    expect(modal._focusableControls()).not.toContain(fetch);
  });

  it('ignores Escape while composing and handles backdrop focus restoration', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const modal = mountModal();
    key(modal, 'Escape', { isComposing: true });
    expect(modal.visible).toBe(true);
    key(modal, 'Escape', { keyCode: 229 });
    expect(modal.visible).toBe(true);
    document.activeElement.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    key(modal, 'Escape');
    expect(modal.visible).toBe(true);
    document.activeElement.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    modal.el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    modal.el.click();
    expect(modal.visible).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('guards outside focus, preserves focus on endpoint rerenders and focuses new cards', () => {
    const outside = document.createElement('input');
    document.body.append(outside);
    const modal = mountModal();
    outside.focus();
    expect(modal.el.contains(document.activeElement)).toBe(true);
    modal.el.querySelector('.ep-name').focus();
    modal._renderEndpointCards();
    expect(document.activeElement.classList.contains('ep-name')).toBe(true);
    modal.el.querySelector('#add-endpoint-btn').click();
    expect(document.activeElement).toBe(modal.el.querySelector('.endpoint-card:last-child .ep-name'));
    modal.el.querySelector('.endpoint-card:last-child .ep-remove-btn').focus();
    document.activeElement.click();
    expect(modal.el.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('repeated show/hide keeps one keyboard handler and falls back when trigger is removed', () => {
    const trigger = document.createElement('button');
    const fallback = document.createElement('button');
    document.body.append(trigger, fallback);
    trigger.focus();
    const modal = mountModal();
    modal.show();
    key(modal, 'Tab');
    expect(document.activeElement.id).toBe('add-endpoint-btn');
    modal.hide();
    fallback.focus();
    key(modal, 'Tab');
    expect(document.activeElement).toBe(fallback);
    trigger.focus();
    modal.show();
    trigger.remove();
    key(modal, 'Escape');
    expect(document.activeElement).toBe(fallback);
    modal.show();
    key(modal, 'Tab');
    expect(document.activeElement.id).toBe('add-endpoint-btn');
  });
});

it('renders endpoint credentials, identifiers, model names and fetch errors as text', async () => {
  const attack = '"><img src=x onerror=alert(1)>';
  store.saveEndpoints([{ id: attack, name: attack, baseUrl: 'http://a.local', apiKey: attack }]);
  store.saveAvailableModels('http://a.local', [attack]);
  const modal = mountModal();
  expect(modal.el.querySelector('img')).toBeNull();
  expect(modal.el.querySelector('.ep-name').value).toBe(attack);
  expect(modal.el.querySelector('[data-model]').dataset.model).toBe(attack);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(attack); }));
  try {
    await modal._fetchModels(attack);
    expect(modal.el.querySelector('img')).toBeNull();
    expect(modal.el.querySelector('.ep-models').textContent).toContain(attack);
  } finally {
    vi.unstubAllGlobals();
  }
});
