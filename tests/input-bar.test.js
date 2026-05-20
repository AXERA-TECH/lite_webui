/**
 * Tests for InputBar component behaviour:
 *  - Send button visual state (rainbow idle / muted sending) and icon markup
 *  - Enter key sends, Shift+Enter does not
 *  - /reset and /clean are passed through as text (command handling lives in App)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { InputBar } from '../src/components/input-bar.js';
import { store } from '../src/store.js';

function makeBar() {
  const bar = new InputBar();
  document.body.appendChild(bar.render());
  return bar;
}

afterEach(() => {
  document.body.innerHTML = '';
});

function enableAudio(bar) {
  store.saveModelCapabilities({
    'audio-model': { text: true, image: false, audio: true },
  });
  bar.setModel('audio-model');
}

// ─── Send button appearance ───────────────────────────────────────────────────

describe('InputBar – send button appearance', () => {
  it('send button uses the theme hover shell by default', () => {
    const bar = makeBar();
    const btn = bar.el.querySelector('#send-btn');
    expect(btn.className).toContain('hover:bg-[var(--c-hi)]');
    expect(btn.className).not.toContain('bg-blue-500');
  });

  it('send button uses a transparent paper airplane svg with fold lines and gradient strokes', () => {
    const bar = makeBar();
    const btn = bar.el.querySelector('#send-btn');
    expect(btn.querySelector('svg')?.getAttribute('fill')).toBe('none');
    expect(btn.querySelectorAll('path')).toHaveLength(3);
    expect(btn.querySelector('linearGradient')).not.toBeNull();
  });

  it('setSending(true) keeps the button enabled (it becomes a stop button)', () => {
    const bar = makeBar();
    bar.setSending(true);
    expect(bar.el.querySelector('#send-btn').disabled).toBe(false);
  });

  it('setSending(true) switches to the stop/rose theme state', () => {
    const bar = makeBar();
    bar.setSending(true);
    const btn = bar.el.querySelector('#send-btn');
    expect(btn.className).toContain('text-rose-');
    expect(btn.querySelector('linearGradient')).toBeNull();
  });

  it('setSending(false) re-enables button and restores the idle theme state', () => {
    const bar = makeBar();
    bar.setSending(true);
    bar.setSending(false);
    const btn = bar.el.querySelector('#send-btn');
    expect(btn.disabled).toBe(false);
    expect(btn.className).toContain('hover:bg-[var(--c-hi)]');
    expect(btn.querySelector('linearGradient')).not.toBeNull();
  });
});

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

describe('InputBar – keyboard shortcuts', () => {
  it('Enter dispatches inputbar:send with the textarea text', () => {
    const bar = makeBar();
    const events = [];
    const handler = (e) => events.push(e.detail);
    document.addEventListener('inputbar:send', handler);

    const textarea = bar.el.querySelector('#message-input');
    textarea.value = 'hello world';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('hello world');
    document.removeEventListener('inputbar:send', handler);
  });

  it('Enter clears the textarea after sending', () => {
    const bar = makeBar();
    const textarea = bar.el.querySelector('#message-input');
    textarea.value = 'test message';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(textarea.value).toBe('');
  });

  it('Shift+Enter does NOT dispatch inputbar:send', () => {
    const bar = makeBar();
    const events = [];
    const handler = (e) => events.push(e.detail);
    document.addEventListener('inputbar:send', handler);

    const textarea = bar.el.querySelector('#message-input');
    textarea.value = 'hello world';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));

    expect(events).toHaveLength(0);
    document.removeEventListener('inputbar:send', handler);
  });

  it('Enter does nothing when textarea is blank', () => {
    const bar = makeBar();
    const events = [];
    const handler = (e) => events.push(e.detail);
    document.addEventListener('inputbar:send', handler);

    const textarea = bar.el.querySelector('#message-input');
    textarea.value = '   ';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(events).toHaveLength(0);
    document.removeEventListener('inputbar:send', handler);
  });

  it('Enter does NOT send while _sending is true', () => {
    const bar = makeBar();
    bar.setSending(true);
    const events = [];
    const handler = (e) => events.push(e.detail);
    document.addEventListener('inputbar:send', handler);

    const textarea = bar.el.querySelector('#message-input');
    textarea.value = 'hello';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(events).toHaveLength(0);
    document.removeEventListener('inputbar:send', handler);
  });
});

// ─── Command passthrough ──────────────────────────────────────────────────────

describe('InputBar – command passthrough', () => {
  it('dispatches inputbar:send with text="/reset" (command parsed by App, not InputBar)', () => {
    const bar = makeBar();
    const events = [];
    const handler = (e) => events.push(e.detail);
    document.addEventListener('inputbar:send', handler);

    const textarea = bar.el.querySelector('#message-input');
    textarea.value = '/reset';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('/reset');
    document.removeEventListener('inputbar:send', handler);
  });

  it('dispatches inputbar:send with text="/clean" (command parsed by App, not InputBar)', () => {
    const bar = makeBar();
    const events = [];
    const handler = (e) => events.push(e.detail);
    document.addEventListener('inputbar:send', handler);

    const textarea = bar.el.querySelector('#message-input');
    textarea.value = '/clean';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('/clean');
    document.removeEventListener('inputbar:send', handler);
  });
});

describe('InputBar – audio attachments', () => {
  it('dispatches audio upload with default transcribe mode', () => {
    const bar = makeBar();
    enableAudio(bar);
    bar._handleAudioFile(new File(['audio'], 'meeting.wav', { type: 'audio/wav' }));

    const events = [];
    const handler = (e) => events.push(e.detail);
    document.addEventListener('inputbar:send', handler);

    bar.el.querySelector('#send-btn').click();

    expect(events).toHaveLength(1);
    expect(events[0].audio.file.name).toBe('meeting.wav');
    document.removeEventListener('inputbar:send', handler);
  });

  it('supports pasting audio from the clipboard', async () => {
    const bar = makeBar();
    enableAudio(bar);
    const file = new File(['audio'], 'speech.m4a', { type: 'audio/mp4' });
    const preventDefault = vi.fn();
    await bar._handlePaste({
      preventDefault,
      clipboardData: {
        items: [
          {
            type: 'audio/mp4',
            getAsFile: () => file,
          },
        ],
      },
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(bar._pendingAudio.file.name).toBe('speech.m4a');
  });

  it('sends audio together with a text instruction', () => {
    const bar = makeBar();
    enableAudio(bar);
    bar._handleAudioFile(new File(['audio'], 'call.ogg', { type: 'audio/ogg' }));
    bar.el.querySelector('#message-input').value = '总结这段录音内容';

    const events = [];
    const handler = (e) => events.push(e.detail);
    document.addEventListener('inputbar:send', handler);

    bar.el.querySelector('#send-btn').click();

    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('总结这段录音内容');
    expect(events[0].audio.file.name).toBe('call.ogg');
    document.removeEventListener('inputbar:send', handler);
  });
});

// ─── Context badge ────────────────────────────────────────────────────────────

describe('InputBar – context display', () => {
  it('initial badge shows ctx 0', () => {
    const bar = makeBar();
    expect(bar.el.querySelector('#context-info').textContent).toBe('ctx 0');
  });

  it('setContextInfo updates the text with compact token counts', () => {
    const bar = makeBar();
    bar.setContextInfo(1536, 4096, 3276);
    expect(bar.el.querySelector('#context-info').textContent).toBe('ctx 1.5k/4.1k');
  });

  it('setContextInfo(0, max) shows ctx 0/max', () => {
    const bar = makeBar();
    bar.setContextInfo(0, 4096, 3276);
    expect(bar.el.querySelector('#context-info').textContent).toBe('ctx 0/4.1k');
  });

  it('setContextInfo below warning threshold uses muted color', () => {
    const bar = makeBar();
    bar.setContextInfo(2000, 4096, 3276);
    expect(bar.el.querySelector('#context-info').className).not.toContain('text-amber-400');
  });

  it('setContextInfo at warning threshold applies amber warning class', () => {
    const bar = makeBar();
    bar.setContextInfo(3276, 4096, 3276);
    expect(bar.el.querySelector('#context-info').className).toContain('text-amber-400');
  });

  it('setContextInfo above warning threshold applies amber warning class', () => {
    const bar = makeBar();
    bar.setContextInfo(3800, 4096, 3276);
    expect(bar.el.querySelector('#context-info').className).toContain('text-amber-400');
  });

  it('setContextInfo back below threshold removes amber class', () => {
    const bar = makeBar();
    bar.setContextInfo(3800, 4096, 3276);
    bar.setContextInfo(500, 4096, 3276);
    expect(bar.el.querySelector('#context-info').className).not.toContain('text-amber-400');
  });
});

// ─── Auto draw mode ───────────────────────────────────────────────────────────

describe('InputBar – auto draw mode', () => {
  afterEach(() => {
    store.saveModelCapabilities({});
  });

  it('auto-enables draw mode when model has imageGen capability', () => {
    const bar = makeBar();
    store.saveModelCapabilities({ 'flux-dev': { text: true, image: false, audio: false, imageGen: true } });
    bar.setModel('flux-dev');
    expect(bar._drawMode).toBe(true);
  });

  it('draw mode button is highlighted after auto-enable', () => {
    const bar = makeBar();
    store.saveModelCapabilities({ 'flux-dev': { text: true, image: false, audio: false, imageGen: true } });
    bar.setModel('flux-dev');
    const drawBtn = bar.el.querySelector('#draw-mode-btn');
    expect(drawBtn.className).toContain('bg-violet-100');
  });

  it('seed input becomes visible after auto-enable', () => {
    const bar = makeBar();
    store.saveModelCapabilities({ 'flux-dev': { text: true, image: false, audio: false, imageGen: true } });
    bar.setModel('flux-dev');
    const seedWrapper = bar.el.querySelector('#seed-wrapper');
    expect(seedWrapper.classList.contains('hidden')).toBe(false);
  });

  it('does NOT auto-enable draw mode for non-imageGen model', () => {
    const bar = makeBar();
    bar.setModel('gpt-4');
    expect(bar._drawMode).toBe(false);
  });

  it('also auto-enables for built-in draw-only models like dall-e-3', () => {
    const bar = makeBar();
    bar.setModel('dall-e-3');
    expect(bar._drawMode).toBe(true);
  });

  it('keeps draw mode active after submit on imageGen model', () => {
    const bar = makeBar();
    store.saveModelCapabilities({ 'flux-dev': { text: true, image: false, audio: false, imageGen: true } });
    bar.setModel('flux-dev');
    expect(bar._drawMode).toBe(true);

    const events = [];
    document.addEventListener('inputbar:send', (e) => events.push(e.detail));
    const textarea = bar.el.querySelector('#message-input');
    textarea.value = 'a cat in space';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(events).toHaveLength(1);
    expect(events[0].draw).toBe(true);
    expect(bar._drawMode).toBe(true); // still active after submit
    document.removeEventListener('inputbar:send', events.pop);
  });

  it('clears draw mode after submit on a non-imageGen model', () => {
    const bar = makeBar();
    // Manually enable draw mode, then switch to a non-imageGen model
    store.saveModelCapabilities({ 'dalle': { text: false, image: false, audio: false, imageGen: true } });
    bar.setModel('dalle');
    expect(bar._drawMode).toBe(true);

    // Now switch to text-only model
    bar.setModel('gpt-4');
    // _updateAttachmentButtons disables draw mode when imageGen is not supported
    expect(bar._drawMode).toBe(false);
  });
});
