import { store } from '../store.js';
import { getCapabilities } from '../capabilities.js';
import { icon } from '../icons.js';

export class ModelPicker {
  constructor() {
    this.el = null;
    this.dropdownEl = null;
    this.open = false;
    this._endpointModels = [];
    this._currentModel = '';
  }

  render() {
    const el = document.createElement('div');
    el.className = 'relative';
    el.innerHTML = this._buttonTemplate();
    this.el = el;
    this._bindEvents();
    this._syncFromStore();
    return this.el;
  }

  _buttonTemplate() {
    const label = this._currentModel || 'Select a model';
    const isPlaceholder = !this._currentModel;
    const caps = this._currentModel ? getCapabilities(this._currentModel, store.getModelCapabilities()) : null;
    const badges = caps ? [
      caps.image ? '<span class="text-xs bg-[var(--c-hi)] text-[var(--c-tx3)] rounded px-1.5 py-0.5">Vision</span>' : '',
      caps.audio ? '<span class="text-xs bg-[var(--c-hi)] text-[var(--c-tx3)] rounded px-1.5 py-0.5">Audio</span>' : '',
    ].filter(Boolean).join('') : '';

    return `
      <button id="model-picker-btn" class="flex items-center gap-2 bg-[var(--c-top-el)] hover:bg-[var(--c-top-el-h)] border border-[var(--c-top-bd)] hover:border-[var(--c-bd-hi)] rounded-xl px-3 py-1.5 text-[13px] transition-all max-w-xs ${isPlaceholder ? 'text-[var(--c-tx3)]' : 'text-[var(--c-tx2)]'}" aria-haspopup="listbox" aria-expanded="false">
        <span class="truncate model-name">${label}</span>
        <span class="flex items-center gap-1 model-badges">${badges}</span>
        <span class="flex-shrink-0 opacity-40">${icon('chevronDown')}</span>
      </button>
    `;
  }

