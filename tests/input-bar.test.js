/**
 * Tests for InputBar component behaviour:
 *  - Send button visual state (rainbow idle / muted sending) and icon markup
 *  - Enter key sends, Shift+Enter does not
 *  - /reset and /clean are passed through as text (command handling lives in App)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { InputBar } from '../src/components/input-bar.js';
import { store } from '../src/store.js';
import { MicrophoneRecorder } from '../src/audio.js';

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

// ─── Auto speak mode ──────────────────────────────────────────────────────────

describe('InputBar – auto speak mode', () => {
  afterEach(() => {
    store.saveModelCapabilities({});
  });

  it('auto-enables TTS mode for voxcpm2', () => {
    const bar = makeBar();
    bar.setModel('voxcpm2');
    expect(bar._ttsMode).toBe(true);
    expect(bar._drawMode).toBe(false);
  });

  it('shows the speech placeholder and seed input', () => {
    const bar = makeBar();
    bar.setModel('voxcpm2');
    expect(bar.el.querySelector('#message-input').placeholder).toBe('Enter text to speak…');
    expect(bar.el.querySelector('#seed-wrapper').classList.contains('hidden')).toBe(false);
  });

  it('dispatches tts=true and keeps speak mode after submit', () => {
    const bar = makeBar();
    bar.setModel('voxcpm2');
    const events = [];
    const handler = (e) => events.push(e.detail);
    document.addEventListener('inputbar:send', handler);

    const textarea = bar.el.querySelector('#message-input');
    textarea.value = '今天天气很好。';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(events).toHaveLength(1);
    expect(events[0].tts).toBe(true);
    expect(events[0].text).toBe('今天天气很好。');
    expect(bar._ttsMode).toBe(true);
    document.removeEventListener('inputbar:send', handler);
  });
});

describe('InputBar – multi-endpoint capability isolation', () => {
  afterEach(() => {
    store.saveModelCapabilities({});
  });

  it('activates correct buttons when switching to a model from a different endpoint', () => {
    store.saveEndpoints([
      { id: 'ep1', name: 'A', baseUrl: 'http://a.local', apiKey: '' },
      { id: 'ep2', name: 'B', baseUrl: 'http://b.local', apiKey: '' },
    ]);
    // ep1 has an imageGen model, ep2 has a vision model
    store.saveModelCapabilities('http://a.local', { 'gen-model': { text: true, image: false, audio: false, imageGen: true } });
    store.saveModelCapabilities('http://b.local', { 'vis-model': { text: true, image: true, audio: false, imageGen: false } });

    const bar = makeBar();

    // Simulate user selecting vis-model from ep2 (model-picker sets active endpoint first)
    store.setActiveEndpointId('ep2');
    bar.setModel('vis-model');

    const mediaBtn = bar.el.querySelector('#media-upload-btn');
    const drawBtn = bar.el.querySelector('#draw-mode-btn');
    // Vision button should be enabled (image=true on ep2), draw disabled (imageGen=false on ep2)
    expect(mediaBtn.disabled).toBe(false);
    expect(drawBtn.disabled).toBe(true);
    expect(bar._drawMode).toBe(false);
  });

  it('auto-enables draw mode for imageGen model from non-default endpoint', () => {
    store.saveEndpoints([
      { id: 'ep1', name: 'A', baseUrl: 'http://a.local', apiKey: '' },
      { id: 'ep2', name: 'B', baseUrl: 'http://b.local', apiKey: '' },
    ]);
    store.saveModelCapabilities('http://b.local', { 'flux-ep2': { text: true, image: false, audio: false, imageGen: true } });

    const bar = makeBar();

    store.setActiveEndpointId('ep2');
    bar.setModel('flux-ep2');

    expect(bar._drawMode).toBe(true);
  });
});

describe('InputBar – AXERA vision image preprocessing', () => {
  it('resizes large screenshots to an even 32-pixel-aligned patch grid', () => {
    const bar = makeBar();
    const corrected = bar._visionImageDimensions(1920, 992);
    const first = bar._visionImageDimensions(2917, 963);

    expect(corrected).toEqual({
      width: 864,
      height: 448,
      originalWidth: 1920,
      originalHeight: 992,
    });
    expect(first).toEqual({
      width: 864,
      height: 288,
      originalWidth: 2917,
      originalHeight: 963,
    });
    for (const size of [corrected, first]) {
      expect(size.width % 32).toBe(0);
      expect(size.height % 32).toBe(0);
      expect((size.width / 16) * (size.height / 16)).toBeLessThanOrEqual(3072);
    }
  });
});

describe('InputBar – input recall and composition', () => {
  function key(input, key, options = {}) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
    input.dispatchEvent(event);
    return event;
  }
  it('recalls only user text without sending or restoring attachments, and Down restores empty draft', () => {
    const bar = makeBar();
    const input = bar.el.querySelector('textarea');
    bar.setInputHistory('a', [{ role: 'user', content: 'old' }, { role: 'user', content: [{ type: 'text', text: 'latest' }, { type: 'image_url', image_url: { url: 'x' } }] }, { role: 'assistant', content: 'answer' }]);
    const send = vi.spyOn(bar, '_submit');
    expect(key(input, 'ArrowUp').defaultPrevented).toBe(true);
    expect(input.value).toBe('latest');
    expect(send).not.toHaveBeenCalled();
    expect(bar._pendingImage).toBeNull();
    expect(key(input, 'ArrowDown').defaultPrevented).toBe(true);
    expect(input.value).toBe('');
  });
  it('leaves empty history, edited drafts, multiline movement, selections and modified arrows native', () => {
    const bar = makeBar(); const input = bar.el.querySelector('textarea');
    expect(key(input, 'ArrowUp').defaultPrevented).toBe(false);
    bar.setInputHistory('a', [{ role: 'user', content: 'previous' }]);
    for (const option of ['shiftKey', 'altKey', 'ctrlKey', 'metaKey']) expect(key(input, 'ArrowUp', { [option]: true }).defaultPrevented).toBe(false);
    for (const draft of ['draft', 'line one\nline two', ' ']) { input.value = draft; expect(key(input, 'ArrowUp').defaultPrevented).toBe(false); expect(input.value).toBe(draft); }
    input.value = ''; key(input, 'ArrowUp'); input.setSelectionRange(0, 3);
    expect(key(input, 'ArrowDown').defaultPrevented).toBe(false);
    input.value = 'edited'; input.dispatchEvent(new Event('input'));
    expect(key(input, 'ArrowDown').defaultPrevented).toBe(false);
    bar.setInputHistory('a', [{ role: 'user', content: 'one\ntwo' }]); input.value = ''; key(input, 'ArrowUp');
    expect(key(input, 'ArrowDown').defaultPrevented).toBe(true);
    expect(input.value).toBe('');
  });
  it('isolates scopes and excludes synthetic audio messages', () => {
    const bar = makeBar(); const input = bar.el.querySelector('textarea');
    bar.setInputHistory('a', [{ role: 'user', content: 'first' }, { role: 'user', content: 'Audio upload: file', meta: { type: 'audio' } }]);
    key(input, 'ArrowUp'); expect(input.value).toBe('first');
    bar.setInputHistory('b', []); expect(input.value).toBe('');
    expect(key(input, 'ArrowUp').defaultPrevented).toBe(false);
  });
  it('does not send or recall during IME composition or legacy keyCode 229', () => {
    const bar = makeBar(); const input = bar.el.querySelector('textarea'); const send = vi.spyOn(bar, '_submit');
    bar.setInputHistory('a', [{ role: 'user', content: 'previous' }]);
    expect(key(input, 'ArrowUp', { isComposing: true }).defaultPrevented).toBe(false);
    input.value = '候选';
    key(input, 'Enter', { isComposing: true }); key(input, 'Enter', { keyCode: 229 });
    input.dispatchEvent(new CompositionEvent('compositionstart')); key(input, 'Enter');
    expect(send).not.toHaveBeenCalled(); expect(input.value).toBe('候选');
    input.dispatchEvent(new CompositionEvent('compositionend')); key(input, 'Enter'); expect(send).toHaveBeenCalledOnce();
  });
  it('updates the accessible action label for send and stop', () => {
    const bar = makeBar(); const button = bar.el.querySelector('#send-btn');
    bar.setSending(true); expect(button.getAttribute('aria-label')).toBe('Stop generation');
    bar.setSending(false); expect(button.getAttribute('aria-label')).toBe('Send message');
  });
});

it('keeps recall tracking through same-conversation context updates and recalls explicit audio instructions', () => {
  const bar = makeBar(); const input = bar.el.querySelector('textarea');
  const messages = [{ role: 'user', content: 'Audio upload: voice.wav', meta: { type: 'audio', instruction: 'summarize my recording' } }];
  bar.setInputHistory('a', messages);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
  expect(input.value).toBe('summarize my recording');
  bar.setInputHistory('a', messages);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })); expect(input.value).toBe('');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
  bar.setInputHistory('b', []); expect(input.value).toBe('');
});

it('browses repeated Up/Down across multiline history and stops at both boundaries', () => {
  const bar = makeBar(); const input = bar.el.querySelector('textarea');
  const history = [{ role: 'user', content: 'oldest\nmultiline' }, { role: 'user', content: 'middle' }, { role: 'user', content: 'latest' }];
  bar.setInputHistory('a', history);
  const press = key => input.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
  press('ArrowUp'); expect(input.value).toBe('latest');
  bar.setInputHistory('a', history); press('ArrowUp'); expect(input.value).toBe('middle');
  bar.setInputHistory('a', [...history, { role: 'user', content: 'middle' }]);
  bar.setInputHistory('a', history);
  press('ArrowUp'); expect(input.value).toBe('oldest\nmultiline');
  press('ArrowUp'); expect(input.value).toBe('oldest\nmultiline');
  press('ArrowDown'); expect(input.value).toBe('middle');
  press('ArrowDown'); expect(input.value).toBe('latest');
  press('ArrowDown'); expect(input.value).toBe('');
  expect(press('ArrowDown')).toBe(true);
  press('ArrowUp'); input.value = 'edited'; input.dispatchEvent(new Event('input'));
  expect(press('ArrowUp')).toBe(true); expect(input.value).toBe('edited');
});

describe('InputBar – attachment drafts across capabilities', () => {
  function setup() {
    store.saveModelCapabilities({
      'vision-test': { image: true, audio: false, imageGen: false },
      'audio-test': { image: false, audio: true, imageGen: false },
      'mixed-test': { image: true, audio: true, imageGen: true },
      'text-test': { image: false, audio: false, imageGen: false },
    });
    const bar = makeBar();
    vi.spyOn(bar, '_extractVideoFrames').mockResolvedValue(['data:image/jpeg;base64,frame']);
    vi.spyOn(bar, '_fileToDataUrl').mockImplementation(async file => `data:${file.type};base64,draft`);
    return bar;
  }
  const input = bar => bar.el.querySelector('#message-input');
  const send = bar => bar.el.querySelector('#send-btn');
  const status = bar => bar.el.querySelector('#attachment-status');
  const file = kind => new File(['draft'], `draft.${kind}`, { type: `${kind}/${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav'}` });
  const add = async (bar, kind, attachment) => kind === 'audio' ? bar._handleAudioFile(attachment) : await bar[kind === 'image' ? '_handleImageFile' : '_handleVideoFile'](attachment);

  for (const kind of ['image', 'video', 'audio']) {
    it(`keeps ${kind}, preview and text across unsupported models, blocks Enter/direct submit, and sends the identical draft after switching back`, async () => {
      const bar = setup(); const compatible = kind === 'audio' ? 'audio-test' : 'vision-test';
      bar.setModel(compatible); const attachment = file(kind); await add(bar, kind, attachment);
      const pendingKey = `_pending${kind[0].toUpperCase()}${kind.slice(1)}`; const original = bar[pendingKey];
      input(bar).value = 'keep my text'; bar.setModel('text-test');
      expect(bar[pendingKey]).toBe(original); expect(bar[pendingKey].file).toBe(attachment);
      expect(input(bar).value).toBe('keep my text');
      expect(bar.el.querySelector(`#${kind}-preview-area`).classList.contains('hidden')).toBe(false);
      expect(status(bar).classList.contains('hidden')).toBe(false); expect(status(bar).textContent).toContain('attachment kept');
      expect(send(bar).disabled).toBe(true); expect(send(bar).getAttribute('aria-disabled')).toBe('true');
      expect(send(bar).title).toBe(status(bar).textContent);
      const handler = vi.fn(); document.addEventListener('inputbar:send', handler);
      try {
        input(bar).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); bar._submit(); send(bar).click();
        expect(handler).not.toHaveBeenCalled(); expect(input(bar).value).toBe('keep my text'); expect(bar[pendingKey]).toBe(original);
        bar.setModel(compatible); expect(send(bar).disabled).toBe(false); expect(status(bar).classList.contains('hidden')).toBe(true);
        send(bar).click(); expect(handler).toHaveBeenCalledOnce(); expect(handler.mock.calls[0][0].detail[kind]).toBe(original);
      } finally { document.removeEventListener('inputbar:send', handler); }
      expect(bar._fileToDataUrl).toHaveBeenCalledTimes(kind === 'audio' ? 0 : 1);
    });

    it(`keeps Remove available for incompatible ${kind} and restores text sending`, async () => {
      const bar = setup(); bar.setModel(kind === 'audio' ? 'audio-test' : 'vision-test'); await add(bar, kind, file(kind));
      input(bar).value = 'text stays'; bar.setModel('text-test');
      const remove = bar.el.querySelector(`#remove-${kind}-btn`); expect(remove.disabled).toBe(false); remove.click();
      expect(status(bar).classList.contains('hidden')).toBe(true); expect(send(bar).disabled).toBe(false); expect(input(bar).value).toBe('text stays');
    });
  }

  it('preserves video/audio across Draw mode, guards all pending attachments and resumes when Draw is disabled', async () => {
    for (const kind of ['video', 'audio']) {
      const bar = setup(); bar.setModel('mixed-test'); bar._setDrawMode(false); await add(bar, kind, file(kind));
      const original = kind === 'video' ? bar._pendingVideo : bar._pendingAudio;
      input(bar).value = 'draft'; bar._setDrawMode(true);
      expect(kind === 'video' ? bar._pendingVideo : bar._pendingAudio).toBe(original);
      expect(send(bar).disabled).toBe(true); expect(bar.el.querySelector('#audio-upload-btn').disabled).toBe(true);
      const dispatch = vi.spyOn(document, 'dispatchEvent'); bar._submit(); expect(dispatch).not.toHaveBeenCalled(); dispatch.mockRestore();
      expect(input(bar).value).toBe('draft'); bar._setDrawMode(false); expect(send(bar).disabled).toBe(false);
      expect(kind === 'video' ? bar._pendingVideo : bar._pendingAudio).toBe(original);
      bar.el.remove();
    }
  });

  it('uses a retained image in Draw mode and keeps it when returning to Vision', async () => {
    const bar = setup(); bar.setModel('vision-test'); await add(bar, 'image', file('image')); const original = bar._pendingImage;
    bar.setModel('mixed-test'); expect(bar._drawMode).toBe(true); expect(send(bar).disabled).toBe(false); expect(bar._pendingImage).toBe(original);
    bar._setDrawMode(false); expect(send(bar).disabled).toBe(false); expect(bar._pendingImage).toBe(original);
    bar.setModel('text-test'); expect(send(bar).disabled).toBe(true); expect(bar._pendingImage).toBe(original);
  });

  it('updates retained drafts on capability and endpoint changes without reading again', async () => {
    const bar = setup(); store.saveEndpoints([{ id: 'draft-a', name: 'A', baseUrl: 'http://draft-a.local' }, { id: 'draft-b', name: 'B', baseUrl: 'http://draft-b.local' }]);
    store.saveModelCapabilities('http://draft-a.local', { shared: { image: true } }); store.saveModelCapabilities('http://draft-b.local', { shared: { image: false } });
    store.setActiveEndpointId('draft-a'); bar.setModel('shared'); await add(bar, 'image', file('image')); const original = bar._pendingImage;
    store.setActiveEndpointId('draft-b'); bar.setModel('shared'); expect(send(bar).disabled).toBe(true); expect(bar._pendingImage).toBe(original);
    store.saveModelCapabilities('http://draft-b.local', { shared: { image: true } }); document.dispatchEvent(new CustomEvent('caps:changed'));
    expect(send(bar).disabled).toBe(false); expect(bar._pendingImage).toBe(original); expect(bar._fileToDataUrl).toHaveBeenCalledOnce();
  });

  it('keeps Stop enabled with an incompatible draft, then restores the blocked send state', async () => {
    const bar = setup(); bar.setModel('vision-test'); await add(bar, 'image', file('image')); bar.setSending(true); bar.setModel('text-test');
    const stop = vi.fn(); document.addEventListener('inputbar:stop', stop);
    try { expect(send(bar).disabled).toBe(false); expect(send(bar).getAttribute('aria-label')).toBe('Stop generation'); send(bar).click(); expect(stop).toHaveBeenCalledOnce(); }
    finally { document.removeEventListener('inputbar:stop', stop); }
    bar.setSending(false); expect(send(bar).disabled).toBe(true); expect(send(bar).title).toContain('attachment kept');
  });

  it('replaces video with audio and ignores a stale image read after a newer selection', async () => {
    const bar = setup(); bar.setModel('mixed-test'); bar._setDrawMode(false); await add(bar, 'video', file('video'));
    const audio = file('audio'); bar._handleAudioFile(audio); expect(bar._pendingVideo).toBeNull(); expect(bar._pendingAudio.file).toBe(audio);
    let finish; bar._fileToDataUrl.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const reading = bar._handleImageFile(file('image')); expect(send(bar).disabled).toBe(true);
    bar._handleAudioFile(audio); finish('data:image/png;base64,stale'); await reading;
    expect(bar._pendingImage).toBeNull(); expect(bar._pendingAudio.file).toBe(audio); expect(send(bar).disabled).toBe(false);
  });

  it('finishes an in-flight image read after a model switch without dropping it or allowing an incompatible send', async () => {
    const bar = setup(); bar.setModel('vision-test'); let finish;
    bar._fileToDataUrl.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const attachment = file('image'); const reading = bar._handleImageFile(attachment); input(bar).value = 'keep'; bar.setModel('text-test');
    bar._submit(); expect(input(bar).value).toBe('keep'); finish('data:image/png;base64,finished'); await reading;
    expect(bar._pendingImage.file).toBe(attachment); expect(send(bar).disabled).toBe(true); expect(status(bar).textContent).toContain('Image attachment kept');
    bar.setModel('vision-test'); expect(send(bar).disabled).toBe(false); expect(bar._pendingImage.dataUrl).toBe('data:image/png;base64,finished');
  });

  it('leaves the empty-draft UI unchanged and rejects audio paste while in Draw mode', async () => {
    const bar = setup(); bar.setModel('mixed-test'); expect(status(bar).classList.contains('hidden')).toBe(true); expect(send(bar).disabled).toBe(false);
    const preventDefault = vi.fn(); await bar._handlePaste({ preventDefault, clipboardData: { items: [{ type: 'audio/wav', getAsFile: () => file('audio') }] } });
    expect(preventDefault).not.toHaveBeenCalled(); expect(bar._pendingAudio).toBeNull();
  });
});

describe('InputBar – upstream feature integration', () => {
  const textarea = bar => bar.el.querySelector('#message-input');
  const button = bar => bar.el.querySelector('#send-btn');
  function allModes(bar) {
    store.saveModelCapabilities({ 'integration-model': { text: true, image: true, audio: true, imageGen: true, tts: true } });
    bar.setModel('integration-model'); bar._setTTSMode(false); bar._setDrawMode(false);
  }

  it('recalls original audio/document instructions without synthetic summaries or extracted text', () => {
    const bar = makeBar();
    bar.setInputHistory('a', [
      { role: 'user', content: 'ordinary text' },
      { role: 'user', content: 'Document upload: report.md', apiContent: 'secret extraction', meta: { type: 'document', instruction: 'compare the report' } },
      { role: 'user', content: 'Audio upload: call.wav', meta: { type: 'audio', instruction: 'summarize the call' } },
      { role: 'user', content: 'Document upload: old.md', meta: { type: 'document' } },
      { role: 'assistant', content: 'response' },
    ]);
    const up = () => textarea(bar).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    up(); expect(textarea(bar).value).toBe('summarize the call');
    up(); expect(textarea(bar).value).toBe('compare the report');
    up(); expect(textarea(bar).value).toBe('ordinary text');
  });

  it('keeps Prompt Library insertion as an editable draft after recalling history', () => {
    const bar = makeBar(); bar.setInputHistory('a', [{ role: 'user', content: 'previous' }]);
    textarea(bar).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    const prompt = store.savePrompt({ name: 'Reusable', content: 'new prompt' }); bar._usePrompt(prompt.id);
    expect(textarea(bar).value).toContain('new prompt'); expect(bar._historyIndex).toBeNull();
    const before = textarea(bar).value; textarea(bar).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })); expect(textarea(bar).value).toBe(before);
    bar._togglePromptPanel(true); expect(bar.el.querySelector('#prompt-panel').classList.contains('hidden')).toBe(false);
  });

  it('preserves a document through Draw and Speak, then sends its original extraction in chat mode', async () => {
    const bar = makeBar(); allModes(bar);
    const file = new File(['# original report'], 'report.md', { type: 'text/markdown' });
    await bar._handleDocumentFile(file); const attachment = bar._pendingDocument; textarea(bar).value = 'compare';
    for (const mode of ['draw', 'speak']) {
      if (mode === 'draw') bar._setDrawMode(true); else bar._setTTSMode(true);
      expect(bar._pendingDocument).toBe(attachment); expect(button(bar).disabled).toBe(true);
      expect(bar.el.querySelector('#document-preview-area').classList.contains('hidden')).toBe(false);
      const send = vi.fn(); document.addEventListener('inputbar:send', send);
      try { bar._submit(); expect(send).not.toHaveBeenCalled(); expect(textarea(bar).value).toBe('compare'); }
      finally { document.removeEventListener('inputbar:send', send); }
    }
    bar._setTTSMode(false); expect(button(bar).disabled).toBe(false);
    const send = vi.fn(); document.addEventListener('inputbar:send', send);
    try { bar._submit(); expect(send.mock.calls[0][0].detail.document).toBe(attachment); }
    finally { document.removeEventListener('inputbar:send', send); }
  });

  it('continues document extraction after a mode switch, while removal invalidates a pending extraction', async () => {
    const bar = makeBar(); allModes(bar); let finish;
    const file = new File(['unused'], 'pending.md', { type: 'text/markdown' });
    Object.defineProperty(file, 'slice', { value: () => ({ size: file.size, text: () => new Promise(resolve => { finish = resolve; }) }) });
    const extraction = bar._handleDocumentFile(file); expect(button(bar).disabled).toBe(true);
    bar._setTTSMode(true); finish('document body'); await extraction;
    expect(bar._pendingDocument.status).toBe('ready'); expect(button(bar).disabled).toBe(true);
    bar._setTTSMode(false); expect(button(bar).disabled).toBe(false);
    const second = bar._handleDocumentFile(file); bar._clearDocument(); finish('too late'); await second;
    expect(bar._pendingDocument).toBeNull(); expect(button(bar).disabled).toBe(false);
  });

  it('blocks each completed attachment in Speak mode and restores the same draft afterward', async () => {
    const bar = makeBar(); allModes(bar);
    vi.spyOn(bar, '_fileToDataUrl').mockResolvedValue('data:media;base64,original');
    vi.spyOn(bar, '_extractVideoFrames').mockResolvedValue(['data:image/jpeg;base64,frame']);
    for (const kind of ['image', 'video', 'audio']) {
      const file = new File(['data'], `${kind}.bin`, { type: `${kind}/${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav'}` });
      if (kind === 'audio') bar._handleAudioFile(file); else await bar[kind === 'image' ? '_handleImageFile' : '_handleVideoFile'](file);
      const key = `_pending${kind[0].toUpperCase()}${kind.slice(1)}`; const attachment = bar[key];
      bar._setTTSMode(true); expect(bar[key]).toBe(attachment); expect(button(bar).disabled).toBe(true);
      expect(bar.el.querySelector('#media-upload-btn').disabled).toBe(true); expect(bar.el.querySelector('#audio-upload-btn').disabled).toBe(true);
      bar._submit(); expect(bar[key]).toBe(attachment);
      bar._setTTSMode(false); expect(button(bar).disabled).toBe(false); expect(bar[key]).toBe(attachment);
    }
    expect(bar._pendingVideo).toBeNull(); // selecting audio explicitly replaced the earlier video
  });

  it('preserves sampled video frames and hints across incompatible models', async () => {
    const bar = makeBar(); bar.setModel('gpt-4o');
    vi.spyOn(bar, '_fileToDataUrl').mockResolvedValue('data:video/mp4;base64,video');
    const frames = ['data:image/jpeg;base64,a', 'data:image/jpeg;base64,b'];
    vi.spyOn(bar, '_extractVideoFrames').mockResolvedValue(frames);
    await bar._handleVideoFile(new File(['v'], 'clip.mp4', { type: 'video/mp4' })); const attachment = bar._pendingVideo;
    bar.setModel('gpt-4'); expect(bar._pendingVideo.frames).toBe(frames); expect(button(bar).disabled).toBe(true);
    bar.setModel('gpt-4o'); expect(bar._pendingVideo).toBe(attachment); expect(button(bar).disabled).toBe(false);
    expect(bar.el.querySelector('.video-frame-hint').textContent).toContain('2'); expect(bar._extractVideoFrames).toHaveBeenCalledOnce();
  });

  it('discards an active recording on incompatible mode changes but preserves a completed recording', async () => {
    const bar = makeBar(); allModes(bar);
    const stop = vi.fn(async () => null); bar._recorder = { recording: true, stop, duration: 2 };
    bar._setTTSMode(true); expect(stop).toHaveBeenCalledWith({ discard: true }); expect(bar._recorder).toBeNull();
    await Promise.resolve(); bar._setTTSMode(false);
    const file = new File(['audio'], 'microphone.wav', { type: 'audio/wav' }); bar._pendingAudio = { file, source: 'microphone' }; bar._showAudioPreview();
    bar._setDrawMode(true); expect(bar._pendingAudio.file).toBe(file); expect(button(bar).disabled).toBe(true);
    bar._setDrawMode(false); expect(button(bar).disabled).toBe(false); expect(stop).toHaveBeenCalledOnce();
  });
});

it('releases a microphone whose permission/start finishes after switching to Speak', async () => {
  const bar = makeBar();
  store.saveModelCapabilities({ 'record-and-speak': { text: true, audio: true, tts: true } });
  bar.setModel('record-and-speak'); bar._setTTSMode(false);
  let finishStart;
  const start = vi.spyOn(MicrophoneRecorder.prototype, 'start').mockImplementation(function () {
    return new Promise(resolve => { finishStart = () => { this.recording = true; resolve(); }; });
  });
  const stop = vi.spyOn(MicrophoneRecorder.prototype, 'stop').mockImplementation(async function () { this.recording = false; return null; });
  try {
    const recording = bar._toggleMicrophone();
    expect(bar.el.querySelector('#send-btn').disabled).toBe(true);
    bar._setTTSMode(true); finishStart(); await recording;
    expect(bar._recorder).toBeNull(); expect(bar._pendingAudio).toBeNull();
    expect(stop).toHaveBeenLastCalledWith({ discard: true });
    expect(bar.el.querySelector('#audio-preview-area').classList.contains('hidden')).toBe(true);
    expect(bar.el.querySelector('#send-btn').disabled).toBe(false);
  } finally { start.mockRestore(); stop.mockRestore(); }
});

it('ignores late video frame extraction after selecting another attachment', async () => {
  const bar = makeBar();
  store.saveModelCapabilities({ 'media-and-audio': { text: true, image: true, audio: true } }); bar.setModel('media-and-audio');
  vi.spyOn(bar, '_fileToDataUrl').mockResolvedValue('data:video/mp4;base64,clip');
  let finish;
  vi.spyOn(bar, '_extractVideoFrames').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const video = bar._handleVideoFile(new File(['video'], 'clip.mp4', { type: 'video/mp4' }));
  await Promise.resolve();
  const audio = new File(['audio'], 'replacement.wav', { type: 'audio/wav' }); bar._handleAudioFile(audio);
  finish(['data:image/jpeg;base64,late']); await video;
  expect(bar._pendingVideo).toBeNull(); expect(bar._pendingAudio.file).toBe(audio);
  expect(bar.el.querySelector('.video-frame-hint')).toBeNull();
});

describe('InputBar – textarea sizing', () => {
  function geometry(textarea, initial = 42) {
    let width = 600;
    let contentHeight = initial;
    textarea.style.borderWidth = '0px';
    vi.spyOn(textarea, 'getBoundingClientRect').mockImplementation(() => ({ width }));
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, get: () => contentHeight });
    Object.defineProperty(textarea, 'clientHeight', { configurable: true, get: () => Number.parseFloat(textarea.style.height) || 42 });
    return { width: value => { width = value; }, content: value => { contentHeight = value; } };
  }

  it('measures on mount, grows up to 144px, and only enables scrolling for real overflow', async () => {
    const bar = makeBar(); const textarea = bar.el.querySelector('#message-input'); const size = geometry(textarea);
    await Promise.resolve(); expect(textarea.style.height).toBe('42px'); expect(textarea.style.overflowY).toBe('hidden');
    for (const height of [69, 95, 143, 144]) {
      size.content(height); textarea.dispatchEvent(new Event('input'));
      expect(textarea.style.height).toBe(`${height}px`); expect(textarea.style.overflowY).toBe('hidden');
    }
    size.content(541); textarea.dispatchEvent(new Event('input'));
    expect(textarea.style.height).toBe('144px'); expect(textarea.style.overflowY).toBe('auto');
    size.content(42); textarea.value = ''; textarea.dispatchEvent(new Event('input'));
    expect(textarea.style.height).toBe('42px'); expect(textarea.style.overflowY).toBe('hidden');
  });

  it('remeasures changed width and ignores its own height/scrollbar notifications', () => {
    let notify; const disconnect = vi.fn(); const observe = vi.fn();
    vi.stubGlobal('ResizeObserver', class { constructor(callback) { notify = callback; } observe = observe; disconnect = disconnect; });
    try {
      const bar = makeBar(); const textarea = bar.el.querySelector('#message-input'); const size = geometry(textarea, 95);
      const resize = vi.spyOn(bar, '_autoResize');
      notify(); expect(textarea.style.height).toBe('95px'); expect(observe).toHaveBeenCalledWith(textarea);
      size.width(300); size.content(174); notify(); expect(textarea.style.height).toBe('144px'); expect(textarea.style.overflowY).toBe('auto');
      const calls = resize.mock.calls.length; notify(); expect(resize).toHaveBeenCalledTimes(calls);
      size.width(600); size.content(95); notify(); expect(textarea.style.height).toBe('95px'); expect(textarea.style.overflowY).toBe('hidden');
      bar.render(); expect(disconnect).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });

  it('handles window resizing when ResizeObserver is unavailable and leaves hidden inputs uncollapsed', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    try {
      const bar = makeBar(); const textarea = bar.el.querySelector('#message-input'); const size = geometry(textarea, 95);
      window.dispatchEvent(new Event('resize')); expect(textarea.style.height).toBe('95px');
      size.width(300); size.content(174); window.dispatchEvent(new Event('resize'));
      expect(textarea.style.height).toBe('144px'); expect(textarea.style.overflowY).toBe('auto');
      size.width(0); size.content(0); window.dispatchEvent(new Event('resize')); expect(textarea.style.height).toBe('144px');
      textarea.remove(); size.width(600); bar._autoResize(textarea); expect(textarea.style.height).toBe('144px');
    } finally { vi.unstubAllGlobals(); }
  });

  it('recalculates recalled, prompted and composing text without leaving stale scroll state', () => {
    const bar = makeBar(); const textarea = bar.el.querySelector('#message-input'); const size = geometry(textarea, 541);
    bar.setInputHistory('resize-conversation', [{ role: 'user', content: 'previous\n'.repeat(30) }]);
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })); expect(textarea.style.overflowY).toBe('auto');
    size.content(42); textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })); expect(textarea.style.height).toBe('42px'); expect(textarea.style.overflowY).toBe('hidden');
    const prompt = store.savePrompt({ name: 'Sizing', content: 'prompt text' }); size.content(95); bar._usePrompt(prompt.id);
    expect(textarea.style.height).toBe('95px'); expect(textarea.style.overflowY).toBe('hidden');
    textarea.dispatchEvent(new CompositionEvent('compositionstart')); size.content(541); textarea.dispatchEvent(new Event('input'));
    const submit = vi.spyOn(bar, '_submit'); textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true })); expect(submit).not.toHaveBeenCalled();
    textarea.dispatchEvent(new CompositionEvent('compositionend')); size.content(42); textarea.value = ''; textarea.dispatchEvent(new Event('input'));
    expect(textarea.style.height).toBe('42px'); expect(textarea.style.overflowY).toBe('hidden');
  });
});

describe('InputBar – media replacement failures', () => {
  function setup(kind = 'image') {
    const bar = makeBar(); bar.setModel('gpt-4o');
    const attachment = { file: new File(['old'], `old.${kind}`, { type: `${kind}/${kind === 'image' ? 'png' : 'mp4'}` }), dataUrl: `data:${kind};base64,old`, ...(kind === 'video' ? { frames: ['old-frame'] } : {}) };
    bar[kind === 'image' ? '_pendingImage' : '_pendingVideo'] = attachment;
    bar[kind === 'image' ? '_showImagePreview' : '_showVideoPreview'](attachment.dataUrl);
    bar.el.querySelector('textarea').value = 'keep this instruction';
    return { bar, attachment };
  }

  for (const kind of ['image', 'video']) {
    it(`preserves the old ${kind} and preview if its replacement cannot be read`, async () => {
      const { bar, attachment } = setup(kind); let fail;
      vi.spyOn(bar, '_fileToDataUrl').mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
      const replacement = new File(['new'], `new.${kind}`, { type: `${kind}/${kind === 'image' ? 'png' : 'mp4'}` });
      const reading = bar[kind === 'image' ? '_handleImageFile' : '_handleVideoFile'](replacement);
      const key = kind === 'image' ? '_pendingImage' : '_pendingVideo';
      expect(bar[key]).toBe(attachment); expect(bar.el.querySelector(`#${kind}-preview-area`).classList.contains('hidden')).toBe(false);
      expect(bar.el.querySelector('#send-btn').disabled).toBe(true);
      fail(new Error('read failed')); await expect(reading).rejects.toThrow('read failed');
      expect(bar[key]).toBe(attachment); expect(bar.el.querySelector('textarea').value).toBe('keep this instruction');
      expect(bar.el.querySelector('#send-btn').disabled).toBe(false);
    });
  }

  it('does not revive a draft removed while its replacement was reading', async () => {
    const { bar } = setup(); let finish;
    vi.spyOn(bar, '_fileToDataUrl').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const reading = bar._handleImageFile(new File(['new'], 'new.png', { type: 'image/png' }));
    bar.el.querySelector('#remove-image-btn').click(); finish('data:image/png;base64,new'); await reading;
    expect(bar._pendingImage).toBeNull(); expect(bar._readingAttachment).toBe(false);
    expect(bar.el.querySelector('#image-preview-area').classList.contains('hidden')).toBe(true);
  });

  it('keeps the newest successful selection when an older replacement later fails', async () => {
    const { bar, attachment } = setup(); let failOld; let finishNew;
    vi.spyOn(bar, '_fileToDataUrl')
      .mockImplementationOnce(() => new Promise((_, reject) => { failOld = reject; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
    const oldRead = bar._handleImageFile(new File(['first'], 'first.png', { type: 'image/png' }));
    const oldFailure = expect(oldRead).rejects.toThrow('stale failure');
    const newest = new File(['second'], 'second.png', { type: 'image/png' });
    const newRead = bar._handleImageFile(newest); expect(bar._pendingImage).toBe(attachment);
    finishNew('data:image/png;base64,newest'); await newRead; const committed = bar._pendingImage;
    failOld(new Error('stale failure')); await oldFailure;
    expect(bar._pendingImage).toBe(committed); expect(committed.file).toBe(newest); expect(bar._readingAttachment).toBe(false);
    expect(bar.el.querySelector('#send-btn').disabled).toBe(false);
  });
});
