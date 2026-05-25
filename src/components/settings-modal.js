import { store } from '../store.js';
import { DEFAULT_CAPABILITIES } from '../capabilities.js';
import { fetchModels } from '../api.js';
import {
  DEFAULT_CONTEXT_LIMIT_TOKENS,
  DEFAULT_CONTEXT_RESET_THRESHOLD_PERCENT,
} from '../context.js';
import { icon } from '../icons.js';

function genId() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

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
      <div class="modal-backdrop fixed inset-0 z-50 flex items-start justify-center pt-12 px-4 pb-8" style="background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);">
        <div class="modal-panel bg-[var(--c-card)] border border-[var(--c-bd)] rounded-xl w-full max-w-lg max-h-[84vh] flex flex-col shadow-2xl">
          <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--c-bd)] flex-shrink-0">
            <h2 class="text-[var(--c-tx)] font-semibold text-base">Settings</h2>
            <button id="settings-close" class="text-[var(--c-tx3)] hover:text-[var(--c-tx)] transition-colors p-1 rounded" aria-label="Close settings">
              ${icon('x')}
            </button>
          </div>
          <div class="overflow-y-auto flex-1 px-5 py-5 space-y-7">
            <!-- API Endpoints -->
            <section>
              <h3 class="text-[11px] font-semibold text-[var(--c-tx3)] uppercase tracking-widest mb-3">API Endpoints</h3>
              <div id="endpoints-list" class="space-y-2.5"></div>
              <button id="add-endpoint-btn" class="mt-3 w-full flex items-center justify-center gap-1.5 text-sm text-[var(--c-tx3)] hover:text-[var(--c-tx)] border border-dashed border-[var(--c-bd)] hover:border-[var(--c-bd-hi)] rounded-xl py-2.5 transition-colors">
                ${icon('plus')} Add Endpoint
              </button>
            </section>
            <!-- Context Window -->
            <section class="border-t border-[var(--c-bd)] pt-6">
              <h3 class="text-[11px] font-semibold text-[var(--c-tx3)] uppercase tracking-widest mb-3">Context Window</h3>
              <div class="space-y-3">
                <div>
                  <label class="block text-xs text-[var(--c-tx3)] mb-1.5" for="settings-context-limit">Max Context Tokens</label>
                  <input id="settings-context-limit" type="number" min="1024" step="1024" class="w-full bg-[var(--c-sf)] border border-[var(--c-bd)] rounded-lg px-3 py-2 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" placeholder="${DEFAULT_CONTEXT_LIMIT_TOKENS}" />
                  <p class="mt-1 text-xs text-[var(--c-tx3)]">Used for the context badge and auto-reset logic.</p>
                </div>
                <div>
                  <label class="block text-xs text-[var(--c-tx3)] mb-1.5" for="settings-context-threshold">Auto-reset Threshold (%)</label>
                  <input id="settings-context-threshold" type="number" min="50" max="95" step="1" class="w-full bg-[var(--c-sf)] border border-[var(--c-bd)] rounded-lg px-3 py-2 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" placeholder="${DEFAULT_CONTEXT_RESET_THRESHOLD_PERCENT}" />
                  <p class="mt-1 text-xs text-[var(--c-tx3)]">Resets API context when usage reaches this % of the configured window.</p>
                </div>
                <button id="settings-save" class="bg-[var(--c-tx)] text-[var(--c-bg)] font-medium text-sm px-4 py-2 rounded-lg hover:opacity-90 transition-opacity">Save Settings</button>
              </div>
            </section>
          </div>
        </div>
      </div>
    `;
  }

  _endpointCardHtml(ep) {
    const models = store.getAvailableModels(ep.baseUrl);
    const modelsHtml = models.length ? this._inlineCapsHtml(ep.baseUrl, models) : '';
    const isActive = store.getActiveEndpointId() === ep.id;
    const canRemove = store.getEndpoints().length > 1;
    const statusText = models.length ? `${models.length} model${models.length !== 1 ? 's' : ''} loaded` : '';

    const activeBadge = isActive
      ? `<span class="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 font-medium flex-shrink-0 select-none">Active</span>`
      : `<button class="ep-set-active-btn text-[11px] px-2 py-0.5 rounded-full border border-[var(--c-bd)] text-[var(--c-tx3)] hover:border-[var(--c-bd-hi)] hover:text-[var(--c-tx)] transition-colors flex-shrink-0">Use</button>`;

    const removeBtn = canRemove
      ? `<button class="ep-remove-btn text-[var(--c-tx3)] hover:text-red-400 transition-colors p-1 rounded flex-shrink-0" aria-label="Remove endpoint">${icon('trash')}</button>`
      : '';

    const borderClass = isActive ? 'border-[var(--c-bd-hi)]' : 'border-[var(--c-bd)]';

    return `
      <div class="endpoint-card border ${borderClass} rounded-xl overflow-hidden" data-endpoint-id="${ep.id}">
        <div class="flex items-center gap-2 px-3 py-2.5 bg-[var(--c-sf)]">
          <span class="w-2 h-2 rounded-full flex-shrink-0 transition-colors ${isActive ? 'bg-emerald-400' : 'bg-[var(--c-tx3)] opacity-30'}"></span>
          <span class="ep-name-display flex-1 text-sm font-medium text-[var(--c-tx)] truncate min-w-0">${ep.name || ep.baseUrl || 'New Endpoint'}</span>
          ${activeBadge}
          ${removeBtn}
        </div>
        <div class="px-3.5 py-3 space-y-3 border-t border-[var(--c-bd)]">
          <div>
            <label class="block text-[11px] font-semibold text-[var(--c-tx3)] uppercase tracking-wider mb-1.5">Name</label>
            <input class="ep-name w-full bg-[var(--c-card)] border border-[var(--c-bd)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" placeholder="My Local Server" value="${ep.name || ''}" />
          </div>
          <div>
            <label class="block text-[11px] font-semibold text-[var(--c-tx3)] uppercase tracking-wider mb-1.5">API Base URL</label>
            <input class="ep-url w-full bg-[var(--c-card)] border border-[var(--c-bd)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" type="url" placeholder="http://127.0.0.1:8000" value="${ep.baseUrl || ''}" />
          </div>
          <div>
            <label class="block text-[11px] font-semibold text-[var(--c-tx3)] uppercase tracking-wider mb-1.5">
              API Key <span class="normal-case font-normal opacity-60 tracking-normal">optional</span>
            </label>
            <div class="relative">
              <input class="ep-key w-full bg-[var(--c-card)] border border-[var(--c-bd)] rounded-lg px-2.5 py-1.5 pr-9 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" type="password" placeholder="sk-… (leave blank for local servers)" value="${ep.apiKey || ''}" />
              <button class="ep-key-toggle absolute right-2 top-1/2 -translate-y-1/2 text-[var(--c-tx3)] hover:text-[var(--c-tx)] transition-colors p-0.5 rounded" type="button" tabindex="-1" aria-label="Toggle API key visibility">
                ${icon('eye')}
              </button>
            </div>
          </div>
          <div class="flex items-center justify-between gap-3 pt-0.5">
            <button class="ep-fetch-btn flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-[var(--c-bd)] text-[var(--c-tx)] hover:border-[var(--c-bd-hi)] hover:bg-[var(--c-sf)] transition-colors" title="Auto-saves this endpoint and fetches its models">
              ${icon('refresh')} Fetch Models
            </button>
            <span class="ep-fetch-status text-xs text-[var(--c-tx3)] flex-shrink-0">${statusText}</span>
          </div>
          <div class="ep-models${models.length ? '' : ' hidden'}" data-ep-url="${ep.baseUrl || ''}">${modelsHtml}</div>
        </div>
      </div>
    `;
  }

  /** Renders capability checkboxes for a list of models (scoped to baseUrl). */
  _inlineCapsHtml(baseUrl, models) {
    const userCaps = store.getModelCapabilities(baseUrl);
    const rows = [...models].sort().map(modelId => {
      const base = DEFAULT_CAPABILITIES[modelId] || { text: true, image: false, audio: false, imageGen: false };
      const override = userCaps[modelId] || {};
      const caps = { ...base, ...override };
      return `
        <div class="flex items-center justify-between py-1.5 border-b border-[var(--c-bd)] last:border-0 gap-2" data-model="${modelId}">
          <span class="text-xs text-[var(--c-tx2)] truncate flex-1" title="${modelId}">${modelId}</span>
          <div class="flex items-center gap-3 flex-shrink-0">
            <label class="flex items-center gap-1 text-xs text-[var(--c-tx3)] cursor-pointer">
              <input type="checkbox" class="cap-check accent-current" data-cap="image" ${caps.image ? 'checked' : ''} /> Vision
            </label>
            <label class="flex items-center gap-1 text-xs text-[var(--c-tx3)] cursor-pointer">
              <input type="checkbox" class="cap-check accent-current" data-cap="audio" ${caps.audio ? 'checked' : ''} /> Audio
            </label>
            <label class="flex items-center gap-1 text-xs text-[var(--c-tx3)] cursor-pointer">
              <input type="checkbox" class="cap-check accent-current" data-cap="imageGen" ${caps.imageGen ? 'checked' : ''} /> Draw
            </label>
          </div>
        </div>
      `;
    });
    return `
      <div class="pt-2 border-t border-[var(--c-bd)]">
        <p class="text-xs text-[var(--c-tx3)] mb-1.5">${models.length} model${models.length !== 1 ? 's' : ''} — set capabilities:</p>
        ${rows.join('')}
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
    this.el.querySelector('#add-endpoint-btn').addEventListener('click', () => this._addEndpoint());

    this._loadValues();
  }

  _loadValues() {
    const settings = store.getSettings();
    this.el.querySelector('#settings-context-limit').value = settings.contextLimitTokens || '';
    this.el.querySelector('#settings-context-threshold').value =
      settings.contextResetThresholdPercent || DEFAULT_CONTEXT_RESET_THRESHOLD_PERCENT;

    this._renderEndpointCards();

    const eps = store.getEndpoints();
    this._fetchedModels = eps.flatMap(ep => store.getAvailableModels(ep.baseUrl));
  }

  _renderEndpointCards() {
    const list = this.el.querySelector('#endpoints-list');
    const eps = store.getEndpoints();
    list.innerHTML = eps.map(ep => this._endpointCardHtml(ep)).join('');
    this._bindEndpointCardEvents(list);
  }

  _bindEndpointCardEvents(container) {
    container.querySelectorAll('.endpoint-card').forEach(card => {
      const epId = card.dataset.endpointId;

      card.querySelector('.ep-fetch-btn').addEventListener('click', () => this._fetchModels(epId));

      // Live-update header name display as user types
      const nameInput = card.querySelector('.ep-name');
      const nameDisplay = card.querySelector('.ep-name-display');
      if (nameInput && nameDisplay) {
        nameInput.addEventListener('input', () => {
          const urlInput = card.querySelector('.ep-url');
          nameDisplay.textContent = nameInput.value.trim() || urlInput?.value.trim() || 'New Endpoint';
        });
      }

      // API key show/hide toggle
      const keyInput = card.querySelector('.ep-key');
      const keyToggle = card.querySelector('.ep-key-toggle');
      if (keyInput && keyToggle) {
        keyToggle.addEventListener('click', () => {
          const isHidden = keyInput.type === 'password';
          keyInput.type = isHidden ? 'text' : 'password';
          keyToggle.innerHTML = icon(isHidden ? 'eyeOff' : 'eye');
        });
      }

      // Set as active endpoint
      const setActiveBtn = card.querySelector('.ep-set-active-btn');
      if (setActiveBtn) {
        setActiveBtn.addEventListener('click', () => {
          this._saveEndpointCard(card);
          store.setActiveEndpointId(epId);
          this._renderEndpointCards();
          document.dispatchEvent(new CustomEvent('settings:changed'));
        });
      }

      // Bind any pre-existing capability checkboxes (from previously fetched models)
      this._bindCapCheckboxes(card.querySelector('.ep-models'));

      const removeBtn = card.querySelector('.ep-remove-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          const eps = store.getEndpoints();
          if (eps.length <= 1) return;
          const filtered = eps.filter(e => e.id !== epId);
          store.saveEndpoints(filtered);
          if (store.getActiveEndpointId() === epId) {
            store.setActiveEndpointId(filtered[0].id);
          }
          this._renderEndpointCards();
          document.dispatchEvent(new CustomEvent('settings:changed'));
          document.dispatchEvent(new CustomEvent('models:changed'));
        });
      }
    });
  }

  /** Binds capability checkbox change handlers within an ep-models container. */
  _bindCapCheckboxes(container) {
    if (!container) return;
    container.querySelectorAll('.cap-check').forEach(cb => {
      cb.addEventListener('change', () => this._saveCapChange(cb));
    });
  }

  _addEndpoint() {
    const eps = store.getEndpoints();
    const newEp = { id: genId(), name: `Endpoint ${eps.length + 1}`, baseUrl: '', apiKey: '' };
    store.saveEndpoints([...eps, newEp]);
    this._renderEndpointCards();
  }

  /** Reads one endpoint card's inputs and persists them to the store. Returns the updated endpoint object. */
  _saveEndpointCard(card) {
    const epId = card.dataset.endpointId;
    const eps = store.getEndpoints();
    const idx = eps.findIndex(e => e.id === epId);
    const updated = {
      id: epId,
      name: card.querySelector('.ep-name').value.trim() || 'Endpoint',
      baseUrl: card.querySelector('.ep-url').value.trim() || 'http://127.0.0.1:8000',
      apiKey: card.querySelector('.ep-key').value.trim(),
    };
    if (idx >= 0) {
      eps[idx] = updated;
      store.saveEndpoints(eps);
    }
    return updated;
  }

  _readEndpointCards() {
    const cards = this.el.querySelectorAll('.endpoint-card');
    return Array.from(cards).map(card => ({
      id: card.dataset.endpointId,
      name: card.querySelector('.ep-name').value.trim() || 'Endpoint',
      baseUrl: card.querySelector('.ep-url').value.trim() || 'http://127.0.0.1:8000',
      apiKey: card.querySelector('.ep-key').value.trim(),
    }));
  }

  _saveSettings() {
    const rawContextLimit = this.el.querySelector('#settings-context-limit').value.trim();
    const contextLimitTokens = rawContextLimit
      ? Math.max(1024, Math.round(Number(rawContextLimit) || DEFAULT_CONTEXT_LIMIT_TOKENS))
      : DEFAULT_CONTEXT_LIMIT_TOKENS;
    const rawThreshold = Number(this.el.querySelector('#settings-context-threshold').value);
    const contextResetThresholdPercent = Number.isFinite(rawThreshold)
      ? Math.min(95, Math.max(50, Math.round(rawThreshold)))
      : DEFAULT_CONTEXT_RESET_THRESHOLD_PERCENT;

    const endpoints = this._readEndpointCards();
    store.saveEndpoints(endpoints);

    const activeEp = store.getActiveEndpoint();
    store.saveSettings({
      ...store.getSettings(),
      baseUrl: activeEp?.baseUrl || 'http://127.0.0.1:8000',
      apiKey: activeEp?.apiKey || '',
      contextLimitTokens,
      contextResetThresholdPercent,
    });

    const btn = this.el.querySelector('#settings-save');
    btn.textContent = 'Saved!';
    setTimeout(() => { btn.textContent = 'Save Settings'; }, 2000);

    document.dispatchEvent(new CustomEvent('settings:changed'));
    document.dispatchEvent(new CustomEvent('models:changed'));
  }

  async _fetchModels(endpointId = null) {
    let ep;
    const card = endpointId
      ? this.el?.querySelector(`.endpoint-card[data-endpoint-id="${endpointId}"]`)
      : null;

    if (card) {
      // Auto-save this endpoint's inputs before fetching so the store stays in sync
      ep = this._saveEndpointCard(card);
      // Also keep the active settings baseUrl up to date if this is the active endpoint
      const activeId = store.getActiveEndpointId();
      if (!activeId || activeId === endpointId) {
        store.saveSettings({ ...store.getSettings(), baseUrl: ep.baseUrl, apiKey: ep.apiKey });
      }
    } else {
      ep = store.getActiveEndpoint();
    }
    if (!ep) return;

    const btn = card?.querySelector('.ep-fetch-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="opacity-60">Fetching…</span>`;
    }

    try {
      const models = await fetchModels(ep.baseUrl, ep.apiKey);
      this._fetchedModels = [...new Set([...this._fetchedModels, ...models])];
      store.saveAvailableModels(ep.baseUrl, models);
      const currentModel = store.getCurrentModel(ep.baseUrl);
      if (currentModel && !models.includes(currentModel)) {
        store.setCurrentModel(ep.baseUrl, '');
        document.dispatchEvent(new CustomEvent('model:changed', { detail: { model: '' } }));
      }

      // Update inline caps section in this card
      if (card) {
        const epModels = card.querySelector('.ep-models');
        if (epModels) {
          epModels.dataset.epUrl = ep.baseUrl;
          epModels.innerHTML = this._inlineCapsHtml(ep.baseUrl, models);
          epModels.classList.remove('hidden');
          this._bindCapCheckboxes(epModels);
          if (typeof epModels.scrollIntoView === 'function') {
            epModels.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
        // Update status text
        const statusEl = card.querySelector('.ep-fetch-status');
        if (statusEl) {
          statusEl.textContent = `${models.length} model${models.length !== 1 ? 's' : ''} loaded`;
        }
      }

      document.dispatchEvent(new CustomEvent('models:changed'));
    } catch (err) {
      if (card) {
        const epModels = card.querySelector('.ep-models');
        if (epModels) {
          epModels.innerHTML = `<p class="text-xs text-red-400 pt-2 border-t border-[var(--c-bd)]">Failed to fetch: ${err.message}</p>`;
          epModels.classList.remove('hidden');
        }
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `${icon('refresh')} Fetch Models`;
      }
    }
  }

  _saveCapChange(checkbox) {
    const row = checkbox.closest('[data-model]');
    const modelId = row.dataset.model;
    const cap = checkbox.dataset.cap;
    // Get the baseUrl from the ep-models container (set at fetch time)
    const epModels = checkbox.closest('[data-ep-url]');
    const baseUrl = epModels?.dataset.epUrl || store.getSettings().baseUrl;
    const userCaps = store.getModelCapabilities(baseUrl);
    if (!userCaps[modelId]) {
      const base = DEFAULT_CAPABILITIES[modelId] || { text: true, image: false, audio: false };
      userCaps[modelId] = { ...base };
    }
    userCaps[modelId][cap] = checkbox.checked;
    store.saveModelCapabilities(baseUrl, userCaps);
    document.dispatchEvent(new CustomEvent('caps:changed'));
  }

  show() {
    if (!this.el) return;
    this._loadValues();
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
