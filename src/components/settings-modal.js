import { store } from '../store.js';
import { DEFAULT_CAPABILITIES, getCapabilities } from '../capabilities.js';
import { fetchModels } from '../api.js';
import {
  DEFAULT_CONTEXT_LIMIT_TOKENS,
  DEFAULT_CONTEXT_RESET_THRESHOLD_PERCENT,
} from '../context.js';
import { icon } from '../icons.js';
import { GENERATION_PARAMETER_FIELDS, parseStopSequences, validateGenerationParameters } from '../generation-parameters.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function genId() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class SettingsModal {
  constructor() {
    this.el = null;
    this.visible = false;
    this._fetchedModels = [];
    this._parameterDrafts = new Map();
    this._parameterSession = 0;
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
      <div role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1" class="modal-backdrop fixed inset-0 z-50 flex items-start justify-center pt-12 px-4 pb-8" style="background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);">
        <div class="modal-panel bg-[var(--c-card)] border border-[var(--c-bd)] rounded-xl w-full max-w-lg max-h-[84vh] flex flex-col shadow-2xl">
          <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--c-bd)] flex-shrink-0">
            <h2 id="settings-title" class="text-[var(--c-tx)] font-semibold text-base">Settings</h2>
            <button id="settings-close" class="text-[var(--c-tx3)] hover:text-[var(--c-tx)] transition-colors p-1 rounded" aria-label="Close settings">
              ${icon('x')}
            </button>
          </div>
          <div class="overflow-y-auto flex-1 px-5 py-5 space-y-7">
            <!-- API Endpoints -->
            <section>
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-[11px] font-semibold text-[var(--c-tx3)] uppercase tracking-widest">API Endpoints</h3>
                <button id="add-endpoint-btn" class="flex items-center gap-1 text-[12px] text-[var(--c-tx3)] hover:text-[var(--c-tx)] border border-[var(--c-bd)] hover:border-[var(--c-bd-hi)] rounded-lg px-2.5 py-1 transition-colors" title="Add new endpoint">
                  ${icon('plus')} Add
                </button>
              </div>
              <div id="endpoints-list" class="space-y-2.5"></div>
            </section>
            <!-- Device Metrics -->
            <section class="border-t border-[var(--c-bd)] pt-6">
              <h3 class="text-[11px] font-semibold text-[var(--c-tx3)] uppercase tracking-widest mb-3">Device Metrics</h3>
              <div>
                <label class="block text-xs text-[var(--c-tx3)] mb-1.5" for="settings-device-metrics-url">Metrics Aggregator URL</label>
                <input id="settings-device-metrics-url" type="url" spellcheck="false"
                  class="w-full bg-[var(--c-sf)] border border-[var(--c-bd)] rounded-lg px-3 py-2 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors"
                  placeholder="http://10.126.35.46:8888/api/all" />
                <p class="mt-1 text-xs text-[var(--c-tx3)]">Optional read-only board status. Leave empty to hide device diagnostics.</p>
              </div>
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
            <!-- Video Input -->
            <section class="border-t border-[var(--c-bd)] pt-6">
              <h3 class="text-[11px] font-semibold text-[var(--c-tx3)] uppercase tracking-widest mb-3">Video Input</h3>
              <div class="space-y-3">
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs text-[var(--c-tx3)] mb-1.5" for="settings-video-frames">Frames per video</label>
                    <input id="settings-video-frames" type="number" min="1" max="32" step="1" class="w-full bg-[var(--c-sf)] border border-[var(--c-bd)] rounded-lg px-3 py-2 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" placeholder="8" />
                    <p class="mt-1 text-xs text-[var(--c-tx3)]">1–32. Frames sampled in the browser and sent as images.</p>
                  </div>
                  <div>
                    <label class="block text-xs text-[var(--c-tx3)] mb-1.5" for="settings-video-frame-side">Frame max side (px)</label>
                    <input id="settings-video-frame-side" type="number" min="128" max="1024" step="64" class="w-full bg-[var(--c-sf)] border border-[var(--c-bd)] rounded-lg px-3 py-2 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" placeholder="448" />
                    <p class="mt-1 text-xs text-[var(--c-tx3)]">Longest side of each sampled frame.</p>
                  </div>
                </div>
                <p id="settings-video-token-hint" class="text-xs text-[var(--c-tx3)]">≈1600 tokens total (≈200/frame).</p>
              </div>
            </section>
            <!-- Speech Generation -->
            <section class="border-t border-[var(--c-bd)] pt-6">
              <h3 class="text-[11px] font-semibold text-[var(--c-tx3)] uppercase tracking-widest mb-3">Speech Generation</h3>
              <label class="flex items-start gap-2.5 cursor-pointer select-none">
                <input id="settings-stream-tts" type="checkbox" class="mt-0.5 accent-[var(--c-tx)]" />
                <span class="text-xs text-[var(--c-tx2)]">
                  Stream PCM audio when available
                  <span class="block text-[var(--c-tx3)]">Plays VoxCPM2-style PCM responses while they are generated. Falls back to WAV if the backend rejects streaming.</span>
                </span>
              </label>
            </section>
            <!-- Document Input -->
            <section class="border-t border-[var(--c-bd)] pt-6">
              <h3 class="text-[11px] font-semibold text-[var(--c-tx3)] uppercase tracking-widest mb-3">Document Input</h3>
              <label class="block text-xs text-[var(--c-tx3)] mb-1.5" for="settings-document-max-chars">Maximum extracted characters</label>
              <input id="settings-document-max-chars" type="number" min="1000" max="200000" step="1000"
                class="w-full bg-[var(--c-sf)] border border-[var(--c-bd)] rounded-lg px-3 py-2 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors"
                placeholder="24000" />
              <p class="mt-1 text-xs text-[var(--c-tx3)]">
                TXT / Markdown / CSV / JSON are read directly. PDF, DOCX, and XLSX are parsed in the browser.
                Larger documents are truncated to protect the model context.
              </p>
            </section>
            <!-- Generation Parameters -->
            <section class="border-t border-[var(--c-bd)] pt-6">
              <h3 class="text-[11px] font-semibold text-[var(--c-tx3)] uppercase tracking-widest mb-3">Default Generation Parameters</h3>
              <div class="space-y-3">
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs text-[var(--c-tx3)] mb-1.5" for="settings-temperature">Temperature</label>
                    <input id="settings-temperature" type="number" min="0" max="2" step="0.1" class="w-full bg-[var(--c-sf)] border border-[var(--c-bd)] rounded-lg px-3 py-2 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" placeholder="default" />
                    <p class="mt-1 text-xs text-[var(--c-tx3)]">0–2. Empty = use server default.</p>
                  </div>
                  <div>
                    <label class="block text-xs text-[var(--c-tx3)] mb-1.5" for="settings-top-p">Top P</label>
                    <input id="settings-top-p" type="number" min="0" max="1" step="0.05" class="w-full bg-[var(--c-sf)] border border-[var(--c-bd)] rounded-lg px-3 py-2 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" placeholder="default" />
                    <p class="mt-1 text-xs text-[var(--c-tx3)]">0–1. Empty = server default.</p>
                  </div>
                </div>
                <div>
                  <label class="block text-xs text-[var(--c-tx3)] mb-1.5" for="settings-max-tokens">Max Output Tokens</label>
                  <input id="settings-max-tokens" type="number" min="1" step="1" class="w-full bg-[var(--c-sf)] border border-[var(--c-bd)] rounded-lg px-3 py-2 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" placeholder="server default" />
                  <p class="mt-1 text-xs text-[var(--c-tx3)]">Per-response output limit. Empty = server default.</p>
                </div>
                <p id="settings-parameter-error" role="alert" class="hidden text-xs text-rose-500"></p>
              </div>
            </section>
            <section class="border-t border-[var(--c-bd)] pt-6">
              <h3 class="text-[11px] font-semibold text-[var(--c-tx3)] uppercase tracking-widest mb-3">Conversation Settings</h3>
              <div class="space-y-3">
                <label class="flex items-start gap-2.5 cursor-pointer select-none">
                  <input id="settings-auto-stop" type="checkbox" class="mt-0.5 accent-[var(--c-tx)]" />
                  <span class="text-xs text-[var(--c-tx2)]">
                    Auto-stop on repetition
                    <span class="block text-[var(--c-tx3)]">Stops the stream when the model repeats the same chunk 4+ times.</span>
                  </span>
                </label>
                <div>
                  <label class="block text-xs text-[var(--c-tx3)] mb-1.5" for="settings-system-prompt">System Prompt</label>
                  <textarea id="settings-system-prompt" rows="4" class="w-full bg-[var(--c-sf)] border border-[var(--c-bd)] rounded-lg px-3 py-2 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" placeholder="Optional system prompt prepended to every request"></textarea>
                  <p class="mt-1 text-xs text-[var(--c-tx3)]">Prepended as a system message to every request.</p>
                </div>
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
      <div class="endpoint-card border ${borderClass} rounded-xl overflow-hidden" data-endpoint-id="${escapeHtml(ep.id)}">
        <div class="flex items-center gap-2 px-3 py-2.5 bg-[var(--c-sf)]">
          <span class="w-2 h-2 rounded-full flex-shrink-0 transition-colors ${isActive ? 'bg-emerald-400' : 'bg-[var(--c-tx3)] opacity-30'}"></span>
          <span class="ep-name-display flex-1 text-sm font-medium text-[var(--c-tx)] truncate min-w-0">${escapeHtml(ep.name || ep.baseUrl || 'New Endpoint')}</span>
          ${activeBadge}
          ${removeBtn}
        </div>
        <div class="px-3.5 py-3 space-y-3 border-t border-[var(--c-bd)]">
          <div>
            <label class="block text-[11px] font-semibold text-[var(--c-tx3)] uppercase tracking-wider mb-1.5">Name</label>
            <input class="ep-name w-full bg-[var(--c-card)] border border-[var(--c-bd)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" placeholder="My Local Server" value="${escapeHtml(ep.name || '')}" />
          </div>
          <div>
            <label class="block text-[11px] font-semibold text-[var(--c-tx3)] uppercase tracking-wider mb-1.5">API Base URL</label>
            <input class="ep-url w-full bg-[var(--c-card)] border border-[var(--c-bd)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" type="url" placeholder="http://127.0.0.1:8000" value="${escapeHtml(ep.baseUrl || '')}" />
          </div>
          <div>
            <label class="block text-[11px] font-semibold text-[var(--c-tx3)] uppercase tracking-wider mb-1.5">
              API Key <span class="normal-case font-normal opacity-60 tracking-normal">optional</span>
            </label>
            <div class="relative">
              <input class="ep-key w-full bg-[var(--c-card)] border border-[var(--c-bd)] rounded-lg px-2.5 py-1.5 pr-9 text-sm text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors" type="password" placeholder="sk-… (leave blank for local servers)" value="${escapeHtml(ep.apiKey || '')}" />
              <button class="ep-key-toggle absolute right-2 top-1/2 -translate-y-1/2 text-[var(--c-tx3)] hover:text-[var(--c-tx)] transition-colors p-0.5 rounded" type="button" aria-label="Toggle API key visibility">
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
          <div class="ep-models${models.length ? '' : ' hidden'}" data-ep-url="${escapeHtml(ep.baseUrl || '')}">${modelsHtml}</div>
        </div>
      </div>
    `;
  }

  /** Renders capability checkboxes for a list of models (scoped to baseUrl). */
  _inlineCapsHtml(baseUrl, models) {
    const userCaps = store.getModelCapabilities(baseUrl);
    const rows = [...models].sort().map(modelId => {
      const caps = getCapabilities(modelId, userCaps);
      return `
        <div class="py-1.5 border-b border-[var(--c-bd)] last:border-0 min-w-0" data-model="${escapeHtml(modelId)}">
          <div class="flex items-center justify-between gap-2 min-w-0">
          <span class="text-xs text-[var(--c-tx2)] truncate flex-1" title="${escapeHtml(modelId)}">${escapeHtml(modelId)}</span>
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
            <label class="flex items-center gap-1 text-xs text-[var(--c-tx3)] cursor-pointer">
              <input type="checkbox" class="cap-check accent-current" data-cap="tts" ${caps.tts ? 'checked' : ''} /> Speak
            </label>
          </div>
          </div>
          ${this._modelParametersHtml(baseUrl, modelId)}
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

  _parameterUrl(baseUrl) {
    return String(baseUrl || '').trim().replace(/\/+$/, '');
  }

  _parameterDraft(baseUrl, modelId) {
    const url = this._parameterUrl(baseUrl);
    const key = JSON.stringify([url, modelId]);
    if (!this._parameterDrafts.has(key)) {
      const saved = store.getModelGenerationConfig(url, modelId);
      this._parameterDrafts.set(key, { baseUrl: url, modelId, enabled: saved.enabled,
        initialized: saved.exists, raw: { ...saved.parameters }, invalid: new Set(), dirty: false, open: false, advanced: false });
    }
    return this._parameterDrafts.get(key);
  }

  _modelParametersHtml(baseUrl, modelId) {
    const draft = this._parameterDraft(baseUrl, modelId);
    const inputClass = 'min-w-0 w-full bg-[var(--c-card)] border border-[var(--c-bd)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none focus:border-[var(--c-bd-hi)] transition-colors';
    const numeric = field => `<label class="block min-w-0 text-xs text-[var(--c-tx3)]">${escapeHtml(field.label)}
      <input type="number" data-parameter="${field.key}" ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''} step="${field.step || 'any'}"
        class="${inputClass} mt-1" placeholder="server default" value="${escapeHtml(draft.raw[field.key] ?? '')}" /></label>`;
    const common = GENERATION_PARAMETER_FIELDS.filter(field => ['temperature', 'topP', 'maxTokens', 'seed'].includes(field.key));
    const advanced = GENERATION_PARAMETER_FIELDS.filter(field => !field.type && !common.includes(field));
    const thinking = draft.raw.enableThinking;
    const stop = Array.isArray(draft.raw.stop) ? draft.raw.stop.join('\n') : '';
    return `<details class="model-parameters mt-1 min-w-0" data-parameter-url="${escapeHtml(draft.baseUrl)}" ${draft.open ? 'open' : ''}>
      <summary class="cursor-pointer text-[11px] text-[var(--c-tx3)] py-1" aria-label="Parameters for ${escapeHtml(modelId)}">Parameters <span class="model-parameter-summary opacity-70">· ${draft.enabled ? 'Custom' : 'Global defaults'}</span></summary>
      <div class="space-y-3 pt-2 pb-1">
        <label class="block text-xs text-[var(--c-tx3)]">Parameter mode
          <select class="model-parameter-mode ${inputClass} mt-1">
            <option value="global" ${!draft.enabled ? 'selected' : ''}>Use global defaults</option>
            <option value="custom" ${draft.enabled ? 'selected' : ''}>Custom parameters</option>
          </select>
        </label>
        <p class="model-parameter-error hidden text-xs text-rose-500" role="alert"></p>
        <fieldset class="model-parameter-custom space-y-3 min-w-0 ${draft.enabled ? '' : 'hidden'}" ${draft.enabled ? '' : 'disabled'}>
          <p class="text-[11px] text-[var(--c-tx3)]">Custom values replace the global defaults. Empty fields use the server default.</p>
          <div class="grid grid-cols-2 gap-3 min-w-0">${common.map(numeric).join('')}</div>
          <label class="block text-xs text-[var(--c-tx3)]">Enable Thinking
            <select data-parameter="enableThinking" class="${inputClass} mt-1">
              <option value="" ${typeof thinking !== 'boolean' ? 'selected' : ''}>Server default</option>
              <option value="true" ${thinking === true ? 'selected' : ''}>Enabled</option>
              <option value="false" ${thinking === false ? 'selected' : ''}>Disabled</option>
            </select>
          </label>
          <p class="text-[11px] text-[var(--c-tx3)]">Server must support enable_thinking. Controls generation, not display.</p>
          <details class="model-parameter-advanced" ${draft.advanced ? 'open' : ''}>
            <summary class="cursor-pointer text-xs text-[var(--c-tx3)]">Advanced</summary>
            <div class="space-y-3 pt-3 min-w-0">
              <p class="text-[11px] text-[var(--c-tx3)]">Backend support varies. Top K accepts −1; 0 depends on the server. Repetition Penalty uses repetition_penalty (vLLM-style servers).</p>
              <div class="grid grid-cols-2 gap-3 min-w-0">${advanced.map(numeric).join('')}</div>
              <label class="block text-xs text-[var(--c-tx3)]">Stop sequences
                <textarea data-parameter="stop" rows="3" class="${inputClass} mt-1" placeholder="One stop string per line">${escapeHtml(stop)}</textarea>
              </label>
              <p class="text-[11px] text-[var(--c-tx3)]">One stop string per line. Blank lines are ignored; spaces on other lines are preserved.</p>
            </div>
          </details>
          <button type="button" class="model-parameter-reset text-[11px] text-[var(--c-tx3)] underline underline-offset-2 hover:text-[var(--c-tx)]">Restore server defaults</button>
        </fieldset>
      </div>
    </details>`;
  }

  _captureParameterDrafts(container = this.el) {
    container?.querySelectorAll('.model-parameters').forEach(details => {
      const modelId = details.closest('[data-model]').dataset.model;
      const draft = this._parameterDraft(details.dataset.parameterUrl, modelId);
      draft.enabled = details.querySelector('.model-parameter-mode').value === 'custom';
      draft.open = details.open;
      draft.advanced = details.querySelector('.model-parameter-advanced').open;
      for (const input of details.querySelectorAll('[data-parameter]')) {
        const key = input.dataset.parameter;
        if (input.validity.badInput) draft.invalid.add(key);
        else if (input.value !== '') draft.invalid.delete(key);
        draft.raw[key] = draft.invalid.has(key) ? NaN : key === 'stop' ? parseStopSequences(input.value)
          : key === 'enableThinking' ? (input.value === '' ? null : input.value === 'true') : input.value;
      }
    });
  }

  _globalParameterRaw() {
    return Object.fromEntries([['temperature', 'settings-temperature'], ['topP', 'settings-top-p'], ['maxTokens', 'settings-max-tokens']]
      .map(([key, id]) => { const input = this.el.querySelector('#' + id); return [key, input.validity.badInput ? NaN : input.value]; }));
  }

  _updateParameterMode(details, draft) {
    details.querySelector('.model-parameter-mode').value = draft.enabled ? 'custom' : 'global';
    const custom = details.querySelector('.model-parameter-custom');
    custom.hidden = !draft.enabled;
    custom.classList.toggle('hidden', !draft.enabled);
    custom.disabled = !draft.enabled;
    details.querySelector('.model-parameter-summary').textContent = `· ${draft.enabled ? 'Custom' : 'Global defaults'}`;
    for (const input of details.querySelectorAll('[data-parameter]')) {
      const value = draft.raw[input.dataset.parameter];
      input.value = input.dataset.parameter === 'stop' ? (value || []).join('\n')
        : input.dataset.parameter === 'enableThinking' ? (typeof value === 'boolean' ? String(value) : '') : value ?? '';
      input.setCustomValidity('');
    }
    const error = details.querySelector('.model-parameter-error'); error.hidden = true; error.classList.add('hidden');
  }

  _syncParameterViews(source, draft) {
    // Several endpoint cards may resolve to the same URL/model profile. Keep
    // every other view current before Save or fetch captures their DOM values.
    this.el.querySelectorAll('.model-parameters').forEach(details => {
      if (details !== source && details.dataset.parameterUrl === draft.baseUrl &&
          details.closest('[data-model]').dataset.model === draft.modelId) {
        this._updateParameterMode(details, draft);
      }
    });
  }

  _handleParameterEdit(event) {
    const details = event.target.closest('.model-parameters');
    if (!details) return;
    const draft = this._parameterDraft(details.dataset.parameterUrl, details.closest('[data-model]').dataset.model);
    if (event.target.matches('.model-parameter-mode')) {
      this._captureParameterDrafts(details.parentElement);
      if (event.target.value === 'custom' && !draft.initialized) {
        draft.raw = this._globalParameterRaw();
        draft.initialized = true;
      }
      draft.enabled = event.target.value === 'custom';
      draft.dirty = true;
      this._updateParameterMode(details, draft);
    } else if (event.target.matches('[data-parameter]')) {
      draft.invalid.delete(event.target.dataset.parameter);
      event.target.setCustomValidity('');
      this._captureParameterDrafts(details.parentElement);
      draft.dirty = true;
    }
    this._syncParameterViews(details, draft);
  }

  _bindEvents() {
    this.el.addEventListener('change', event => this._handleParameterEdit(event));
    this.el.addEventListener('input', event => { if (event.target.matches('[data-parameter]')) this._handleParameterEdit(event); });
    this.el.addEventListener('click', event => {
      const reset = event.target.closest('.model-parameter-reset');
      if (!reset) return;
      const details = reset.closest('.model-parameters');
      const draft = this._parameterDraft(details.dataset.parameterUrl, details.closest('[data-model]').dataset.model);
      draft.raw = {}; draft.invalid.clear(); draft.initialized = true; draft.enabled = true; draft.dirty = true;
      this._updateParameterMode(details, draft);
      this._syncParameterViews(details, draft);
    });
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
    ['#settings-video-frames', '#settings-video-frame-side', '#settings-context-limit'].forEach((sel) => {
      this.el.querySelector(sel)?.addEventListener('input', () => this._updateVideoTokenHint());
    });
    this.el.querySelector('#add-endpoint-btn').addEventListener('click', () => this._addEndpoint());

    this._loadValues();
  }

  _loadValues() {
    this._parameterSession++;
    this._parameterDrafts = new Map();
    const settings = store.getSettings();
    this.el.querySelector('#settings-context-limit').value = settings.contextLimitTokens || '';
    this.el.querySelector('#settings-context-threshold').value =
      settings.contextResetThresholdPercent || DEFAULT_CONTEXT_RESET_THRESHOLD_PERCENT;
    this.el.querySelector('#settings-device-metrics-url').value = settings.deviceMetricsUrl || '';
    this.el.querySelector('#settings-temperature').value =
      settings.temperature ?? '';
    this.el.querySelector('#settings-top-p').value =
      settings.topP ?? '';
    this.el.querySelector('#settings-max-tokens').value =
      settings.maxTokens ?? '';
    this.el.querySelector('#settings-system-prompt').value =
      settings.systemPrompt || '';
    this.el.querySelector('#settings-auto-stop').checked = settings.autoStopRepetition !== false;
    this.el.querySelector('#settings-stream-tts').checked = settings.streamTTS !== false;
    this.el.querySelector('#settings-video-frames').value = settings.videoFrames ?? 8;
    this.el.querySelector('#settings-video-frame-side').value = settings.videoFrameMaxSide ?? 448;
    this.el.querySelector('#settings-document-max-chars').value = settings.documentMaxChars ?? 24000;
    this._updateVideoTokenHint();

    this._renderEndpointCards(false);

    const eps = store.getEndpoints();
    this._fetchedModels = eps.flatMap(ep => store.getAvailableModels(ep.baseUrl));
  }

  _renderEndpointCards(capture = true) {
    if (capture) this._captureParameterDrafts();
    const active = document.activeElement;
    const oldCard = active?.closest?.('.endpoint-card');
    const oldCards = Array.from(this.el.querySelectorAll('.endpoint-card'));
    const oldIndex = oldCards.indexOf(oldCard);
    const controlClass = oldCard && Array.from(active.classList).find(name => name.startsWith('ep-'));
    const list = this.el.querySelector('#endpoints-list');
    const eps = store.getEndpoints();
    list.innerHTML = eps.map(ep => this._endpointCardHtml(ep)).join('');
    this._bindEndpointCardEvents(list);
    if (oldCard && this.visible) {
      const cards = Array.from(list.querySelectorAll('.endpoint-card'));
      const replacement = cards.find(card => card.dataset.endpointId === oldCard.dataset.endpointId)
        || cards[Math.min(oldIndex, cards.length - 1)];
      const target = (controlClass && replacement?.querySelector('.' + controlClass))
        || replacement?.querySelector('.ep-name')
        || this.el.querySelector('#add-endpoint-btn');
      target?.focus();
    }
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

      card.querySelector('.ep-url').addEventListener('input', () => {
        const modelsArea = card.querySelector('.ep-models');
        this._captureParameterDrafts(modelsArea);
        const url = card.querySelector('.ep-url').value.trim();
        const models = store.getAvailableModels(url);
        modelsArea.dataset.epUrl = url;
        modelsArea.innerHTML = models.length ? this._inlineCapsHtml(url, models) : '';
        modelsArea.classList.toggle('hidden', !models.length);
        this._bindCapCheckboxes(modelsArea);
        card.querySelector('.ep-fetch-status').textContent = models.length ? `${models.length} models loaded` : 'Fetch models for this URL';
      });

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
    // Scroll new card into view so the user can immediately start editing it
    const list = this.el.querySelector('#endpoints-list');
    const newCard = list?.lastElementChild;
    newCard?.querySelector('.ep-name')?.focus();
    if (newCard && typeof newCard.scrollIntoView === 'function') {
      newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
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

  _updateVideoTokenHint() {
    const hint = this.el?.querySelector('#settings-video-token-hint');
    if (!hint) return;
    const frames = Number(this.el.querySelector('#settings-video-frames')?.value) || 8;
    const side = Number(this.el.querySelector('#settings-video-frame-side')?.value) || 448;
    // measured on AX8860: ~200 tokens for a 448px frame
    const perFrame = Math.max(50, Math.round(200 * (side / 448) ** 2));
    const total = frames * perFrame;
    const ctx = store.getSettings().contextLimitTokens || DEFAULT_CONTEXT_LIMIT_TOKENS;
    const pct = (total / ctx) * 100;
    const maxFrames = Math.max(1, Math.floor((ctx * 0.8) / perFrame));

    hint.classList.remove('text-[var(--c-tx3)]', 'text-rose-500', 'text-amber-500');
    if (pct > 80) {
      hint.classList.add('text-rose-500');
      hint.textContent = `⚠ ≈${total.toLocaleString()} tokens = ${pct.toFixed(0)}% of ${ctx.toLocaleString()} context — too large. Use ≤ ${maxFrames} frames or a smaller side.`;
    } else if (pct > 50) {
      hint.classList.add('text-amber-500');
      hint.textContent = `≈${total.toLocaleString()} tokens (≈${perFrame}/frame, ${pct.toFixed(0)}% of ${ctx.toLocaleString()} context) — getting large.`;
    } else {
      hint.classList.add('text-[var(--c-tx3)]');
      hint.textContent = `≈${total.toLocaleString()} tokens total (≈${perFrame}/frame, ${pct.toFixed(1)}% of ${ctx.toLocaleString()} context).`;
    }
  }

  _saveSettings() {
    this._captureParameterDrafts();
    const globalResult = validateGenerationParameters(this._globalParameterRaw());
    const errorEl = this.el.querySelector('#settings-parameter-error');
    const globalError = Object.keys(globalResult.errors)[0];
    errorEl.textContent = globalError ? globalResult.errors[globalError] : '';
    errorEl.classList.toggle('hidden', !globalError);
    if (globalError) {
      const id = { temperature: 'settings-temperature', topP: 'settings-top-p', maxTokens: 'settings-max-tokens' }[globalError];
      this.el.querySelector('#' + id).focus();
      return;
    }
    const endpointUrls = new Set(this._readEndpointCards().map(ep => this._parameterUrl(ep.baseUrl)));
    const parameterWrites = [];
    for (const draft of this._parameterDrafts.values()) {
      if (!draft.dirty || !endpointUrls.has(draft.baseUrl)) continue;
      const result = validateGenerationParameters(draft.raw);
      const key = Object.keys(result.errors)[0];
      if (key && !draft.enabled) {
        const details = Array.from(this.el.querySelectorAll('.model-parameters')).find(node =>
          node.dataset.parameterUrl === draft.baseUrl && node.closest('[data-model]').dataset.model === draft.modelId);
        const notice = details?.querySelector('.model-parameter-error');
        if (notice) {
          notice.textContent = 'Global defaults are active. Invalid custom edits were not saved.';
          notice.hidden = false; notice.classList.remove('hidden');
        }
        parameterWrites.push({ draft, parameters: undefined, keepDirty: true });
        continue;
      }
      if (key) {
        const details = Array.from(this.el.querySelectorAll('.model-parameters')).find(node =>
          node.dataset.parameterUrl === draft.baseUrl && node.closest('[data-model]').dataset.model === draft.modelId);
        if (details) {
          details.open = true;
          const error = details.querySelector('.model-parameter-error');
          error.textContent = `${GENERATION_PARAMETER_FIELDS.find(field => field.key === key)?.label || key}: ${result.errors[key]}`;
          error.hidden = false; error.classList.remove('hidden');
          const input = details.querySelector(`[data-parameter="${key}"]`);
          if (draft.enabled) {
            const advanced = input.closest('.model-parameter-advanced');
            if (advanced) advanced.open = true;
            input.setCustomValidity(result.errors[key]); input.focus();
          }
          else details.querySelector('.model-parameter-mode').focus();
        } else { errorEl.textContent = `${draft.modelId}: ${result.errors[key]}`; errorEl.classList.remove('hidden'); }
        return;
      }
      parameterWrites.push({ draft, parameters: result.values });
    }
    const rawContextLimit = this.el.querySelector('#settings-context-limit').value.trim();
    const contextLimitTokens = rawContextLimit
      ? Math.max(1024, Math.round(Number(rawContextLimit) || DEFAULT_CONTEXT_LIMIT_TOKENS))
      : DEFAULT_CONTEXT_LIMIT_TOKENS;
    const rawThreshold = Number(this.el.querySelector('#settings-context-threshold').value);
    const contextResetThresholdPercent = Number.isFinite(rawThreshold)
      ? Math.min(95, Math.max(50, Math.round(rawThreshold)))
      : DEFAULT_CONTEXT_RESET_THRESHOLD_PERCENT;

    const systemPrompt = this.el.querySelector('#settings-system-prompt').value.trim();
    const { temperature = null, topP = null, maxTokens = null } = globalResult.values;

    const autoStopRepetition = this.el.querySelector('#settings-auto-stop').checked;
    const streamTTS = this.el.querySelector('#settings-stream-tts').checked;
    const deviceMetricsUrl = this.el.querySelector('#settings-device-metrics-url').value.trim();
    const rawVideoFrames = Number(this.el.querySelector('#settings-video-frames').value);
    const videoFrames = Number.isFinite(rawVideoFrames) && rawVideoFrames >= 1
      ? Math.min(32, Math.round(rawVideoFrames)) : 8;
    const rawFrameSide = Number(this.el.querySelector('#settings-video-frame-side').value);
    const videoFrameMaxSide = Number.isFinite(rawFrameSide) && rawFrameSide >= 64
      ? Math.min(1024, Math.round(rawFrameSide)) : 448;
    const rawDocumentMaxChars = Number(this.el.querySelector('#settings-document-max-chars').value);
    const documentMaxChars = Number.isFinite(rawDocumentMaxChars) && rawDocumentMaxChars >= 1000
      ? Math.min(200000, Math.round(rawDocumentMaxChars)) : 24000;

    const endpoints = this._readEndpointCards();
    store.saveEndpoints(endpoints);

    const activeEp = store.getActiveEndpoint();
    store.saveSettings({
      ...store.getSettings(),
      baseUrl: activeEp?.baseUrl || 'http://127.0.0.1:8000',
      apiKey: activeEp?.apiKey || '',
      contextLimitTokens,
      contextResetThresholdPercent,
      deviceMetricsUrl,
      temperature,
      topP,
      maxTokens,
      systemPrompt,
      videoFrames,
      videoFrameMaxSide,
      documentMaxChars,
      autoStopRepetition,
      streamTTS,
    });

    for (const { draft, parameters, keepDirty } of parameterWrites) {
      store.saveModelGenerationConfig(draft.baseUrl, draft.modelId, { enabled: draft.enabled, parameters });
      draft.dirty = !!keepDirty;
    }

    const btn = this.el.querySelector('#settings-save');
    btn.textContent = 'Saved!';
    setTimeout(() => { btn.textContent = 'Save Settings'; }, 2000);

    document.dispatchEvent(new CustomEvent('settings:changed'));
    document.dispatchEvent(new CustomEvent('models:changed'));
  }

  async _fetchModels(endpointId = null) {
    this._captureParameterDrafts();
    const parameterSession = this._parameterSession;
    let ep;
    const card = endpointId
      ? Array.from(this.el?.querySelectorAll('.endpoint-card') || []).find(card => card.dataset.endpointId === endpointId)
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

      // Only update the card if it still represents this request's URL and session.
      if (card && parameterSession === this._parameterSession && this.el.contains(card) &&
          this._parameterUrl(card.querySelector('.ep-url').value) === this._parameterUrl(ep.baseUrl)) {
        this._captureParameterDrafts(card);
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
      if (card && parameterSession === this._parameterSession && this.el.contains(card) &&
          this._parameterUrl(card.querySelector('.ep-url').value) === this._parameterUrl(ep.baseUrl)) {
        this._captureParameterDrafts(card);
        const status = card.querySelector('.ep-fetch-status');
        status.classList.remove('flex-shrink-0');
        status.classList.add('min-w-0', 'break-words');
        status.textContent = `Failed to fetch: ${err.message}`;
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
      const base = DEFAULT_CAPABILITIES[modelId] || getCapabilities(modelId);
      userCaps[modelId] = { ...base };
    }
    userCaps[modelId][cap] = checkbox.checked;
    store.saveModelCapabilities(baseUrl, userCaps);
    document.dispatchEvent(new CustomEvent('caps:changed'));
  }

  _isFocusable(control, boundary = null) {
    if (!control?.isConnected || control.disabled || control.matches(':disabled') ||
        control.tabIndex < 0 || control.getAttribute('type') === 'hidden') return false;
    for (let node = control; node && node !== boundary; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.inert || node.hasAttribute('inert') ||
          node.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' || style.visibility === 'hidden' ||
          style.visibility === 'collapse') return false;
      if (node.tagName === 'DETAILS' && !node.open) {
        const summary = Array.from(node.children).find(child => child.tagName === 'SUMMARY');
        if (!summary?.contains(control)) return false;
      }
    }
    return true;
  }

  _focusableControls() {
    const selector = 'button, input, select, textarea, a[href], summary, [tabindex]';
    return Array.from(this.el.querySelectorAll(selector))
      .filter(control => this._isFocusable(control, this.el));
  }

  _focusFirst() {
    (this._focusableControls()[0] || this.el).focus();
  }

  show() {
    if (!this.el || this.visible) return;
    this._returnFocus = document.activeElement;
    this._loadValues();
    document.body.appendChild(this.el);
    this.visible = true;
    this._composing = false;
    this._backgroundInert = Array.from(document.body.children)
      .filter(node => node !== this.el)
      .map(node => ({ node, hadAttribute: node.hasAttribute('inert'), value: node.getAttribute('inert'), inert: node.inert }));
    for (const { node } of this._backgroundInert) {
      node.inert = true;
      node.setAttribute('inert', '');
    }
    this._onCompositionStart = () => { this._composing = true; };
    this._onCompositionEnd = () => { this._composing = false; };
    this._onModalKeydown = event => {
      if (!this.visible || event.isComposing || event.keyCode === 229 || this._composing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.hide();
      } else if (event.key === 'Tab') {
        const controls = this._focusableControls();
        const index = controls.indexOf(document.activeElement);
        // Handle the whole ring explicitly so dynamically hidden controls are skipped.
        event.preventDefault();
        const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0)
          : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
        (controls[next] || this.el).focus();
      }
    };
    this._onModalFocus = event => {
      if (this.visible && !this.el.contains(event.target)) this._focusFirst();
    };
    document.addEventListener('keydown', this._onModalKeydown, true);
    document.addEventListener('focusin', this._onModalFocus, true);
    document.addEventListener('compositionstart', this._onCompositionStart, true);
    document.addEventListener('compositionend', this._onCompositionEnd, true);
    this._focusFirst();
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this._parameterSession++;
    document.removeEventListener('keydown', this._onModalKeydown, true);
    document.removeEventListener('focusin', this._onModalFocus, true);
    document.removeEventListener('compositionstart', this._onCompositionStart, true);
    document.removeEventListener('compositionend', this._onCompositionEnd, true);
    this.el?.remove();
    for (const { node, hadAttribute, value, inert } of this._backgroundInert || []) {
      node.inert = inert;
      if (hadAttribute) node.setAttribute('inert', value);
      else node.removeAttribute('inert');
    }
    this._backgroundInert = [];
    this._composing = false;
    const trigger = this._returnFocus;
    this._returnFocus = null;
    if (this._isFocusable(trigger)) trigger.focus();
    if (document.activeElement === document.body || !document.activeElement?.isConnected) {
      const fallback = Array.from(document.querySelectorAll('button, input, select, textarea, a[href], [tabindex]'))
        .find(node => this._isFocusable(node));
      fallback?.focus();
    }
  }

  toggle() {
    this.visible ? this.hide() : this.show();
  }
}
