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

function endpointTarget(baseUrl) {
  try {
    const url = new URL(String(baseUrl || ''));
    return {
      hostname: url.hostname,
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    };
  } catch {
    return null;
  }
}

export function findActiveDevice(payload, baseUrl) {
  const boards = Array.isArray(payload?.boards) ? payload.boards : [];
  if (!boards.length) return { board: null, server: null };
  const target = endpointTarget(baseUrl);
  const hostBoard = target
    ? boards.find(board => String(board.ip || board.agent?.ip || '') === target.hostname)
    : null;
  const candidate = hostBoard || (boards.length === 1 ? boards[0] : null);
  if (!candidate) return { board: null, server: null };

  const servers = Array.isArray(candidate.inference?.servers) ? candidate.inference.servers : [];
  if (target) {
    const exact = servers.find(server => Number(server.port) === target.port);
    if (exact) return { board: candidate, server: exact };
  }
  if (servers.length === 1) return { board: candidate, server: servers[0] };
  return { board: candidate, server: null };
}

export async function fetchDeviceMetrics(url) {
  const response = await fetch(String(url || ''), {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function formatKb(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '—';
  return `${(number / 1024 / 1024).toFixed(1)} GB`;
}

function formatTokens(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '—';
  return number.toLocaleString();
}

export function filterDeviceHistory(samples, seconds, now = null) {
  const rows = Array.isArray(samples) ? samples : [];
  if (!rows.length) return [];
  const times = rows
    .map(row => Number(row?.t))
    .filter(Number.isFinite);
  if (!times.length) return [];
  const end = now !== null && now !== undefined && Number.isFinite(Number(now))
    ? Number(now)
    : Math.max(...times);
  const start = end - Math.max(1, Number(seconds) || 60);
  return rows.filter(row => {
    const at = Number(row?.t);
    return Number.isFinite(at) && at > start && at <= end + 1;
  });
}

export function deviceSparkPaths(samples, key, fixedMax = null) {
  const rows = Array.isArray(samples) ? samples : [];
  const values = rows.map(row => {
    const raw = row?.[key];
    const number = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    return Number.isFinite(number) ? number : null;
  });
  const finite = values.filter(value => value !== null);
  if (finite.length < 2) return { line: '', area: '', valid: finite.length, count: rows.length };

  const max = Math.max(Number(fixedMax) || 0, ...finite, 1e-9);
  const segments = [];
  let segment = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (segment.length) segments.push(segment);
      segment = [];
      return;
    }
    const x = (index / (values.length - 1)) * 100;
    const y = 26 - (value / max) * 23;
    segment.push([x, y]);
  });
  if (segment.length) segments.push(segment);

  const lines = [];
  const areas = [];
  for (const points of segments) {
    if (points.length < 2) continue;
    const line = points
      .map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`)
      .join('');
    const first = points[0];
    const last = points[points.length - 1];
    lines.push(line);
    areas.push(`${line}L${last[0].toFixed(2)},28L${first[0].toFixed(2)},28Z`);
  }
  return { line: lines.join(''), area: areas.join(''), valid: finite.length, count: rows.length };
}

export function summarizeDeviceHistory(samples, key) {
  const rows = Array.isArray(samples) ? samples : [];
  const values = rows
    .map(row => {
      const raw = row?.[key];
      return raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    })
    .filter(Number.isFinite);
  if (!values.length) return { count: rows.length, valid: 0, min: null, avg: null, max: null };
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    count: rows.length,
    valid: values.length,
    min: Math.min(...values),
    avg: sum / values.length,
    max: Math.max(...values),
  };
}

function formatHistoryKb(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${(number / 1024 / 1024).toFixed(1)} GB`;
}

function historySummary(stats, formatter, unit = '') {
  if (stats.valid === 0) return `${stats.count} samples · no valid value`;
  return `${stats.valid}/${stats.count} samples · ${formatter(stats.min)}–${formatter(stats.max)}${unit} · avg ${formatter(stats.avg)}${unit}`;
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
    this._deviceData = null;
    this._deviceError = '';
    this._deviceChecking = false;
    this._deviceTimer = null;
    this._deviceInFlight = false;
    this._deviceHistoryWindowSeconds = 60;
    this._onSettingsChanged = () => this._restartDevicePolling();
    this._onDeviceHistoryClick = event => {
      const button = event.target?.closest?.('[data-history-window]');
      if (!button || !this.panelEl?.contains(button)) return;
      const seconds = Number(button.dataset.historyWindow);
      if (!Number.isFinite(seconds)) return;
      this._deviceHistoryWindowSeconds = seconds;
      this._renderDeviceMetrics();
    };
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
    this._startDevicePolling();
  }

  hide() {
    if (!this.visible) return;
    this.panelEl?.removeEventListener('click', this._onDeviceHistoryClick);
    this.panelEl?.remove();
    this.panelEl = null;
    this.visible = false;
    this._syncButton();
    this._stopDevicePolling();
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
          <div id="device-metrics-mount"></div>
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
    this.panelEl.querySelector('#health-refresh-btn').addEventListener('click', () => this.refreshAll());
    this.panelEl.querySelector('#health-copy-btn').addEventListener('click', () => this._copyDiagnostics());
    this.panelEl.addEventListener('click', this._onDeviceHistoryClick);
    document.addEventListener('settings:changed', this._onSettingsChanged);
  }

  refreshAll() {
    this.checkAll();
    this._refreshDeviceMetrics();
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

  _startDevicePolling() {
    this._stopDevicePolling();
    this._renderDeviceMetrics();
    if (!store.getSettings().deviceMetricsUrl) return;
    this._deviceTimer = setInterval(() => this._refreshDeviceMetrics(), 2000);
    this._refreshDeviceMetrics();
  }

  _restartDevicePolling() {
    if (this.visible) this._startDevicePolling();
  }

  _stopDevicePolling() {
    if (this._deviceTimer) clearInterval(this._deviceTimer);
    this._deviceTimer = null;
    document.removeEventListener('settings:changed', this._onSettingsChanged);
  }

  async _refreshDeviceMetrics() {
    const url = store.getSettings().deviceMetricsUrl;
    if (!url || this._deviceInFlight) return;
    this._deviceInFlight = true;
    this._deviceChecking = true;
    this._renderDeviceMetrics();
    try {
      this._deviceData = await fetchDeviceMetrics(url);
      this._deviceError = '';
    } catch (error) {
      this._deviceError = error?.message || String(error);
    } finally {
      this._deviceChecking = false;
      this._deviceInFlight = false;
      this._renderDeviceMetrics();
    }
  }

  _deviceStateClass(state) {
    if (state === 'ready') return 'bg-emerald-400';
    if (state === 'generating' || state === 'loading') return 'bg-amber-400';
    return 'bg-rose-500';
  }

  _historyCardHtml(label, paths, summary) {
    return `
      <div class="rounded-lg border border-[var(--c-bd)] bg-[var(--c-ho)] p-2.5">
        <div class="text-[10px] text-[var(--c-tx3)]">${escapeHtml(label)}</div>
        <svg class="mt-1.5 h-9 w-full text-[var(--c-tx2)]" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
          ${paths.area ? `<path d="${paths.area}" class="fill-current opacity-10" />` : ''}
          ${paths.line ? `<path d="${paths.line}" class="stroke-current" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />` : ''}
        </svg>
        <div class="mt-1 text-[10px] leading-4 text-[var(--c-tx3)]">${escapeHtml(summary)}</div>
      </div>
    `;
  }

  _renderDeviceMetrics() {
    const mount = this.panelEl?.querySelector('#device-metrics-mount');
    if (!mount) return;
    const settings = store.getSettings();
    if (!settings.deviceMetricsUrl) {
      mount.innerHTML = '';
      return;
    }

    if (this._deviceChecking && !this._deviceData) {
      mount.innerHTML = `
        <section class="rounded-xl border border-[var(--c-bd)] p-4">
          <div class="flex items-center gap-2">
            <span class="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400"></span>
            <h3 class="text-sm font-medium text-[var(--c-tx)]">Device metrics</h3>
          </div>
          <p class="mt-1 text-xs text-[var(--c-tx3)]">Checking ${escapeHtml(settings.deviceMetricsUrl)}…</p>
        </section>
      `;
      return;
    }

    if (this._deviceError && !this._deviceData) {
      mount.innerHTML = `
        <section class="rounded-xl border border-[var(--c-bd)] p-4">
          <div class="flex items-center gap-2">
            <span class="h-2.5 w-2.5 rounded-full bg-rose-500"></span>
            <h3 class="text-sm font-medium text-[var(--c-tx)]">Device metrics unavailable</h3>
          </div>
          <p class="mt-1 break-words text-xs text-rose-500">${escapeHtml(this._deviceError)}</p>
          <p class="mt-1 text-[11px] text-[var(--c-tx3)]">Check the aggregator URL, network reachability, and CORS.</p>
        </section>
      `;
      return;
    }

    const activeEndpoint = store.getActiveEndpoint();
    const { board, server } = findActiveDevice(this._deviceData, activeEndpoint?.baseUrl);
    if (!board) {
      mount.innerHTML = `
        <section class="rounded-xl border border-[var(--c-bd)] p-4">
          <div class="flex items-center gap-2">
            <span class="h-2.5 w-2.5 rounded-full bg-amber-400"></span>
            <h3 class="text-sm font-medium text-[var(--c-tx)]">Device metrics</h3>
          </div>
          <p class="mt-1 text-xs text-[var(--c-tx3)]">No board in the aggregator matches ${escapeHtml(activeEndpoint?.baseUrl || 'the active endpoint')}.</p>
        </section>
      `;
      return;
    }

    const metrics = board.data || {};
    const memory = metrics.mem || {};
    const cmm = metrics.cmm || {};
    const network = metrics.net || {};
    const agentInfo = metrics.agent || {};
    const npuInfo = metrics.npu || {};
    const llamaInfo = metrics.llama || {};
    const temperatures = Array.isArray(metrics.zones) ? metrics.zones.map(zone => Number(zone.c)).filter(Number.isFinite) : [];
    const maxTemp = temperatures.length ? Math.max(...temperatures) : null;
    const inference = board.inference || {};
    const inferenceState = server?.state || (inference.online_count ? 'online' : 'offline');
    const context = server?.context_total
      ? `${formatTokens(server.context_used)} / ${formatTokens(server.context_total)}`
      : '—';
    const history = filterDeviceHistory(
      board.history,
      this._deviceHistoryWindowSeconds,
      this._deviceData?.generated_at,
    );
    const oneDecimal = value => Number(value).toFixed(1);
    const integer = value => String(Math.round(Number(value)));
    const chartDefs = [
      {
        label: 'CMM used',
        key: 'cmm_used_kb',
        fixedMax: Number(cmm.total_kb) || null,
        summary: historySummary(summarizeDeviceHistory(history, 'cmm_used_kb'), formatHistoryKb),
      },
      {
        label: 'OS available',
        key: 'os_available_kb',
        fixedMax: Number(memory.total_kb) || null,
        summary: historySummary(summarizeDeviceHistory(history, 'os_available_kb'), formatHistoryKb),
      },
      {
        label: 'NPU max temp',
        key: 'npu_temp_max_c',
        fixedMax: 100,
        summary: historySummary(summarizeDeviceHistory(history, 'npu_temp_max_c'), oneDecimal, '°C'),
      },
      {
        label: 'Network RX',
        key: 'rx_mbps',
        fixedMax: null,
        summary: historySummary(summarizeDeviceHistory(history, 'rx_mbps'), oneDecimal, ' Mbps'),
      },
      {
        label: 'Network TX',
        key: 'tx_mbps',
        fixedMax: null,
        summary: historySummary(summarizeDeviceHistory(history, 'tx_mbps'), oneDecimal, ' Mbps'),
      },
      {
        label: 'Generating slots',
        key: 'inference_processing',
        fixedMax: Math.max(1, inference.servers?.length || 1),
        summary: historySummary(summarizeDeviceHistory(history, 'inference_processing'), integer),
      },
      {
        label: 'llama-server RSS',
        key: 'llama_rss_kb',
        fixedMax: null,
        summary: historySummary(summarizeDeviceHistory(history, 'llama_rss_kb'), formatHistoryKb),
      },
    ];
    const trendCards = chartDefs
      .map(def => this._historyCardHtml(
        def.label,
        deviceSparkPaths(history, def.key, def.fixedMax),
        def.summary,
      ))
      .join('');

    mount.innerHTML = `
      <section class="rounded-xl border border-[var(--c-bd)] p-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="h-2.5 w-2.5 rounded-full ${board.agent?.online || board.ok ? 'bg-emerald-400' : 'bg-rose-500'}"></span>
          <h3 class="text-sm font-medium text-[var(--c-tx)]">Device · ${escapeHtml(board.name || board.ip)}</h3>
          <span class="rounded-full border border-[var(--c-bd)] px-2 py-0.5 text-[10px] text-[var(--c-tx3)]">Board ${board.agent?.online || board.ok ? 'online' : 'offline'}</span>
          <span class="flex items-center gap-1 rounded-full border border-[var(--c-bd)] px-2 py-0.5 text-[10px] text-[var(--c-tx3)]">
            <span class="h-1.5 w-1.5 rounded-full ${this._deviceStateClass(inferenceState)}"></span>
            Inference ${escapeHtml(inferenceState)}
          </span>
          ${server ? `<span class="rounded-full border border-[var(--c-bd)] px-2 py-0.5 text-[10px] text-[var(--c-tx3)]">:${server.port}</span>` : ''}
          <div class="ml-auto flex items-center gap-1 rounded-lg border border-[var(--c-bd)] p-0.5">
            ${[60, 300].map(seconds => `
              <button type="button" data-history-window="${seconds}"
                class="rounded px-2 py-0.5 text-[10px] transition-colors ${this._deviceHistoryWindowSeconds === seconds
                  ? 'bg-[var(--c-tx)] text-[var(--c-bg)]'
                  : 'text-[var(--c-tx3)] hover:text-[var(--c-tx)]'}"
                aria-pressed="${this._deviceHistoryWindowSeconds === seconds}">
                ${seconds === 60 ? '60s' : '5m'}
              </button>
            `).join('')}
          </div>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <div><div class="text-[var(--c-tx3)]">Model</div><div class="mt-0.5 truncate font-medium" title="${escapeHtml(server?.model || '')}">${escapeHtml(server?.model || '—')}</div></div>
          <div><div class="text-[var(--c-tx3)]">Slot</div><div class="mt-0.5 font-medium">${escapeHtml(server?.slot_state || '—')}</div></div>
          <div><div class="text-[var(--c-tx3)]">Context</div><div class="mt-0.5 font-medium">${context}</div></div>
          <div><div class="text-[var(--c-tx3)]">CMM</div><div class="mt-0.5 font-medium">${formatKb(cmm.used_kb)} / ${formatKb(cmm.total_kb)}</div></div>
          <div><div class="text-[var(--c-tx3)]">OS memory</div><div class="mt-0.5 font-medium">${formatKb(Number(memory.total_kb || 0) - Number(memory.avail_kb || 0))} / ${formatKb(memory.total_kb)}</div></div>
          <div><div class="text-[var(--c-tx3)]">NPU max temp</div><div class="mt-0.5 font-medium">${maxTemp == null ? '—' : `${maxTemp.toFixed(1)}°C`}</div></div>
          <div><div class="text-[var(--c-tx3)]">Network</div><div class="mt-0.5 font-medium">↓${Number(network.rx_mbps || 0).toFixed(1)} / ↑${Number(network.tx_mbps || 0).toFixed(1)} Mbps</div></div>
          <div><div class="text-[var(--c-tx3)]">Ports</div><div class="mt-0.5 font-medium">${inference.port_range?.[0] || 18080}-${inference.port_range?.[1] || 18089} · ${inference.online_count || 0} online</div></div>
          <div><div class="text-[var(--c-tx3)]">Agent age</div><div class="mt-0.5 font-medium">${board.age_ms == null ? '—' : formatLatency(board.age_ms)}</div></div>
          <div><div class="text-[var(--c-tx3)]">Agent / BSP</div><div class="mt-0.5 truncate font-medium" title="${escapeHtml(`${agentInfo.version || '—'} / ${agentInfo.bsp_version || '—'}`)}">${escapeHtml(agentInfo.version || '—')} · ${escapeHtml(agentInfo.bsp_version || '—')}</div></div>
          <div><div class="text-[var(--c-tx3)]">Chip / TDP</div><div class="mt-0.5 truncate font-medium" title="${escapeHtml(`${agentInfo.chip_type || '—'} / ${npuInfo.tdp_freq_mhz ?? '—'} MHz`)}">${escapeHtml(agentInfo.chip_type || '—')} · ${npuInfo.tdp_freq_mhz == null ? '—' : `${npuInfo.tdp_freq_mhz} MHz`}</div></div>
          <div><div class="text-[var(--c-tx3)]">llama-server RSS</div><div class="mt-0.5 font-medium">${formatKb(llamaInfo.rss_kb)} · ${llamaInfo.process_count ?? 0} proc</div></div>
        </div>
        <div class="mt-4 flex items-center justify-between gap-2">
          <span class="text-[11px] font-medium text-[var(--c-tx3)]">Resource trends</span>
          <span class="text-[10px] text-[var(--c-tx3)]">${history.length ? `${history.length} sample${history.length === 1 ? '' : 's'}` : 'waiting for samples'}</span>
        </div>
        ${history.length < 2
          ? '<p class="mt-2 rounded-lg border border-dashed border-[var(--c-bd)] p-3 text-xs text-[var(--c-tx3)]">Collecting trend data… The aggregator keeps the last 5 minutes.</p>'
          : `<div class="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-3">${trendCards}</div>`}
      </section>
    `;
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
    const endpointText = store.getEndpoints().map((endpoint) => {
      const result = this._results.get(endpoint.id);
      if (!result || result.checking) return `${endpoint.name || endpoint.baseUrl}: checking`;
      if (result.ok) {
        return `${endpoint.name || endpoint.baseUrl}: online, ${result.models.length} models, ${formatLatency(result.latencyMs)}`;
      }
      return `${endpoint.name || endpoint.baseUrl}: failed, ${result.error}`;
    }).join('\n');

    if (!store.getSettings().deviceMetricsUrl) return endpointText;
    if (this._deviceError && !this._deviceData) return `${endpointText}\nDevice metrics: failed, ${this._deviceError}`;
    const { board, server } = findActiveDevice(this._deviceData, store.getActiveEndpoint()?.baseUrl);
    if (!board) return `${endpointText}\nDevice metrics: no matching board`;
    const metrics = board.data || {};
    return [
      endpointText,
      `Device ${board.name || board.ip}: board ${board.agent?.online || board.ok ? 'online' : 'offline'}, inference ${server?.state || (board.inference?.online_count ? 'online' : 'offline')}${server ? ` port ${server.port}` : ''}`,
      `CMM ${formatKb(metrics.cmm?.used_kb)} / ${formatKb(metrics.cmm?.total_kb)}; OS ${formatKb(Number(metrics.mem?.total_kb || 0) - Number(metrics.mem?.avail_kb || 0))} / ${formatKb(metrics.mem?.total_kb)}`,
    ].join('\n');
  }

  async _copyDiagnostics() {
    await navigator.clipboard?.writeText(this._diagnosticsText()).catch(() => {});
  }
}
