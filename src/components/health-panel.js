import { store } from '../store.js';
import { checkEndpointHealth } from '../api.js';
import { icon } from '../icons.js';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatLatency(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function statusClass(result) {
  if (!result) return 'bg-[var(--c-tx3)] opacity-40';
  if (result.checking) return 'bg-amber-400 animate-pulse';
  return result.ok ? 'bg-emerald-400' : 'bg-rose-500';
}

export class HealthPanel {
  constructor() {
    this.buttonEl = null;
    this.panelEl = null;
    this.visible = false;
    this._results = new Map();
  }

  render() {
    const wrapper = document.createElement('div');
    wrapper.className = 'relative flex items-center';
    wrapper.innerHTML = `
      <button id="health-toggle-btn" type="button"
        class="flex items-center gap-1.5 rounded-lg border border-transparent p-1.5 text-[var(--c-tx3)] transition-all hover:border-[var(--c-top-bd)] hover:bg-[var(--c-top-el)] hover:text-[var(--c-tx2)]"
        aria-label="Service health"
        aria-expanded="false"
        title="Service health">
        ${icon('activity')}
      </button>
    `;
    this.buttonEl = wrapper.firstElementChild;
    this.buttonEl.addEventListener('click', () => this.toggle());
    return wrapper;
  }

  toggle() {
    this.visible ? this.hide() : this.show();
  }

  show() {
    if (this.visible) return;
    this.visible = true;
    this.panelEl = document.createElement('div');
    this.panelEl.className = 'fixed inset-0 z-50 flex items-start justify-center px-4 pt-12 pb-8';
    this.panelEl.style.background = 'rgba(0,0,0,0.65)';
    this.panelEl.style.backdropFilter = 'blur(4px)';
    this.panelEl.innerHTML = this._template();
    document.body.appendChild(this.panelEl);
    this._bindEvents();
    this._syncButton();
    this.checkAll();
  }

  hide() {
    if (!this.visible) return;
    this.panelEl?.remove();
    this.panelEl = null;
    this.visible = false;
    this._syncButton();
  }

  _syncButton() {
    this.buttonEl?.setAttribute('aria-expanded', String(this.visible));
  }

  _template() {
    const endpoints = store.getEndpoints();
    const activeId = store.getActiveEndpointId();
    return `
      <div class="modal-panel w-full max-w-xl overflow-hidden rounded-xl border border-[var(--c-bd)] bg-[var(--c-card)] shadow-2xl">
        <div class="flex items-center justify-between border-b border-[var(--c-bd)] px-5 py-4">
          <div>
            <h2 class="text-base font-semibold text-[var(--c-tx)]">Service Health</h2>
            <p class="mt-0.5 text-xs text-[var(--c-tx3)]">Checks <code>GET /v1/models</code> on every configured endpoint.</p>
          </div>
          <button id="health-close-btn" type="button" class="rounded p-1 text-[var(--c-tx3)] transition-colors hover:text-[var(--c-tx)]" aria-label="Close service health">
            ${icon('x')}
          </button>
        </div>
        <div class="max-h-[62vh] space-y-3 overflow-y-auto px-5 py-4">
          ${endpoints.map(endpoint => this._endpointHtml(endpoint, endpoint.id === activeId)).join('')}
        </div>
        <div class="flex items-center justify-between gap-3 border-t border-[var(--c-bd)] px-5 py-3">
          <button id="health-copy-btn" type="button" class="rounded-lg border border-[var(--c-bd)] px-3 py-1.5 text-xs text-[var(--c-tx2)] transition-colors hover:bg-[var(--c-hi)]">
            Copy diagnostics
          </button>
          <div class="flex items-center gap-2">
            <span id="health-summary" class="text-xs text-[var(--c-tx3)]">Checking…</span>
            <button id="health-refresh-btn" type="button" class="rounded-lg bg-[var(--c-tx)] px-3 py-1.5 text-xs font-medium text-[var(--c-bg)] transition-opacity hover:opacity-90">
              Refresh all
            </button>
          </div>
        </div>
      </div>
    `;
  }

  _endpointHtml(endpoint, isActive) {
    const result = this._results.get(endpoint.id);
    const models = result?.models || [];
    return `
      <article class="endpoint-health rounded-xl border border-[var(--c-bd)] p-4" data-endpoint-id="${endpoint.id}">
        <div class="flex items-start gap-3">
          <span class="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${statusClass(result)}"></span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h3 class="truncate text-sm font-medium text-[var(--c-tx)]">${escapeHtml(endpoint.name || endpoint.baseUrl || 'Endpoint')}</h3>
              ${isActive ? '<span class="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-500">Active</span>' : ''}
            </div>
            <div class="mt-0.5 truncate text-xs text-[var(--c-tx3)]" title="${escapeHtml(endpoint.baseUrl)}">${escapeHtml(endpoint.baseUrl || '(empty URL)')}</div>
            <div class="health-result mt-2 text-xs">
              ${this._resultHtml(result)}
            </div>
            ${models.length ? `<div class="mt-2 max-h-24 overflow-y-auto rounded-lg bg-[var(--c-ho)] p-2 font-mono text-[11px] leading-5 text-[var(--c-tx3)]">${models.map(model => escapeHtml(model)).join('<br>')}</div>` : ''}
          </div>
        </div>
      </article>
    `;
  }

  _resultHtml(result) {
    if (!result || result.checking) {
      return '<span class="text-[var(--c-tx3)]">Checking…</span>';
    }
    if (result.ok) {
      return `
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span class="font-medium text-emerald-500">Online</span>
          <span class="text-[var(--c-tx3)]">${result.models.length} models</span>
          <span class="text-[var(--c-tx3)]">${formatLatency(result.latencyMs)}</span>
        </div>
      `;
    }
    return `
      <div class="font-medium text-rose-500">Offline / request failed</div>
      <div class="mt-1 break-words text-rose-500/90">${escapeHtml(result.error)}</div>
      <div class="mt-1 text-[11px] text-[var(--c-tx3)]">Common causes: server stopped, wrong Base URL, CORS blocked in production build, or API key rejected.</div>
    `;
  }

  _bindEvents() {
    this.panelEl.querySelector('#health-close-btn').addEventListener('click', () => this.hide());
    this.panelEl.addEventListener('mousedown', (e) => {
      if (e.target === this.panelEl) this._backdropDown = true;
    });
    this.panelEl.addEventListener('click', (e) => {
      if (e.target === this.panelEl && this._backdropDown) this.hide();
      this._backdropDown = false;
    });
    this.panelEl.querySelector('#health-refresh-btn').addEventListener('click', () => this.checkAll());
    this.panelEl.querySelector('#health-copy-btn').addEventListener('click', () => this._copyDiagnostics());
  }

  async checkAll() {
    const endpoints = store.getEndpoints();
    endpoints.forEach((endpoint) => {
      this._results.set(endpoint.id, {
        checking: true,
        ok: false,
        models: [],
        latencyMs: null,
        error: '',
      });
    });
    this._renderResults();

    await Promise.all(endpoints.map(async (endpoint) => {
      const result = await checkEndpointHealth(endpoint.baseUrl, endpoint.apiKey);
      this._results.set(endpoint.id, result);
      this._renderResults();
    }));
    this._updateSummary();
  }

  _renderResults() {
    if (!this.panelEl) return;
    this.panelEl.querySelectorAll('.endpoint-health').forEach((element) => {
      const endpoint = store.getEndpoints().find(item => item.id === element.dataset.endpointId);
      if (!endpoint) return;
      element.outerHTML = this._endpointHtml(endpoint, endpoint.id === store.getActiveEndpointId());
    });
    this._updateSummary();
  }

  _updateSummary() {
    const summary = this.panelEl?.querySelector('#health-summary');
    if (!summary) return;
    const results = [...this._results.values()];
    if (results.some(result => result.checking)) {
      summary.textContent = 'Checking…';
      return;
    }
    const online = results.filter(result => result.ok).length;
    summary.textContent = `${online}/${results.length} endpoints online`;
  }

  _diagnosticsText() {
    return store.getEndpoints().map((endpoint) => {
      const result = this._results.get(endpoint.id);
      if (!result || result.checking) return `${endpoint.name || endpoint.baseUrl}: checking`;
      if (result.ok) {
        return `${endpoint.name || endpoint.baseUrl}: online, ${result.models.length} models, ${formatLatency(result.latencyMs)}`;
      }
      return `${endpoint.name || endpoint.baseUrl}: failed, ${result.error}`;
    }).join('\n');
  }

  async _copyDiagnostics() {
    await navigator.clipboard?.writeText(this._diagnosticsText()).catch(() => {});
  }
}
