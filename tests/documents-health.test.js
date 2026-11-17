import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  estimateMessageTokens,
  formatMessagesForApi,
} from '../src/api.js';
import { extractDocumentText, formatDocumentForModel, isDocumentFile } from '../src/documents.js';
import { InputBar } from '../src/components/input-bar.js';
import { App } from '../src/components/app.js';
import { HealthPanel } from '../src/components/health-panel.js';
import { store } from '../src/store.js';
import ExcelJS from 'exceljs';

function makeStreamFetch(text) {
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    'data: [DONE]\n\n',
  ];
  let index = 0;
  const reader = {
    read: vi.fn(async () => (
      index >= chunks.length
        ? { done: true }
        : { done: false, value: new TextEncoder().encode(chunks[index++]) }
    )),
  };
  return vi.fn(async () => ({ ok: true, body: { getReader: () => reader } }));
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('document extraction', () => {
  it('reads plain text and marks truncation', async () => {
    const file = new File(['hello world\n\n\nsecond line'], 'notes.md', { type: 'text/markdown' });
    const result = await extractDocumentText(file, { maxChars: 1000 });

    expect(isDocumentFile(file)).toBe(true);
    expect(result.kind).toBe('md');
    expect(result.truncated).toBe(false);
    expect(result.text).toBe('hello world\n\nsecond line');
  });

  it('truncates large plain text documents', async () => {
    const file = new File(['a'.repeat(3000)], 'large.txt', { type: 'text/plain' });
    const result = await extractDocumentText(file, { maxChars: 1000 });
    expect(result.text).toHaveLength(1000);
    expect(result.truncated).toBe(true);
  });

  it('extracts rows from XLSX workbooks', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Benchmark');
    sheet.addRow(['Model', 'Prefill', 'Decode']);
    sheet.addRow(['Qwen', 3200, 74]);
    const buffer = await workbook.xlsx.writeBuffer();
    const file = new File([buffer], 'benchmark.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const result = await extractDocumentText(file, { maxChars: 1000 });

    expect(result.kind).toBe('xlsx');
    expect(result.text).toContain('[Sheet: Benchmark]');
    expect(result.text).toContain('Model,Prefill,Decode');
    expect(result.text).toContain('Qwen,3200,74');
  });

  it('wraps extracted text in a stable prompt boundary', () => {
    const prompt = formatDocumentForModel('Summarize this', {
      name: 'report.pdf',
      kind: 'pdf',
      sizeBytes: 1234,
      truncated: true,
      text: 'Important content',
    });
    expect(prompt).toContain('File: report.pdf');
    expect(prompt).toContain('<<<DOCUMENT');
    expect(prompt).toContain('Important content');
    expect(prompt).toContain('User instruction: Summarize this');
  });
});

describe('document messages', () => {
  it('uses apiContent for token estimates and API payloads', () => {
    const message = {
      role: 'user',
      content: 'Summarize report.pdf',
      apiContent: `${'document text '.repeat(100)}\nUser instruction: Summarize report.pdf`,
    };
    expect(estimateMessageTokens([message])).toBeGreaterThan(100);
    expect(formatMessagesForApi([message])).toEqual([
      { role: 'user', content: message.apiContent },
    ]);
  });

  it('extracts, previews, and sends a document attachment', async () => {
    const bar = new InputBar();
    document.body.appendChild(bar.render());
    const file = new File(['#benchmark report#'.repeat(5)], 'benchmark.md', { type: 'text/markdown' });
    await bar._handleDocumentFile(file);

    expect(bar._pendingDocument.status).toBe('ready');
    expect(bar.el.querySelector('#document-preview-area').classList.contains('hidden')).toBe(false);
    const status = bar.el.querySelector('#document-status');
    expect(status.textContent).toMatch(/^\d+ chars · /);
    // Keep the attachment preview compact; do not echo the extracted document body.
    expect(status.textContent).not.toContain('benchmark report');

    const events = [];
    document.addEventListener('inputbar:send', (e) => events.push(e.detail), { once: true });
    bar.el.querySelector('#message-input').value = '总结关键数据';
    bar.el.querySelector('#message-input').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    expect(events).toHaveLength(1);
    expect(events[0].document.extracted.name).toBe('benchmark.md');
    expect(events[0].document.extracted.text).toContain('benchmark report');
    expect(bar._pendingDocument).toBeNull();
  });

  it('renders a compact document card and sends full text to the model', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    globalThis.fetch = makeStreamFetch('文档已理解');
    store.saveEndpoints([{ id: 'local', name: 'Local', baseUrl: 'http://a.local', apiKey: '' }]);
    store.saveAvailableModels('http://a.local', ['model-a']);
    store.setCurrentModel('http://a.local', 'model-a');

    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = new App(root);
    app.init();
    const attachment = {
      file: { name: 'benchmark.md', size: 1234 },
      status: 'ready',
      extracted: {
        name: 'benchmark.md',
        kind: 'md',
        sizeBytes: 1234,
        truncated: false,
        text: 'AX8860 prefill 3200 tps',
      },
    };
    await app._handleSend('总结', null, null, null, false, null, false, attachment);

    const conv = store.getCurrentConversation();
    expect(conv.messages[0].content).toBe('总结');
    expect(conv.messages[0].apiContent).toContain('<<<DOCUMENT');
    expect(conv.messages[0].apiContent).toContain('AX8860 prefill 3200 tps');
    expect(conv.messages[1].content).toBe('文档已理解');
    expect(root.textContent).toContain('benchmark.md');

    const requestBody = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(requestBody.messages.at(-1).content).toContain('AX8860 prefill 3200 tps');
  });
});

describe('service health panel', () => {
  it('checks every endpoint and reports online / offline results', async () => {
    store.saveEndpoints([
      { id: 'good', name: 'Good', baseUrl: 'http://good.local', apiKey: '' },
      { id: 'bad', name: 'Bad', baseUrl: 'http://bad.local', apiKey: '' },
    ]);
    globalThis.fetch = vi.fn(async (url, options = {}) => {
      const target = options.headers?.['X-LW-Target'] || String(url);
      if (target.includes('good.local')) {
        return { ok: true, json: async () => ({ data: [{ id: 'model-a' }] }) };
      }
      return { ok: false, text: async () => 'connection refused' };
    });

    const panel = new HealthPanel();
    document.body.appendChild(panel.render());
    panel.show();
    await panel.checkAll();

    expect(panel.panelEl.textContent).toContain('Good');
    expect(panel.panelEl.textContent).toContain('Online');
    expect(panel.panelEl.textContent).toContain('model-a');
    expect(panel.panelEl.textContent).toContain('Offline / request failed');
    expect(panel.panelEl.querySelector('#health-summary').textContent).toBe('1/2 endpoints online');
  });
});
