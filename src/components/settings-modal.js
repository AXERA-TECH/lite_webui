import { store } from '../store.js';
import { DEFAULT_CAPABILITIES } from '../capabilities.js';
import { fetchModels } from '../api.js';
import {
  DEFAULT_CONTEXT_LIMIT_TOKENS,
  DEFAULT_CONTEXT_RESET_THRESHOLD_PERCENT,
} from '../context.js';
import { icon } from '../icons.js';

export class SettingsModal {
  constructor() {
    this.el = null;
    this.visible = false;
    this._fetchedModels = [];
  }

  render() {
    const el = document.createElement('div');
    el.innerHTML = this._template();
    this.el = el.firstElementChild;
    this._bindEvents();
    return this.el;
  }

  _template() {
    return `
      <div class="modal-backdrop fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 pb-8" style="background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);">
        <div class="modal-panel bg-[var(--c-card)] border border-[var(--c-bd)] rounded-lg w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
          <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--c-bd)] flex-shrink-0">
            <h2 class="text-[var(--c-tx)] font-semibold text-base">Settings</h2>
            <button id="settings-close" class="text-[var(--c-tx3)] hover:text-[var(--c-tx)] transition-colors p-1 rounded" aria-label="Close settings">
              ${icon('x')}
            </button>
          </div>
          <div class="overflow-y-auto flex-1 px-5 py-4 space-y-6">
            <!-- API Config -->
            <section>
              <h3 class="text-[var(--c-tx3)] font-medium text-sm mb-3 uppercase tracking-wide">API Configuration</h3>
              <div class="space-y-3">
                <div>
                  <label class="block text-sm text-[var(--c-tx3)] mb-1" for="settings-base-url">API Base URL</label>
                  <input id="settings-base-url" type="url" class="w-full bg-[var(--c-sf)] border border-[var(--c-bd)] rounded px-3 py-2 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" placeholder="https://api.openai.com" />
                </div>
                <div>
                  <label class="block text-sm text-[var(--c-tx3)] mb-1" for="settings-api-key">API Key</label>
                  <input id="settings-api-key" type="password" class="w-full bg-[var(--c-sf)] border border-[var(--c-bd)] rounded px-3 py-2 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" placeholder="sk-..." />
                </div>
                <div>
                  <label class="block text-sm text-[var(--c-tx3)] mb-1" for="settings-context-limit">Max Context Tokens</label>
                  <input id="settings-context-limit" type="number" min="1024" step="1024" class="w-full bg-[var(--c-sf)] border border-[var(--c-bd)] rounded px-3 py-2 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" placeholder="${DEFAULT_CONTEXT_LIMIT_TOKENS}" />
                  <p class="mt-1 text-xs text-[var(--c-tx3)]">This value is used directly for the context badge and auto-reset logic. For on-device models, set the exact limit here.</p>
                </div>
                <div>
                  <label class="block text-sm text-[var(--c-tx3)] mb-1" for="settings-context-threshold">Auto-reset Threshold (%)</label>
                  <input id="settings-context-threshold" type="number" min="50" max="95" step="1" class="w-full bg-[var(--c-sf)] border border-[var(--c-bd)] rounded px-3 py-2 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" placeholder="${DEFAULT_CONTEXT_RESET_THRESHOLD_PERCENT}" />
                  <p class="mt-1 text-xs text-[var(--c-tx3)]">Resets the API context before a send when estimated usage reaches this percentage of the configured window.</p>
                </div>
                <button id="settings-save" class="bg-[var(--c-tx)] text-[var(--c-bg)] font-medium text-sm px-4 py-2 rounded hover:opacity-90 transition-opacity">Save Settings</button>
              </div>
            </section>

            <!-- Model Capabilities -->
            <section>
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-[var(--c-tx3)] font-medium text-sm uppercase tracking-wide">Model Capabilities</h3>
                <button id="fetch-models-btn" class="flex items-center gap-1.5 text-xs text-[var(--c-tx3)] hover:text-[var(--c-tx)] border border-[var(--c-bd)] rounded px-3 py-1.5 transition-colors">
                  ${icon('refresh')} Fetch Models
                </button>
              </div>
              <div id="model-caps-list" class="space-y-1">
                <!-- Populated dynamically -->
              </div>
            </section>
          </div>
        </div>
      </div>
    `;
  }

