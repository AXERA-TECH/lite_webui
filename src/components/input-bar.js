import { store } from '../store.js';
import { estimateTextTokens, formatCompactTokenCount } from '../api.js';
import {
  getCapabilities,
  supportsAudio,
  supportsImage,
  supportsImageGen,
  supportsTTS,
  supportsVideo,
} from '../capabilities.js';
import {
  DOCUMENT_FILE_SIZE_LIMIT_MB,
  documentAccept,
  extractDocumentText,
  isDocumentFile,
} from '../documents.js';
import { icon } from '../icons.js';
import { DEFAULT_CONTEXT_LIMIT_TOKENS, resolveContextConfig } from '../context.js';
import { MicrophoneRecorder } from '../audio.js';

const VIDEO_SIZE_LIMIT_MB = 50;
// Video is sent as N still frames (the AX8860 vision backend cannot encode merged video frames).
// Defaults live in the settings dialog (Video Input section).
const DEFAULT_VIDEO_FRAME_COUNT = 8;
const DEFAULT_VIDEO_FRAME_MAX_SIDE = 448;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatRecordingDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export class InputBar {
  constructor() {
    this.el = null;
    this._pendingImage = null; // { dataUrl, file }
    this._pendingVideo = null; // { dataUrl, file }
    this._pendingAudio = null; // { file }
    this._pendingDocument = null; // { file, status, error, extracted }
    this._currentModel = '';
    this._sending = false;
    this._drawMode = false;
    this._ttsMode = false;
    this._promptOpen = false;
    this._recorder = null;
    this._lastRecordingDuration = 0;
    this._attachmentReadToken = 0;
    this._readingAttachment = false;
    this._composing = false;
    this._historyScope = null;
    this._inputHistory = [];
    this._historyIndex = null;
    this._recalled = null;
  }

  render() {
    const el = document.createElement('div');
    el.className = 'border-t border-[var(--c-bd)] bg-[var(--c-bg)]';
    el.innerHTML = this._template();
    this.el = el;
    this._bindEvents();
    return this.el;
  }

  _template() {
    const imageSupported = supportsImage(this._currentModel, store.getModelCapabilities());
    const videoSupported = supportsVideo(this._currentModel, store.getModelCapabilities());
    const audioSupported = supportsAudio(this._currentModel, store.getModelCapabilities());
    const imageGenSupported = supportsImageGen(this._currentModel, store.getModelCapabilities());
    const ttsSupported = supportsTTS(this._currentModel, store.getModelCapabilities());
    const mediaSupported = imageSupported || videoSupported;
        const mediaAccept = [imageSupported && 'image/*', videoSupported && 'video/*'].filter(Boolean).join(',') || 'image/*,video/*';
    const mediaTitle = mediaSupported
      ? `Attach ${[imageSupported && 'image', videoSupported && 'video'].filter(Boolean).join(' / ')} (or paste)`
      : 'Vision not enabled for this model';
    const drawTitle = imageGenSupported ? 'Generate image (Draw mode)' : 'Image generation not enabled for this model';
    const speakTitle = ttsSupported ? 'Generate speech (Speak mode)' : 'Speech generation not enabled for this model';
    const placeholder = this._drawMode
      ? 'Describe what to draw…'
      : this._ttsMode
        ? 'Enter text to speak…'
        : 'Type a message…';
    const inputBoxClass = this._drawMode
      ? 'border-violet-400 dark:border-violet-500'
      : this._ttsMode
        ? 'border-emerald-400 dark:border-emerald-500'
        : 'border-[var(--c-bd)]';
    return `
      <div class="px-4 pb-4 pt-3 max-w-4xl mx-auto w-full">
        <input id="media-file-input" type="file" accept="${mediaAccept}" class="hidden" aria-label="Attach image or video" />
        <input id="audio-file-input" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm" class="hidden" aria-label="Attach audio" />
        <input id="document-file-input" type="file" accept="${documentAccept()}" class="hidden" aria-label="Attach document" />
        <div id="input-box" class="flex flex-col bg-[var(--c-card)] border ${inputBoxClass} rounded-2xl focus-within:border-[var(--c-bd-hi)] transition-all duration-200 shadow-lg shadow-black/10">

          <div id="image-preview-area" class="hidden px-3 pt-3 pb-1">
            <div class="relative inline-block">
              <img id="image-preview-thumb" src="" alt="Attached image"
                class="max-h-24 max-w-[200px] rounded-xl border border-[var(--c-bd)] object-cover" />
              <button id="remove-image-btn"
                class="absolute -top-1.5 -right-1.5 bg-[var(--c-card)] border border-[var(--c-bd)] rounded-full w-5 h-5 flex items-center justify-center text-[var(--c-tx3)] hover:text-[var(--c-tx)] transition-colors"
                aria-label="Remove image">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          <div id="video-preview-area" class="hidden px-3 pt-3 pb-1">
            <div class="relative inline-block">
              <video id="video-preview-player" src="" controls muted playsinline
                class="max-h-36 max-w-xs rounded-xl border border-[var(--c-bd)] bg-black"></video>
              <button id="remove-video-btn"
                class="absolute -top-1.5 -right-1.5 bg-[var(--c-card)] border border-[var(--c-bd)] rounded-full w-5 h-5 flex items-center justify-center text-[var(--c-tx3)] hover:text-[var(--c-tx)] transition-colors"
                aria-label="Remove video">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          <div id="audio-preview-area" class="hidden px-3 pt-3 pb-1">
            <div class="flex items-center gap-2 rounded-xl border border-[var(--c-bd)] bg-[var(--c-ho)] px-3 py-2">
              <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--c-hi)] text-[var(--c-tx3)]">
                ${icon('audio')}
              </div>
              <div class="min-w-0 flex-1">
                <div id="audio-file-name" class="truncate text-[13px] text-[var(--c-tx2)]"></div>
                <div id="audio-mode-label" class="text-[11px] text-[var(--c-tx3)]">Audio will be transcribed before text processing</div>
              </div>
              <button id="remove-audio-btn"
                class="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--c-bd)] bg-[var(--c-ho)] text-[var(--c-tx3)] transition-colors hover:text-[var(--c-tx2)]"
                aria-label="Remove audio"
                type="button">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          <div id="document-preview-area" class="hidden px-3 pt-3 pb-1">
            <div class="flex items-center gap-2 rounded-xl border border-[var(--c-bd)] bg-[var(--c-ho)] px-3 py-2">
              <div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--c-hi)] text-[var(--c-tx3)]">
                ${icon('file')}
              </div>
              <div class="min-w-0 flex-1">
                <div id="document-file-name" class="truncate text-[13px] text-[var(--c-tx2)]"></div>
                <div id="document-status" class="text-[11px] text-[var(--c-tx3)]">Extracting text…</div>
              </div>
              <button id="remove-document-btn"
                class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-[var(--c-bd)] bg-[var(--c-ho)] text-[var(--c-tx3)] transition-colors hover:text-[var(--c-tx2)]"
                aria-label="Remove document"
                type="button">
                ${icon('x')}
              </button>
            </div>
          </div>

          <div id="prompt-panel" class="${this._promptOpen ? 'flex' : 'hidden'} flex-col gap-2 border-b border-[var(--c-bd)] bg-[var(--c-ho)] px-3 py-3">
            <div class="flex items-center justify-between gap-2">
              <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--c-tx3)]">Prompt Library</div>
              <button id="close-prompt-btn" type="button"
                class="rounded-md p-1 text-[var(--c-tx3)] transition-colors hover:bg-[var(--c-hi)] hover:text-[var(--c-tx2)]"
                aria-label="Close Prompt Library">
                ${icon('x')}
              </button>
            </div>
            <div id="prompt-list" class="max-h-44 space-y-1 overflow-y-auto" role="list" aria-label="Saved prompts"></div>
            <div class="flex items-center gap-2">
              <input id="prompt-name-input" type="text"
                class="min-w-0 flex-1 rounded-lg border border-[var(--c-bd)] bg-[var(--c-card)] px-2.5 py-1.5 text-[12px] text-[var(--c-tx2)] placeholder-[var(--c-txph)] focus:border-[var(--c-bd-hi)] focus:outline-none"
                placeholder="Save current input as…" aria-label="New prompt name" />
              <button id="save-prompt-btn" type="button"
                class="rounded-lg border border-[var(--c-bd)] px-2.5 py-1.5 text-[11px] text-[var(--c-tx2)] transition-colors hover:bg-[var(--c-hi)] hover:text-[var(--c-tx)]">
                Save
              </button>
            </div>
          </div>

          <div id="attachment-status" role="status" aria-live="polite"
            class="hidden mx-3 mt-2 px-2 py-1 rounded-md border border-[var(--c-bd)] text-[11px] text-[var(--c-tx3)]"></div>

          <textarea
            id="message-input"
            class="bg-transparent px-4 pt-3 pb-1 msg-text text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none resize-none w-full"
            placeholder="${placeholder}"
            rows="1"
            style="max-height: 144px; overflow-y: auto;"
            aria-label="Message input"
            title="Enter to send · Shift+Enter for new line · ↑ in an empty input browses your message history"
          ></textarea>

          <div class="flex items-center justify-between px-2 pb-2 pt-1 gap-2">
            <div class="flex items-center gap-0.5">
              <button id="media-upload-btn"
                class="flex items-center justify-center w-8 h-8 rounded-lg transition-all ${mediaSupported ? 'text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-hi)]' : 'text-[var(--c-tx3)] opacity-40 cursor-not-allowed'}"
                ${mediaSupported ? '' : 'disabled'}
                aria-label="Attach image or video"
                title="${mediaTitle}">
                ${icon('image')}
              </button>
              <button id="audio-upload-btn"
                class="flex items-center justify-center w-8 h-8 rounded-lg transition-all ${audioSupported ? 'text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-hi)]' : 'text-[var(--c-tx3)] opacity-40 cursor-not-allowed'}"
                ${audioSupported ? '' : 'disabled'}
                aria-label="Attach audio"
                title="${audioSupported ? 'Attach audio for transcription or translation' : 'Audio not enabled for this model'}">
                ${icon('audio')}
              </button>
              <button id="record-audio-btn" type="button"
                class="flex items-center justify-center w-8 h-8 rounded-lg transition-all ${audioSupported ? 'text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-hi)]' : 'text-[var(--c-tx3)] opacity-40 cursor-not-allowed'}"
                ${audioSupported ? '' : 'disabled'}
                aria-label="Record microphone"
                aria-pressed="false"
                title="${audioSupported ? 'Record microphone for ASR' : 'Audio not enabled for this model'}">
                ${icon('mic')}
              </button>
              <button id="draw-mode-btn"
                class="flex items-center justify-center w-8 h-8 rounded-lg transition-all ${imageGenSupported ? (this._drawMode ? 'text-violet-500 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/30' : 'text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-hi)]') : 'text-[var(--c-tx3)] opacity-40 cursor-not-allowed'}"
                ${imageGenSupported ? '' : 'disabled'}
                aria-label="Toggle draw mode"
                title="${drawTitle}">
                ${icon('wand')}
              </button>
              <button id="tts-mode-btn"
                class="flex items-center justify-center w-8 h-8 rounded-lg transition-all ${ttsSupported ? (this._ttsMode ? 'text-emerald-500 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30' : 'text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-hi)]') : 'text-[var(--c-tx3)] opacity-40 cursor-not-allowed'}"
                ${ttsSupported ? '' : 'disabled'}
                aria-label="Toggle speak mode"
                title="${speakTitle}">
                ${icon('speaker')}
              </button>
              <button id="prompt-btn" type="button"
                class="flex items-center justify-center w-8 h-8 rounded-lg transition-all text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-hi)]"
                aria-label="Toggle Prompt Library"
                aria-expanded="${this._promptOpen}"
                title="Prompt Library">
                ${icon('sparkle')}
              </button>
              <button id="document-upload-btn" type="button"
                class="flex items-center justify-center w-8 h-8 rounded-lg transition-all text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-hi)]"
                aria-label="Attach document"
                title="Attach TXT / Markdown / CSV / JSON / PDF / DOCX / XLSX">
                ${icon('file')}
              </button>
            </div>
            <div id="seed-wrapper" class="${this._drawMode || this._ttsMode ? 'flex' : 'hidden'} items-center gap-1.5 shrink-0">
              <span class="text-[11px] text-[var(--c-tx3)] select-none">seed</span>
              <input id="seed-input" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="random"
                class="w-[80px] text-[11px] font-mono text-[var(--c-tx2)] bg-[var(--c-hi)] border border-[var(--c-bd)] rounded-md px-2 py-0.5 placeholder-[var(--c-txph)] focus:outline-none focus:border-violet-400 dark:focus:border-violet-500 transition-colors"
                aria-label="Generation seed (optional, leave blank for random)"
                title="Seed for reproducible generation — leave blank for random"
              />
              <button id="seed-reroll-btn" type="button"
                class="flex items-center justify-center w-6 h-6 rounded-md text-[var(--c-tx3)] hover:text-violet-500 dark:hover:text-violet-400 hover:bg-[var(--c-hi)] transition-colors"
                aria-label="Randomize seed"
                title="Randomize seed">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/></svg>
              </button>
            </div>
            <span id="context-info"
              class="ml-auto text-right text-[11px] font-mono tabular-nums text-[var(--c-tx3)] transition-colors select-none"
              title="Estimated context tokens / configured window">ctx 0</span>
            <button id="send-btn"
              class="flex items-center justify-center w-8 h-8 rounded-xl transition-all hover:bg-[var(--c-hi)]"
              aria-label="Send message"
              title="Send (Enter) · Shift+Enter for new line">
              ${icon('send')}
            </button>
          </div>

        </div>
      </div>
    `;
  }

  _bindEvents() {
    const textarea = this.el.querySelector('#message-input');
    const sendBtn = this.el.querySelector('#send-btn');
    const mediaBtn = this.el.querySelector('#media-upload-btn');
    const audioBtn = this.el.querySelector('#audio-upload-btn');
    const recordBtn = this.el.querySelector('#record-audio-btn');
    const drawBtn = this.el.querySelector('#draw-mode-btn');
    const ttsBtn = this.el.querySelector('#tts-mode-btn');
    const promptBtn = this.el.querySelector('#prompt-btn');
    const documentBtn = this.el.querySelector('#document-upload-btn');
    const fileInput = this.el.querySelector('#media-file-input');
    const audioInput = this.el.querySelector('#audio-file-input');
    const documentInput = this.el.querySelector('#document-file-input');
    const removeImageBtn = this.el.querySelector('#remove-image-btn');
    const removeVideoBtn = this.el.querySelector('#remove-video-btn');
    const removeAudioBtn = this.el.querySelector('#remove-audio-btn');

    // Auto-resize textarea
    textarea.addEventListener('input', () => {
      this._recalled = null;
      this._historyIndex = null;
      this._autoResize(textarea);
    });
    textarea.addEventListener('compositionstart', () => { this._composing = true; });
    textarea.addEventListener('compositionend', () => { this._composing = false; });

    // Enter sends; Shift+Enter inserts newline (default behaviour)
    textarea.addEventListener('keydown', (e) => {
      if (e.isComposing || this._composing || e.keyCode === 229) return;
      if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && textarea.selectionStart === textarea.selectionEnd) {
        const browsing = this._historyIndex !== null && this._recalled === textarea.value;
        if ((e.key === 'ArrowUp' && (textarea.value === '' || browsing) && this._inputHistory.length)
          || (e.key === 'ArrowDown' && browsing)) {
          e.preventDefault();
          if (e.key === 'ArrowUp') {
            this._historyIndex = browsing ? Math.max(0, this._historyIndex - 1) : this._inputHistory.length - 1;
          } else {
            this._historyIndex = this._historyIndex + 1 < this._inputHistory.length ? this._historyIndex + 1 : null;
          }
          textarea.value = this._historyIndex === null ? '' : this._inputHistory[this._historyIndex];
          this._recalled = this._historyIndex === null ? null : textarea.value;
          textarea.setSelectionRange(textarea.value.length, textarea.value.length);
          this._autoResize(textarea);
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._submit();
      }
    });

    sendBtn.addEventListener('click', () => {
      if (this._sending) {
        document.dispatchEvent(new CustomEvent('inputbar:stop'));
      } else {
        this._submit();
      }
    });

    drawBtn?.addEventListener('click', () => {
      if (!drawBtn.disabled) this._toggleDrawMode();
    });
    ttsBtn?.addEventListener('click', () => {
      if (!ttsBtn.disabled) this._toggleTTSMode();
    });

    promptBtn?.addEventListener('click', () => this._togglePromptPanel());
    this.el.querySelector('#close-prompt-btn')?.addEventListener('click', () => this._togglePromptPanel(false));
    this.el.querySelector('#save-prompt-btn')?.addEventListener('click', () => this._saveCurrentPrompt());
    this.el.querySelector('#prompt-list')?.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.delete-prompt');
      if (deleteBtn) {
        e.stopPropagation();
        store.deletePrompt(deleteBtn.dataset.promptId);
        this._renderPromptList();
        return;
      }
      const useBtn = e.target.closest('.use-prompt');
      if (useBtn) this._usePrompt(useBtn.dataset.promptId);
    });
    this.el.querySelector('#prompt-name-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._saveCurrentPrompt();
      }
    });

    this._renderPromptList();

    // Seed re-roll button
    const seedRerollBtn = this.el.querySelector('#seed-reroll-btn');
    seedRerollBtn?.addEventListener('click', () => {
      const seedInput = this.el.querySelector('#seed-input');
      if (seedInput) seedInput.value = String(Math.floor(Math.random() * 1_000_000_000));
    });

    // Media (image/video) upload
    mediaBtn?.addEventListener('click', () => {
      if (!mediaBtn.disabled) fileInput.click();
    });
    audioBtn?.addEventListener('click', () => {
      if (!audioBtn.disabled) audioInput.click();
    });
    recordBtn?.addEventListener('click', () => {
      if (!recordBtn.disabled) this._toggleMicrophone();
    });
    documentBtn?.addEventListener('click', () => {
      if (!documentBtn.disabled) documentInput.click();
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this._handleMediaFile(file);
      fileInput.value = '';
    });
    audioInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this._handleAudioFile(file);
      audioInput.value = '';
    });
    documentInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this._handleDocumentFile(file);
      documentInput.value = '';
    });

    removeImageBtn.addEventListener('click', () => this._clearImage());
    removeVideoBtn?.addEventListener('click', () => this._clearVideo());
    removeAudioBtn?.addEventListener('click', () => this._clearAudio());
    this.el.querySelector('#remove-document-btn')?.addEventListener('click', () => this._clearDocument());

    // Paste media support
    textarea.addEventListener('paste', (e) => this._handlePaste(e));

    // Model change
    document.addEventListener('model:changed', (e) => {
      this.setModel(e.detail.model);
    });
    document.addEventListener('caps:changed', () => {
      this.setModel(this._currentModel);
    });
  }

  _autoResize(textarea) {
    textarea.style.height = 'auto';
    const scrollH = textarea.scrollHeight;
    const maxH = 144; // max-height ~6 rows
    textarea.style.height = Math.min(scrollH, maxH) + 'px';
  }

  _togglePromptPanel(force = !this._promptOpen) {
    this._promptOpen = force;
    const panel = this.el?.querySelector('#prompt-panel');
    const button = this.el?.querySelector('#prompt-btn');
    if (!panel) return;
    panel.classList.toggle('hidden', !this._promptOpen);
    panel.classList.toggle('flex', this._promptOpen);
    button?.setAttribute('aria-expanded', String(this._promptOpen));
    if (this._promptOpen) {
      this._renderPromptList();
      this.el.querySelector('#prompt-name-input')?.focus();
    } else {
      this.focus();
    }
  }

  _renderPromptList() {
    const list = this.el?.querySelector('#prompt-list');
    if (!list) return;
    const prompts = store.getPrompts();
    list.innerHTML = prompts.map(prompt => `
      <div class="flex items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-[var(--c-bd)] hover:bg-[var(--c-card)]" role="listitem">
        <div class="min-w-0 flex-1">
          <button type="button" class="use-prompt block w-full truncate text-left text-[12px] text-[var(--c-tx2)]" data-prompt-id="${prompt.id}" title="Use prompt">
            ${escapeHtml(prompt.name)}
          </button>
          <div class="mt-0.5 line-clamp-2 text-[11px] leading-4 text-[var(--c-tx3)]">${escapeHtml(prompt.content.slice(0, 180))}</div>
        </div>
        ${prompt.builtin ? '' : `<button type="button" class="delete-prompt rounded-md p-1 text-[var(--c-tx3)] transition-colors hover:bg-[var(--c-hi)] hover:text-red-500" data-prompt-id="${prompt.id}" aria-label="Delete ${escapeHtml(prompt.name)}">${icon('trash')}</button>`}
      </div>
    `).join('');
  }

  _usePrompt(id) {
    const prompt = store.getPrompts().find(item => item.id === id);
    if (!prompt) return;
    const textarea = this.el.querySelector('#message-input');
    if (!textarea) return;
    const before = textarea.value.slice(0, textarea.selectionStart ?? textarea.value.length);
    const after = textarea.value.slice(textarea.selectionEnd ?? textarea.value.length);
    const glueBefore = before && !before.endsWith('\n') ? '\n\n' : '';
    textarea.value = `${before}${glueBefore}${prompt.content}${after ? `\n\n${after}` : ''}`;
    this._recalled = null;
    this._historyIndex = null;
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length - (after ? after.length + 2 : 0);
    this._autoResize(textarea);
    this._togglePromptPanel(false);
  }

  _saveCurrentPrompt() {
    const textarea = this.el.querySelector('#message-input');
    const nameInput = this.el.querySelector('#prompt-name-input');
    const content = textarea?.value?.trim() || '';
    if (!content) return;
    const name = nameInput?.value?.trim() || content.split('\n')[0].slice(0, 40);
    const saved = store.savePrompt({ name, content });
    if (!saved) return;
    if (nameInput) nameInput.value = '';
    this._renderPromptList();
    this._togglePromptPanel(false);
  }

  _cancelMediaRead() {
    this._attachmentReadToken++;
    this._readingAttachment = false;
  }

  _beginMediaRead() {
    this._clearImage();
    this._clearVideo();
    this._clearAudio();
    this._clearDocument();
    const token = ++this._attachmentReadToken;
    this._readingAttachment = true;
    this._refreshDraftState();
    return token;
  }

  async _handleImageFile(file) {
    if (!file.type.startsWith('image/')) return;
    const token = this._beginMediaRead();
    try {
      const dataUrl = await this._fileToDataUrl(file);
      if (token !== this._attachmentReadToken) return;
      this._pendingImage = { dataUrl, file };
      this._showImagePreview(dataUrl);
      if (this._drawMode) this.el.querySelector('#message-input').placeholder = 'Describe how to modify the image…';
    } finally {
      if (token === this._attachmentReadToken) {
        this._readingAttachment = false;
        this._refreshDraftState();
      }
    }
  }

  async _handleDocumentFile(file) {
    if (!isDocumentFile(file)) return;
    if (file.size > DOCUMENT_FILE_SIZE_LIMIT_MB * 1024 * 1024) {
      this._showDocumentError(file, `Document is larger than ${DOCUMENT_FILE_SIZE_LIMIT_MB} MB`);
      return;
    }

    this._cancelMediaRead();
    if (this._pendingImage) this._clearImage();
    if (this._pendingVideo) this._clearVideo();
    if (this._pendingAudio || this._recorder) this._clearAudio();

    const token = Symbol('document');
    this._documentToken = token;
    this._pendingDocument = { file, status: 'extracting', error: '', extracted: null };
    this._showDocumentStatus('Extracting text…');

    try {
      const extracted = await extractDocumentText(file, {
        maxChars: store.getSettings().documentMaxChars,
      });
      if (this._documentToken !== token) return;
      this._pendingDocument = { file, status: 'ready', error: '', extracted };
      const tokenCount = estimateTextTokens(extracted.text);
      const tokens = formatCompactTokenCount(tokenCount);
      const contextConfig = resolveContextConfig(store.getSettings(), this._currentModel);
      const contextPercent = (tokenCount / contextConfig.maxTokens) * 100;
      const warningPercent = (contextConfig.warnTokens / contextConfig.maxTokens) * 100;
      const level = contextPercent > 100
        ? 'danger'
        : contextPercent >= warningPercent
          ? 'warning'
          : 'success';
      this._showDocumentStatus(
        `${extracted.text.toLocaleString()} chars · ≈${tokens} tokens · ${contextPercent.toFixed(0)}% ctx${extracted.truncated ? ' · truncated' : ''}${extracted.pages ? ` · ${extracted.pages} pages` : ''}`,
        level,
      );
    } catch (err) {
      if (this._documentToken !== token) return;
      this._showDocumentError(file, err.message);
    }
  }

  _showDocumentStatus(status, level = 'muted') {
    const area = this.el?.querySelector('#document-preview-area');
    const name = this.el?.querySelector('#document-file-name');
    const statusEl = this.el?.querySelector('#document-status');
    area?.classList.remove('hidden');
    if (name && this._pendingDocument?.file) name.textContent = this._pendingDocument.file.name;
    if (statusEl) {
      statusEl.textContent = status;
      const color = {
        muted: 'text-[var(--c-tx3)]',
        success: 'text-emerald-500',
        warning: 'text-amber-500',
        danger: 'text-rose-500',
      }[level] || 'text-[var(--c-tx3)]';
      statusEl.className = `text-[11px] ${color}`;
    }
    this._refreshDraftState();
  }

  _showDocumentError(file, message) {
    this._pendingDocument = { file, status: 'error', error: message, extracted: null };
    const area = this.el?.querySelector('#document-preview-area');
    const name = this.el?.querySelector('#document-file-name');
    const statusEl = this.el?.querySelector('#document-status');
    area?.classList.remove('hidden');
    if (name) name.textContent = file?.name || 'Document';
    if (statusEl) {
      statusEl.textContent = `Extraction failed: ${message}`;
      statusEl.className = 'text-[11px] text-rose-500';
    }
    this._refreshDraftState();
  }

  _clearDocument() {
    this._cancelMediaRead();
    this._pendingDocument = null;
    this._documentToken = null;
    this.el?.querySelector('#document-preview-area')?.classList.add('hidden');
    this._refreshDraftState();
  }

  async _handleVideoFile(file) {
    if (!file.type.startsWith('video/')) return;
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > VIDEO_SIZE_LIMIT_MB) {
      alert(`Video file is too large (${sizeMB.toFixed(1)} MB). Please keep it under ${VIDEO_SIZE_LIMIT_MB} MB.`);
      return;
    }
    const token = this._beginMediaRead();
    try {
      const dataUrl = await this._fileToDataUrl(file);
      if (token !== this._attachmentReadToken) return;
      const settings = store.getSettings();
      const frameCount = settings.videoFrames || DEFAULT_VIDEO_FRAME_COUNT;
      const maxSide = settings.videoFrameMaxSide || DEFAULT_VIDEO_FRAME_MAX_SIDE;
      let frames = [];
      try {
        frames = await this._extractVideoFrames(dataUrl, frameCount, maxSide);
      } catch (err) {
        console.warn('[video] frame extraction failed, falling back to video_url:', err);
      }
      if (token !== this._attachmentReadToken) return;
      this._pendingVideo = { dataUrl, file, frames };
      this._showVideoPreview(dataUrl);
      if (frames.length) this._showVideoFrameHint(frames.length, maxSide);
    } finally {
      if (token === this._attachmentReadToken) {
        this._readingAttachment = false;
        this._refreshDraftState();
      }
    }
  }

  /**
   * Sample `count` evenly spaced still frames from a video data URL.
   * Frames are returned as JPEG data URLs (<= maxSide on the long side),
   * which are then sent as individual image_url parts.
   */
  async _extractVideoFrames(dataUrl, count = DEFAULT_VIDEO_FRAME_COUNT, maxSide = DEFAULT_VIDEO_FRAME_MAX_SIDE) {
    const video = document.createElement('video');
    video.src = dataUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('failed to load video'));
      setTimeout(() => reject(new Error('video metadata timeout')), 10000);
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration || !video.videoWidth) throw new Error('video has no duration/dimensions');

    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.max(2, Math.round(video.videoWidth * scale));
    const h = Math.max(2, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    const frames = [];
    for (let i = 0; i < count; i++) {
      const t = Math.min(Math.max(0, duration - 0.05), (duration * (i + 0.5)) / count);
      await new Promise((resolve) => {
        const done = () => {
          video.removeEventListener('seeked', done);
          resolve();
        };
        video.addEventListener('seeked', done);
        video.currentTime = t;
        setTimeout(done, 3000);
      });
      ctx.drawImage(video, 0, 0, w, h);
      frames.push(canvas.toDataURL('image/jpeg', 0.85));
    }
    return frames;
  }

  _showVideoFrameHint(n, side = DEFAULT_VIDEO_FRAME_MAX_SIDE) {
    const area = this.el.querySelector('#video-preview-area');
    if (!area) return;
    let hint = area.querySelector('.video-frame-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'video-frame-hint';
      area.appendChild(hint);
    }
    const perFrame = Math.max(50, Math.round(200 * (side / 448) ** 2));
    const total = n * perFrame;
    const ctx = store.getSettings().contextLimitTokens || DEFAULT_CONTEXT_LIMIT_TOKENS;
    const pct = (total / ctx) * 100;
    hint.classList.remove('text-[var(--c-tx3)]', 'text-rose-500', 'text-amber-500');
    hint.classList.add('text-[11px]', 'px-1', 'pb-1');
    if (pct > 80) {
      hint.classList.add('text-rose-500');
      hint.textContent = `⚠ 将按 ${n} 帧发送，预计 ≈${total.toLocaleString()} token（${pct.toFixed(0)}% 上下文），可能超限`;
    } else {
      if (pct > 50) hint.classList.add('text-amber-500');
      else hint.classList.add('text-[var(--c-tx3)]');
      hint.textContent = `将按 ${n} 帧图片发送（单帧最长边 ${side}px，≈${total.toLocaleString()} token）`;
    }
  }

  _handleMediaFile(file) {
    if (file.type.startsWith('image/')) {
      this._handleImageFile(file);
    } else if (file.type.startsWith('video/') && !this._drawMode) {
      this._handleVideoFile(file);
    }
  }

  _handleAudioFile(file) {
    if (!String(file?.type || '').startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i.test(file?.name || '')) return;
    this._cancelMediaRead();
    this._clearImage();
    this._clearVideo();
    this._clearDocument();
    this._clearAudio();
    this._pendingAudio = { file };
    this._showAudioPreview();
    this._refreshDraftState();
  }

  async _toggleMicrophone() {
    if (this._recorder?.recording) {
      const duration = this._recorder.duration;
      const recorder = this._recorder;
      const file = await recorder.stop();
      if (this._recorder !== recorder) return;
      this._lastRecordingDuration = duration;
      this._recorder = null;
      if (file) {
        this._pendingAudio = { file, source: 'microphone' };
        this._showAudioPreview();
      } else {
        this._clearAudio();
      }
      this._updateRecordButton();
      return;
    }

    this._cancelMediaRead();
    this._clearImage();
    this._clearVideo();
    this._clearDocument();
    if (this._pendingAudio) this._clearAudio();
    this._lastRecordingDuration = 0;
    const recorder = new MicrophoneRecorder({
      onDuration: (duration) => {
        if (this._recorder === recorder) this._showAudioPreview(duration);
      },
    });

    try {
      this._recorder = recorder;
      this._refreshDraftState();
      await recorder.start();
      if (this._recorder !== recorder) {
        await recorder.stop({ discard: true });
        return;
      }
      this._showAudioPreview(0);
      this._updateRecordButton();
      this.focus();
    } catch (err) {
      if (this._recorder !== recorder) return;
      this._recorder = null;
      this._showRecordingError(err.message);
      this._updateRecordButton();
    }
  }

  _fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  _showImagePreview(dataUrl) {
    const previewArea = this.el.querySelector('#image-preview-area');
    const thumb = this.el.querySelector('#image-preview-thumb');
    thumb.src = dataUrl;
    previewArea.classList.remove('hidden');
  }

  _clearImage() {
    this._cancelMediaRead();
    this._pendingImage = null;
    const previewArea = this.el.querySelector('#image-preview-area');
    const thumb = this.el.querySelector('#image-preview-thumb');
    thumb.src = '';
    previewArea.classList.add('hidden');
    // In draw mode, revert placeholder back to txt2img hint
    if (this._drawMode) {
      const textarea = this.el.querySelector('#message-input');
      if (textarea) textarea.placeholder = 'Describe what to draw\u2026';
    }
    this._refreshDraftState();
  }

  _showVideoPreview(dataUrl) {
    const previewArea = this.el.querySelector('#video-preview-area');
    const player = this.el.querySelector('#video-preview-player');
    player.src = dataUrl;
    previewArea.classList.remove('hidden');
  }

  _clearVideo() {
    this._cancelMediaRead();
    this._pendingVideo = null;
    const previewArea = this.el.querySelector('#video-preview-area');
    previewArea?.querySelector('.video-frame-hint')?.remove();
    const player = this.el.querySelector('#video-preview-player');
    if (player) { player.pause(); player.src = ''; }
    previewArea?.classList.add('hidden');
    this._refreshDraftState();
  }

  _showAudioPreview(duration = null) {
    const previewArea = this.el.querySelector('#audio-preview-area');
    const nameEl = this.el.querySelector('#audio-file-name');
    const labelEl = this.el.querySelector('#audio-mode-label');
    if (!previewArea || (!this._pendingAudio && !this._recorder?.recording)) return;
    if (this._recorder?.recording) {
      nameEl.textContent = 'Microphone';
      if (labelEl) {
        labelEl.textContent = `Recording · ${formatRecordingDuration(duration || this._recorder.duration)} · click the microphone button to stop`;
        labelEl.className = 'text-[11px] text-rose-500';
      }
    } else {
      nameEl.textContent = this._pendingAudio.file?.name || 'audio';
      if (labelEl) {
        const prefix = this._pendingAudio.source === 'microphone'
          ? `Recorded ${formatRecordingDuration(this._lastRecordingDuration)}`
          : 'Audio will be transcribed before text processing';
        labelEl.textContent = prefix;
        labelEl.className = 'text-[11px] text-[var(--c-tx3)]';
      }
    }
    previewArea.classList.remove('hidden');
  }

  _showRecordingError(message) {
    const previewArea = this.el.querySelector('#audio-preview-area');
    const nameEl = this.el.querySelector('#audio-file-name');
    const labelEl = this.el.querySelector('#audio-mode-label');
    previewArea?.classList.remove('hidden');
    if (nameEl) nameEl.textContent = 'Microphone';
    if (labelEl) {
      labelEl.textContent = `Recording failed: ${message}`;
      labelEl.className = 'text-[11px] text-rose-500';
    }
  }

  _updateRecordButton() {
    this._updateAttachmentButtons();
  }

  async _clearAudio({ cancelRecording = true } = {}) {
    this._cancelMediaRead();
    const recorder = cancelRecording ? this._recorder : null;
    if (recorder) this._recorder = null;
    this._pendingAudio = null;
    this._lastRecordingDuration = 0;
    const previewArea = this.el.querySelector('#audio-preview-area');
    const nameEl = this.el.querySelector('#audio-file-name');
    if (nameEl) nameEl.textContent = '';
    const labelEl = this.el.querySelector('#audio-mode-label');
    if (labelEl) {
      labelEl.textContent = 'Audio will be transcribed before text processing';
      labelEl.className = 'text-[11px] text-[var(--c-tx3)]';
    }
    previewArea?.classList.add('hidden');
    this._refreshDraftState();
    if (recorder) {
      await recorder.stop({ discard: true });
      this._updateRecordButton();
    }
  }

  async _handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const imageSupported = supportsImage(this._currentModel, store.getModelCapabilities());
        if (this._ttsMode || (!imageSupported && !this._drawMode)) return;
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await this._handleImageFile(file);
        break;
      }
      if (item.type.startsWith('video/')) {
        const videoSupported = supportsVideo(this._currentModel, store.getModelCapabilities());
        if (!videoSupported || this._drawMode || this._ttsMode) return;
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await this._handleVideoFile(file);
        break;
      }
      if (item.type.startsWith('audio/')) {
        const audioSupported = supportsAudio(this._currentModel, store.getModelCapabilities());
        if (!audioSupported || this._drawMode || this._ttsMode) return;
        e.preventDefault();
        const file = item.getAsFile();
        if (file) this._handleAudioFile(file);
        break;
      }
    }
  }

  _submit() {
    if (this._sending) return;
    this._refreshDraftState();
    if (this._readingAttachment || this._recorder || this._attachmentProblem()) return;
    const textarea = this.el.querySelector('#message-input');
    const text = textarea.value.trim();
    if (!text && !this._pendingImage && !this._pendingVideo && !this._pendingAudio && !this._pendingDocument) return;
    if (this._pendingDocument && this._pendingDocument.status !== 'ready') {
      if (this._pendingDocument.status === 'error') {
        this._showDocumentError(
          this._pendingDocument.file,
          `fix or remove before sending: ${this._pendingDocument.error}`,
        );
      } else {
        this._showDocumentStatus('Waiting for document text extraction…', 'muted');
      }
      return;
    }

    const image = this._pendingImage;
    const video = this._pendingVideo;
    const audio = this._pendingAudio;
    const documentAttachment = this._pendingDocument;
    const draw = this._drawMode;
    const tts = this._ttsMode;
    // Capture seed before clearing draw mode (which resets the seed input)
    const seedEl = this.el.querySelector('#seed-input');
    const seedRaw = seedEl?.value?.trim() ?? '';
    const seed = (seedRaw !== '' && !isNaN(Number(seedRaw))) ? Math.floor(Number(seedRaw)) : null;

    this._clearImage();
    this._clearVideo();
    this._clearAudio();
    this._clearDocument();
    // Keep draw mode active on imageGen-capable models so every new generation is just one submit away.
    const caps = getCapabilities(this._currentModel, store.getModelCapabilities());
    if (this._drawMode && !caps.imageGen) this._setDrawMode(false);
    textarea.value = '';
    this._recalled = null;
    this._historyIndex = null;
    this._autoResize(textarea);

    document.dispatchEvent(new CustomEvent('inputbar:send', {
      detail: { text, image, video, audio, document: documentAttachment, draw, tts, seed },
    }));
  }

  _toggleDrawMode() {
    this._setDrawMode(!this._drawMode);
  }

  _toggleTTSMode() {
    this._setTTSMode(!this._ttsMode);
  }

  _setDrawMode(active) {
    const wasTTS = this._ttsMode;
    this._drawMode = active;
    if (active) {
      this._ttsMode = false;
      if (this._recorder) this._clearAudio();
    }

    this._applyModeStyles({
      draw: active,
      tts: active ? false : wasTTS,
      drawPlaceholder: this._pendingImage ? 'Describe how to modify the image\u2026' : 'Describe what to draw\u2026',
      ttsPlaceholder: 'Enter text to speak\u2026',
      defaultPlaceholder: 'Type a message\u2026',
      prefillSeed: true,
    });
  }

  _setTTSMode(active) {
    const wasDraw = this._drawMode;
    this._ttsMode = active;
    if (active) {
      this._drawMode = false;
      // Speak remains text-only; completed attachment drafts stay available.
      if (this._recorder) this._clearAudio();
    }

    this._applyModeStyles({
      draw: active ? false : wasDraw,
      tts: active,
      drawPlaceholder: 'Describe what to draw\u2026',
      ttsPlaceholder: 'Enter text to speak\u2026',
      defaultPlaceholder: 'Type a message\u2026',
      prefillSeed: false,
    });
  }

  _applyModeStyles({
    draw = false,
    tts = false,
    drawPlaceholder = 'Describe what to draw\u2026',
    ttsPlaceholder = 'Enter text to speak\u2026',
    defaultPlaceholder = 'Type a message\u2026',
    prefillSeed = false,
  } = {}) {
    const box = this.el?.querySelector('#input-box');
    box?.classList.remove(
      'border-[var(--c-bd)]',
      'border-violet-400',
      'dark:border-violet-500',
      'border-emerald-400',
      'dark:border-emerald-500',
    );
    if (draw) box?.classList.add('border-violet-400', 'dark:border-violet-500');
    else if (tts) box?.classList.add('border-emerald-400', 'dark:border-emerald-500');
    else box?.classList.add('border-[var(--c-bd)]');

    const textarea = this.el?.querySelector('#message-input');
    if (textarea) {
      textarea.placeholder = draw
        ? drawPlaceholder
        : tts
          ? ttsPlaceholder
          : defaultPlaceholder;
      textarea.focus();
    }

    const drawBtn = this.el?.querySelector('#draw-mode-btn');
    if (drawBtn && !drawBtn.disabled) {
      drawBtn.className = draw
        ? 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-violet-500 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/30'
        : 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-hi)]';
    }

    const ttsBtn = this.el?.querySelector('#tts-mode-btn');
    if (ttsBtn && !ttsBtn.disabled) {
      ttsBtn.className = tts
        ? 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-emerald-500 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30'
        : 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-hi)]';
    }

    const seedWrapper = this.el?.querySelector('#seed-wrapper');
    const seedInput = this.el?.querySelector('#seed-input');
    if (seedWrapper) {
      if (draw || tts) {
        seedWrapper.classList.remove('hidden');
        seedWrapper.classList.add('flex');
        if (prefillSeed && draw && seedInput && !seedInput.value) {
          seedInput.value = String(Math.floor(Math.random() * 1_000_000_000));
        }
      } else {
        seedWrapper.classList.add('hidden');
        seedWrapper.classList.remove('flex');
        if (seedInput) seedInput.value = '';
      }
    }

    this._updateAttachmentButtons();
  }

  setSending(sending) {
    this._sending = sending;
    const sendBtn = this.el.querySelector('#send-btn');
    const textarea = this.el.querySelector('#message-input');
    if (sendBtn) {
      // Button stays enabled in both states — when sending it becomes a stop button.
      sendBtn.disabled = false;
      sendBtn.className = sending
        ? 'flex items-center justify-center w-8 h-8 rounded-xl transition-all text-rose-500 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/30'
        : 'flex items-center justify-center w-8 h-8 rounded-xl transition-all hover:bg-[var(--c-hi)]';
      sendBtn.title = sending ? 'Stop generation' : 'Send (Enter) · Shift+Enter for new line';
      sendBtn.innerHTML = icon(sending ? 'stop' : 'send');
    }
    if (textarea) textarea.disabled = sending;
    this._refreshDraftState();
  }

  setContextInfo(currentTokens, maxTokens, warnTokens = maxTokens) {
    const el = this.el.querySelector('#context-info');
    if (!el) return;
    el.textContent = `ctx ${formatCompactTokenCount(currentTokens)}/${formatCompactTokenCount(maxTokens)}`;
    el.title = `Estimated context ${Math.round(currentTokens)} / ${Math.round(maxTokens)} tokens`;
    const warning = currentTokens >= warnTokens;
    el.className = warning
      ? 'ml-auto text-right text-[11px] font-mono tabular-nums text-amber-400 transition-colors select-none'
      : 'ml-auto text-right text-[11px] font-mono tabular-nums text-[var(--c-tx3)] transition-colors select-none';
  }

  setKvCount(current, max) {
    this.setContextInfo(current, max, Math.floor(max * 0.8));
  }

  setModel(modelId) {
    this._currentModel = modelId;
    const caps = getCapabilities(modelId, store.getModelCapabilities());
    // Auto-enable the primary generation mode for image/TTS-capable models.
    if (caps.tts) {
      if (!this._ttsMode) this._setTTSMode(true);
      else this._updateAttachmentButtons();
    } else if (caps.imageGen && !this._drawMode) {
      this._setDrawMode(true); // calls _updateAttachmentButtons internally
    } else {
      this._updateAttachmentButtons();
    }
  }

  _updateAttachmentButtons() {
    const mediaBtn = this.el.querySelector('#media-upload-btn');
    const audioBtn = this.el.querySelector('#audio-upload-btn');
    const drawBtn = this.el.querySelector('#draw-mode-btn');
    const ttsBtn = this.el.querySelector('#tts-mode-btn');
    const documentBtn = this.el.querySelector('#document-upload-btn');
    const recordBtn = this.el.querySelector('#record-audio-btn');
    const fileInput = this.el.querySelector('#media-file-input');
    if (!mediaBtn || !audioBtn) return;
    const imageSupported = supportsImage(this._currentModel, store.getModelCapabilities());
    const videoSupported = supportsVideo(this._currentModel, store.getModelCapabilities());
    const audioSupported = supportsAudio(this._currentModel, store.getModelCapabilities());
    const imageGenSupported = supportsImageGen(this._currentModel, store.getModelCapabilities());
    const ttsSupported = supportsTTS(this._currentModel, store.getModelCapabilities());
    const mediaSupported = imageSupported || videoSupported;

    // In draw mode, always allow image attachment (for img2img), even if model lacks vision.
    const canAttachMedia = !this._ttsMode && (this._drawMode ? imageGenSupported : mediaSupported);
    if (canAttachMedia) {
      mediaBtn.disabled = false;
      mediaBtn.className = 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-hi)]';
      if (this._drawMode) {
        mediaBtn.title = 'Attach reference image for img2img (or paste)';
        if (fileInput) fileInput.accept = 'image/*';
      } else {
        const labels = [imageSupported && 'image', videoSupported && 'video'].filter(Boolean).join(' / ');
        mediaBtn.title = `Attach ${labels} (or paste)`;
        if (fileInput) {
          fileInput.accept = [imageSupported && 'image/*', videoSupported && 'video/*'].filter(Boolean).join(',');
        }
      }
    } else {
      mediaBtn.disabled = true;
      mediaBtn.className = 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-[var(--c-tx3)] opacity-40 cursor-not-allowed';
      mediaBtn.title = 'Vision not enabled for this model';
    }

    if (audioSupported && !this._drawMode && !this._ttsMode) {
      audioBtn.disabled = false;
      audioBtn.className = 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-hi)]';
      audioBtn.title = 'Attach audio for transcription or translation';
    } else {
      audioBtn.disabled = true;
      audioBtn.className = 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-[var(--c-tx3)] opacity-40 cursor-not-allowed';
      audioBtn.title = this._drawMode || this._ttsMode ? 'Audio input is unavailable in Draw / Speak mode' : 'Audio not enabled for this model';
      if (this._recorder) this._clearAudio();
    }

    if (drawBtn) {
      if (imageGenSupported) {
        drawBtn.disabled = false;
        drawBtn.className = this._drawMode
          ? 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-violet-500 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/30'
          : 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-hi)]';
        drawBtn.title = 'Generate image (Draw mode)';
      } else {
        drawBtn.disabled = true;
        drawBtn.className = 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-[var(--c-tx3)] opacity-40 cursor-not-allowed';
        drawBtn.title = 'Image generation not enabled for this model';
        if (this._drawMode) this._setDrawMode(false);
      }
    }

    if (ttsBtn) {
      if (ttsSupported) {
        ttsBtn.disabled = false;
        ttsBtn.className = this._ttsMode
          ? 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-emerald-500 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30'
          : 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-hi)]';
        ttsBtn.title = 'Generate speech (Speak mode)';
      } else {
        ttsBtn.disabled = true;
        ttsBtn.className = 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-[var(--c-tx3)] opacity-40 cursor-not-allowed';
        ttsBtn.title = 'Speech generation not enabled for this model';
        if (this._ttsMode) this._setTTSMode(false);
      }
    }

    if (documentBtn) {
      if (this._drawMode || this._ttsMode) {
        documentBtn.disabled = true;
        documentBtn.className = 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-[var(--c-tx3)] opacity-40 cursor-not-allowed';
        documentBtn.title = 'Document input is unavailable in Draw / Speak mode';
      } else {
        documentBtn.disabled = false;
        documentBtn.className = 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-hi)]';
        documentBtn.title = 'Attach TXT / Markdown / CSV / JSON / PDF / DOCX / XLSX';
      }
    }

    if (recordBtn) {
      const audioSupported = supportsAudio(this._currentModel, store.getModelCapabilities());
      const disabled = !audioSupported || this._drawMode || this._ttsMode;
      recordBtn.disabled = disabled;
      recordBtn.setAttribute('aria-pressed', String(Boolean(this._recorder?.recording)));
      if (this._recorder?.recording) {
        recordBtn.className = 'relative flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-500 transition-all dark:bg-rose-900/30 dark:text-rose-400 animate-pulse';
        recordBtn.title = 'Stop recording';
      } else if (disabled) {
        recordBtn.className = 'flex h-8 w-8 items-center justify-center rounded-lg text-[var(--c-tx3)] opacity-40 transition-all cursor-not-allowed';
        recordBtn.title = this._drawMode || this._ttsMode
          ? 'Microphone input is unavailable in Draw / Speak mode'
          : 'Audio not enabled for this model';
      } else {
        recordBtn.className = 'flex h-8 w-8 items-center justify-center rounded-lg text-[var(--c-tx3)] transition-all hover:bg-[var(--c-hi)] hover:text-[var(--c-tx2)]';
        recordBtn.title = 'Record microphone for ASR';
      }
      recordBtn.innerHTML = icon(this._recorder?.recording ? 'stop' : 'mic');
    }
    this._refreshDraftState();
  }

  _attachmentProblem() {
    const caps = store.getModelCapabilities();
    const incompatible = [];
    if (this._pendingImage && (this._ttsMode || !(this._drawMode
      ? supportsImageGen(this._currentModel, caps) : supportsImage(this._currentModel, caps)))) incompatible.push('Image');
    if (this._pendingVideo && (this._drawMode || this._ttsMode || !supportsVideo(this._currentModel, caps))) incompatible.push('Video');
    if (this._pendingAudio && (this._drawMode || this._ttsMode || !supportsAudio(this._currentModel, caps))) incompatible.push('Audio');
    if (this._pendingDocument && (this._drawMode || this._ttsMode)) incompatible.push('Document');
    return incompatible.length
      ? `${incompatible.join(' / ')} attachment kept. Switch to a compatible model or mode, or remove it to send.` : '';
  }

  _refreshDraftState() {
    if (!this.el) return;
    const problem = this._attachmentProblem();
    const status = this.el.querySelector('#attachment-status');
    if (status) {
      status.textContent = problem;
      status.classList.toggle('hidden', !problem);
    }
    const button = this.el.querySelector('#send-btn');
    if (!button) return;
    const documentBlocked = this._pendingDocument && this._pendingDocument.status !== 'ready';
    const waiting = this._readingAttachment ? 'Reading attachment…' : this._recorder ? 'Stop recording before sending'
      : documentBlocked ? 'Wait for document extraction or remove the document to send' : '';
    const blocked = !this._sending && (!!problem || !!waiting);
    button.disabled = blocked;
    button.setAttribute('aria-disabled', String(blocked));
    button.setAttribute('aria-label', this._sending ? 'Stop generation' : blocked ? 'Send unavailable' : 'Send message');
    button.title = this._sending ? 'Stop generation' : problem || waiting || 'Send (Enter) · Shift+Enter for new line';
    button.classList.toggle('opacity-40', blocked);
    button.classList.toggle('cursor-not-allowed', blocked);
  }

  // Recall user-authored text only; attachments stay untouched.
  setInputHistory(scope, messages = []) {
    const textarea = this.el?.querySelector('#message-input');
    const history = messages.filter(message => message.role === 'user').map(message => {
      if (['audio', 'document'].includes(message.meta?.type)) return message.meta.instruction || '';
      return typeof message.content === 'string' ? message.content
        : Array.isArray(message.content) ? message.content.filter(part => part.type === 'text').map(part => part.text || '').join('\n') : '';
    }).filter(text => text.trim());
    const changedScope = scope !== this._historyScope;
    if (changedScope || history.length === 0) {
      if (this._recalled !== null && textarea?.value === this._recalled) {
        textarea.value = '';
        this._autoResize(textarea);
      }
      this._recalled = null;
      this._historyIndex = null;
    } else if (this._historyIndex !== null && !this._inputHistory.every((text, index) => history[index] === text)) {
      // Keep the currently displayed entry selected when new messages arrive.
      const index = history.lastIndexOf(this._recalled);
      this._historyIndex = index < 0 ? null : index;
      if (index < 0) this._recalled = null;
    }
    this._historyScope = scope;
    this._inputHistory = history;
  }

  focus() {
    this.el?.querySelector('#message-input')?.focus();
  }
}
