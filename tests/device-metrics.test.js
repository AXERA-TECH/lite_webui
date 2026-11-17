import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deviceSparkPaths,
  filterDeviceHistory,
  findActiveDevice,
  HealthPanel,
  summarizeDeviceHistory,
} from '../src/components/health-panel.js';
import { store } from '../src/store.js';

const payload = {
  boards: [
    {
      name: 'Shanghai',
      ip: '192.0.2.10',
      ok: true,
      age_ms: 120,
      data: {
        agent: { version: '2.0.0', bsp_version: 'Ax_Version V0.6.0', chip_type: 'AX8860P_CHIP' },
        mem: { total_kb: 1024 * 1024 * 16, avail_kb: 1024 * 1024 * 10 },
        cmm: { total_kb: 1024 * 1024 * 48, used_kb: 1024 * 1024 * 14 },
        net: { rx_mbps: 3.2, tx_mbps: 1.1 },
        zones: [{ c: 45.2 }, { c: 48.7 }],
        npu: { tdp_freq_mhz: 800 },
        llama: { process_count: 1, rss_kb: 1024 * 1024 * 1.2 },
      },
      inference: {
        port_range: [18080, 18089],
        online_count: 2,
        servers: [
          { port: 18080, state: 'ready', model: 'model-a' },
          { port: 18082, state: 'generating', model: 'Qwen3.6-35B-A3B', slot_state: 'processing', context_used: 4096, context_total: 262144 },
        ],
      },
      history: [
        { t: 40, cmm_used_kb: 1024 * 1024 * 10, os_available_kb: 1024 * 1024 * 8, npu_temp_max_c: 44, rx_mbps: 2, tx_mbps: 1, inference_processing: 0, llama_rss_kb: 1024 * 1024 * 1.0 },
        { t: 50, cmm_used_kb: 1024 * 1024 * 12, os_available_kb: 1024 * 1024 * 7, npu_temp_max_c: 46, rx_mbps: 3, tx_mbps: 1.5, inference_processing: 1, llama_rss_kb: 1024 * 1024 * 1.1 },
        { t: 60, cmm_used_kb: null, os_available_kb: null, npu_temp_max_c: null, rx_mbps: null, tx_mbps: null, inference_processing: 0, llama_rss_kb: null },
        { t: 65, cmm_used_kb: 1024 * 1024 * 13, os_available_kb: 1024 * 1024 * 6.5, npu_temp_max_c: 47.5, rx_mbps: 3.5, tx_mbps: 1.8, inference_processing: 1, llama_rss_kb: 1024 * 1024 * 1.2 },
        { t: 70, cmm_used_kb: 1024 * 1024 * 14, os_available_kb: 1024 * 1024 * 6, npu_temp_max_c: 48.7, rx_mbps: 4, tx_mbps: 2, inference_processing: 1, llama_rss_kb: 1024 * 1024 * 1.2 },
      ],
    },
  ],
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('findActiveDevice', () => {
  it('matches the active endpoint host and llama-server port', () => {
    const match = findActiveDevice(payload, 'http://192.0.2.10:18082/v1');
    expect(match.board?.name).toBe('Shanghai');
    expect(match.server?.port).toBe(18082);
    expect(match.server?.state).toBe('generating');
  });

  it('does not guess when multiple servers exist and the endpoint port differs', () => {
    const match = findActiveDevice(payload, 'http://192.0.2.10:18081/v1');
    expect(match.board?.name).toBe('Shanghai');
    expect(match.server).toBeNull();
  });
});

describe('device history helpers', () => {
  const samples = payload.boards[0].history;

  it('filters by an explicit aggregator timestamp', () => {
    expect(filterDeviceHistory(samples, 30, 70)).toHaveLength(4);
    expect(filterDeviceHistory(samples, 10, 70)).toHaveLength(2);
  });

  it('breaks sparklines on missing samples instead of filling zero', () => {
    const paths = deviceSparkPaths(samples, 'cmm_used_kb');
    expect(paths.valid).toBe(4);
    expect(paths.line).toMatch(/M/);
    expect(paths.line.match(/M/g)).toHaveLength(2);
  });

  it('summarizes valid samples and reports coverage', () => {
    const stats = summarizeDeviceHistory(samples, 'npu_temp_max_c');
    expect(stats.valid).toBe(4);
    expect(stats.min).toBe(44);
    expect(stats.max).toBe(48.7);
    expect(stats.avg).toBeCloseTo(46.55, 5);
  });
});

describe('HealthPanel device metrics', () => {
  it('renders read-only device metrics for the active endpoint', async () => {
    vi.useFakeTimers();
    store.saveEndpoints([{ id: 'ep1', name: 'Shanghai', baseUrl: 'http://192.0.2.10:18082/v1', apiKey: '' }]);
    store.setActiveEndpointId('ep1');
    store.saveSettings({ deviceMetricsUrl: 'http://192.0.2.20:8888/api/all' });
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/api/all')) {
        return { ok: true, json: async () => payload };
      }
      return { ok: true, json: async () => ({ data: [{ id: 'Qwen3.6-35B-A3B' }] }) };
    });

    const panel = new HealthPanel();
    document.body.appendChild(panel.render());
    panel.show();

    const section = document.querySelector('#device-metrics-mount');
    await vi.waitFor(() => expect(section.textContent).toContain('Device · Shanghai'));
    expect(section.textContent).toContain('Device · Shanghai');
    expect(section.textContent).toContain('Inference generating');
    expect(section.textContent).toContain('Qwen3.6-35B-A3B');
    expect(section.textContent).toContain('14.0 GB / 48.0 GB');
    expect(section.textContent).toContain('48.7°C');
    expect(section.textContent).toContain('Resource trends');
    expect(section.textContent).toContain('CMM used');
    expect(section.textContent).toContain('llama-server RSS');
    expect(section.textContent).toContain('Ax_Version V0.6.0');
    expect(section.textContent).toContain('AX8860P_CHIP · 800 MHz');

    panel.hide();
    vi.useRealTimers();
  });

  it('switches between the 60 second and 5 minute history windows', async () => {
    vi.useFakeTimers();
    store.saveEndpoints([{ id: 'ep1', name: 'Shanghai', baseUrl: 'http://192.0.2.10:18082/v1', apiKey: '' }]);
    store.setActiveEndpointId('ep1');
    store.saveSettings({ deviceMetricsUrl: 'http://192.0.2.20:8888/api/all' });
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ generated_at: 70, ...payload }),
    }));

    const panel = new HealthPanel();
    document.body.appendChild(panel.render());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#device-metrics-mount')?.textContent).toContain('Device · Shanghai'));

    expect(panel._deviceHistoryWindowSeconds).toBe(60);
    document.querySelector('[data-history-window="300"]')?.click();
    expect(panel._deviceHistoryWindowSeconds).toBe(300);
    expect(document.querySelector('[data-history-window="300"]')?.getAttribute('aria-pressed')).toBe('true');

    panel.hide();
    vi.useRealTimers();
  });

  it('hides device diagnostics when no metrics URL is configured', async () => {
    store.saveEndpoints([{ id: 'ep1', name: 'Shanghai', baseUrl: 'http://192.0.2.10:18082/v1', apiKey: '' }]);
    store.setActiveEndpointId('ep1');
    store.saveSettings({ deviceMetricsUrl: '' });

    const panel = new HealthPanel();
    document.body.appendChild(panel.render());
    panel.show();
    await panel._refreshDeviceMetrics();

    expect(document.querySelector('#device-metrics-mount')?.textContent).toBe('');
    panel.hide();
  });
});