  _buildDropdown() {
    const div = document.createElement('div');
    div.className = 'dropdown-enter absolute left-0 top-full mt-1.5 z-30 bg-[var(--c-card)] border border-[var(--c-bd)] rounded-xl shadow-2xl shadow-black/30 overflow-hidden min-w-48 max-w-xs';
    div.setAttribute('role', 'listbox');

    const allModels = this._getAllModels();
    if (allModels.length === 0) {
      div.innerHTML = `<div class="px-4 py-5 text-[12px] text-[var(--c-tx3)] text-center leading-relaxed">No models found.<br>Save Settings, then fetch models.</div>`;
      return div;
    }

    const userCaps = store.getModelCapabilities();
    const multiEndpoint = this._endpointModels.filter(em => em.models.length > 0).length > 1;

    const sections = this._endpointModels
      .filter(em => em.models.length > 0)
      .map(em => {
        const header = multiEndpoint
          ? `<div class="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--c-tx3)] border-b border-[var(--c-bd)] mb-0.5">${em.endpointName}</div>`
          : '';

        const items = em.models.map(modelId => {
          const caps = getCapabilities(modelId, userCaps);
          const active = modelId === this._currentModel;
          const badges = [
            caps.image ? '<span class="text-[11px] bg-[var(--c-hi)] text-[var(--c-tx3)] rounded-md px-1.5 py-0.5">Vision</span>' : '',
            caps.audio ? '<span class="text-[11px] bg-[var(--c-hi)] text-[var(--c-tx3)] rounded-md px-1.5 py-0.5">Audio</span>' : '',
          ].filter(Boolean).join('');

          return `
            <button class="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-[13px] hover:bg-[var(--c-hi)] transition-all text-left ${active ? 'text-[var(--c-tx)] bg-[var(--c-hi)]' : 'text-[var(--c-tx2)]'}" role="option" aria-selected="${active}" data-model="${modelId}" data-endpoint-id="${em.endpointId}">
              <span class="truncate">${modelId}</span>
              <span class="flex items-center gap-1 flex-shrink-0">${badges}</span>
            </button>
          `;
        });

        return header + items.join('');
      });

    div.innerHTML = `<div class="overflow-y-auto max-h-64 py-1">${sections.join('')}</div>`;

    div.querySelectorAll('[data-model]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setModel(btn.dataset.model, btn.dataset.endpointId);
        this._closeDropdown();
      });
    });

    return div;
  }

  _getAllModels() {
    const all = this._endpointModels.flatMap(em => em.models);
    return [...new Set(all.filter(Boolean))].sort();
  }

  _bindEvents() {
    const btn = this.el.querySelector('#model-picker-btn');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.open ? this._closeDropdown() : this._openDropdown();
    });

    document.addEventListener('click', () => {
      if (this.open) this._closeDropdown();
    });

    document.addEventListener('caps:changed', () => this._updateButton());
    document.addEventListener('settings:changed', () => this._syncFromStore());
    document.addEventListener('models:changed', () => this._syncFromStore());
  }

  _syncFromStore() {
    const endpoints = store.getEndpoints();
    this._endpointModels = endpoints.map(ep => ({
      endpointId: ep.id,
      endpointName: ep.name,
      baseUrl: ep.baseUrl,
      models: store.getAvailableModels(ep.baseUrl),
    }));

    const activeEp = store.getActiveEndpoint();
    const selected = activeEp ? store.getCurrentModel(activeEp.baseUrl) : '';
    const allModels = this._getAllModels();
    this._currentModel = allModels.includes(selected) ? selected : '';
    this._updateButton();
  }

  _openDropdown() {
    this._closeDropdown();
    this.dropdownEl = this._buildDropdown();
    this.el.appendChild(this.dropdownEl);
    this.open = true;
    this.el.querySelector('#model-picker-btn').setAttribute('aria-expanded', 'true');
  }

  _closeDropdown() {
    if (this.dropdownEl && this.dropdownEl.parentNode) {
      this.dropdownEl.parentNode.removeChild(this.dropdownEl);
    }
    this.dropdownEl = null;
    this.open = false;
    this.el?.querySelector('#model-picker-btn')?.setAttribute('aria-expanded', 'false');
  }

  _updateButton() {
    const isPlaceholder = !this._currentModel;
    const caps = this._currentModel ? getCapabilities(this._currentModel, store.getModelCapabilities()) : null;
    const badges = caps ? [
      caps.image ? '<span class="text-xs bg-[var(--c-hi)] text-[var(--c-tx3)] rounded px-1.5 py-0.5">Vision</span>' : '',
      caps.audio ? '<span class="text-xs bg-[var(--c-hi)] text-[var(--c-tx3)] rounded px-1.5 py-0.5">Audio</span>' : '',
    ].filter(Boolean).join('') : '';

    const nameEl = this.el?.querySelector('.model-name');
    const badgesEl = this.el?.querySelector('.model-badges');
    const btn = this.el?.querySelector('#model-picker-btn');
    if (nameEl) nameEl.textContent = this._currentModel || 'Select a model';
    if (badgesEl) badgesEl.innerHTML = badges;
    if (btn) {
      btn.classList.remove('text-[var(--c-tx3)]', 'text-[var(--c-tx2)]');
      btn.classList.add(isPlaceholder ? 'text-[var(--c-tx3)]' : 'text-[var(--c-tx2)]');
    }
  }

  setModel(modelId, endpointId = null) {
    this._currentModel = modelId;
    let targetEp = endpointId
      ? this._endpointModels.find(em => em.endpointId === endpointId)
      : this._endpointModels.find(em => em.models.includes(modelId));
    if (!targetEp) targetEp = this._endpointModels[0];

    if (targetEp) {
      store.setActiveEndpointId(targetEp.endpointId);
      store.setCurrentModel(targetEp.baseUrl, modelId);
    } else {
      store.setCurrentModel(store.getSettings().baseUrl, modelId);
    }
    this._updateButton();
    document.dispatchEvent(new CustomEvent('model:changed', { detail: { model: modelId } }));
  }

  getModel() {
    return this._currentModel;
  }

  setModels(models) {
    const activeEp = store.getActiveEndpoint();
    const activeId = activeEp?.id;
    const idx = this._endpointModels.findIndex(em => em.endpointId === activeId);
    const normalized = [...new Set((models || []).filter(Boolean))].sort();

    if (idx >= 0) {
      this._endpointModels[idx].models = normalized;
    } else if (activeEp) {
      this._endpointModels.push({ endpointId: activeEp.id, endpointName: activeEp.name, baseUrl: activeEp.baseUrl, models: normalized });
    }

    const allModels = this._getAllModels();
    const baseUrl = activeEp?.baseUrl || store.getSettings().baseUrl;
    const selected = store.getCurrentModel(baseUrl);
    if (selected && !allModels.includes(selected)) {
      this._currentModel = '';
      store.setCurrentModel(baseUrl, '');
      document.dispatchEvent(new CustomEvent('model:changed', { detail: { model: '' } }));
    } else {
      this._currentModel = allModels.includes(selected) ? selected : '';
    }

    if (this.open) {
      this._closeDropdown();
      this._openDropdown();
    }
    this._updateButton();
  }

  syncToConversation(conv) {
    this._syncFromStore();
  }
}