  _bindEvents() {
    this.el.querySelector('#settings-close').addEventListener('click', () => this.hide());
    this.el.addEventListener('mousedown', (e) => {
      if (e.target === this.el) {
        this._backdropMouseDown = true;
      } else {
        this._backdropMouseDown = false;
      }
    });
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el && this._backdropMouseDown) this.hide();
      this._backdropMouseDown = false;
    });

    this.el.querySelector('#settings-save').addEventListener('click', () => this._saveSettings());
    this.el.querySelector('#fetch-models-btn').addEventListener('click', () => this._fetchModels());

    // Load current values
    this._loadValues();
    this._renderModelCaps();
  }

  _loadValues() {
    const settings = store.getSettings();
    this.el.querySelector('#settings-base-url').value = settings.baseUrl || '';
    this.el.querySelector('#settings-api-key').value = settings.apiKey || '';
    this.el.querySelector('#settings-context-limit').value = settings.contextLimitTokens || '';
    this.el.querySelector('#settings-context-threshold').value =
      settings.contextResetThresholdPercent || DEFAULT_CONTEXT_RESET_THRESHOLD_PERCENT;
    this._fetchedModels = store.getAvailableModels(settings.baseUrl);
  }

  _saveSettings() {
    const previousBaseUrl = store.getSettings().baseUrl;
    const baseUrl = this.el.querySelector('#settings-base-url').value.trim() || 'https://api.openai.com';
    const apiKey = this.el.querySelector('#settings-api-key').value.trim();
    const rawContextLimit = this.el.querySelector('#settings-context-limit').value.trim();
    const contextLimitTokens = rawContextLimit
      ? Math.max(1024, Math.round(Number(rawContextLimit) || DEFAULT_CONTEXT_LIMIT_TOKENS))
      : DEFAULT_CONTEXT_LIMIT_TOKENS;
    const rawThreshold = Number(this.el.querySelector('#settings-context-threshold').value);
    const contextResetThresholdPercent = Number.isFinite(rawThreshold)
      ? Math.min(95, Math.max(50, Math.round(rawThreshold)))
      : DEFAULT_CONTEXT_RESET_THRESHOLD_PERCENT;

    store.saveSettings({
      ...store.getSettings(),
      baseUrl,
      apiKey,
      contextLimitTokens,
      contextResetThresholdPercent,
    });

    this._fetchedModels = store.getAvailableModels(baseUrl);
    const availableModels = store.getAvailableModels(baseUrl);
    const currentModel = store.getCurrentModel(baseUrl);
    if (previousBaseUrl !== baseUrl && !availableModels.length) {
      store.setCurrentModel(baseUrl, '');
      document.dispatchEvent(new CustomEvent('model:changed', { detail: { model: '' } }));
    } else if (currentModel && !availableModels.includes(currentModel)) {
      store.setCurrentModel(baseUrl, '');
      document.dispatchEvent(new CustomEvent('model:changed', { detail: { model: '' } }));
    }

    const btn = this.el.querySelector('#settings-save');
    btn.textContent = 'Saved!';
    setTimeout(() => { btn.textContent = 'Save Settings'; }, 2000);

    document.dispatchEvent(new CustomEvent('settings:changed'));
    document.dispatchEvent(new CustomEvent('models:changed'));
  }

  async _fetchModels() {
    const btn = this.el.querySelector('#fetch-models-btn');
    const settings = store.getSettings();
    btn.disabled = true;
    btn.innerHTML = `<span class="opacity-60">Fetching...</span>`;
    try {
      const models = await fetchModels(settings.baseUrl, settings.apiKey);
      this._fetchedModels = models;
       store.saveAvailableModels(settings.baseUrl, models);
       const currentModel = store.getCurrentModel(settings.baseUrl);
       if (currentModel && !models.includes(currentModel)) {
         store.setCurrentModel(settings.baseUrl, '');
         document.dispatchEvent(new CustomEvent('model:changed', { detail: { model: '' } }));
       }
      this._renderModelCaps(models);
      document.dispatchEvent(new CustomEvent('models:changed'));
    } catch (err) {
      this.el.querySelector('#model-caps-list').innerHTML =
        `<p class="text-sm text-red-400">Failed to fetch: ${err.message}</p>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('refresh')} Fetch Models`;
    }
  }

  _renderModelCaps(extraModels = []) {
    const container = this.el.querySelector('#model-caps-list');
    const userCaps = store.getModelCapabilities();
    const allModelIds = new Set(extraModels);

    const rows = [...allModelIds].sort().map(modelId => {
      const base = DEFAULT_CAPABILITIES[modelId] || { text: true, image: false, audio: false, imageGen: false };
      const override = userCaps[modelId] || {};
      const caps = { ...base, ...override };
      return `
        <div class="flex items-center justify-between py-2 border-b border-[var(--c-bd)] gap-2" data-model="${modelId}">
          <span class="text-sm text-[var(--c-tx2)] truncate flex-1">${modelId}</span>
          <div class="flex items-center gap-3 flex-shrink-0">
            <label class="flex items-center gap-1 text-xs text-[var(--c-tx3)] cursor-pointer">
              <input type="checkbox" class="cap-check accent-current" data-cap="image" ${caps.image ? 'checked' : ''} />
              Vision
            </label>
            <label class="flex items-center gap-1 text-xs text-[var(--c-tx3)] cursor-pointer">
              <input type="checkbox" class="cap-check accent-current" data-cap="audio" ${caps.audio ? 'checked' : ''} />
              Audio
            </label>
            <label class="flex items-center gap-1 text-xs text-[var(--c-tx3)] cursor-pointer">
              <input type="checkbox" class="cap-check accent-current" data-cap="imageGen" ${caps.imageGen ? 'checked' : ''} />
              Draw
            </label>
          </div>
        </div>
      `;
    });

    container.innerHTML = rows.join('') || '<p class="text-sm text-[var(--c-tx3)]">No models found. Fetch models or use defaults.</p>';

    // Bind changes
    container.querySelectorAll('.cap-check').forEach(cb => {
      cb.addEventListener('change', () => this._saveCapChange(cb));
    });
  }

  _saveCapChange(checkbox) {
    const row = checkbox.closest('[data-model]');
    const modelId = row.dataset.model;
    const cap = checkbox.dataset.cap;
    const userCaps = store.getModelCapabilities();
    if (!userCaps[modelId]) {
      const base = DEFAULT_CAPABILITIES[modelId] || { text: true, image: false, audio: false };
      userCaps[modelId] = { ...base };
    }
    userCaps[modelId][cap] = checkbox.checked;
    store.saveModelCapabilities(store.getSettings().baseUrl, userCaps);
    document.dispatchEvent(new CustomEvent('caps:changed'));
  }

  show() {
    if (!this.el) return;
    this._loadValues();
    this._renderModelCaps(this._fetchedModels);
    document.body.appendChild(this.el);
    this.visible = true;
  }

  hide() {
    if (this.el && this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
    this.visible = false;
  }

  toggle() {
    this.visible ? this.hide() : this.show();
  }
}
