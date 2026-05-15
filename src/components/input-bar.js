import { store } from '../store.js';
import { formatCompactTokenCount } from '../api.js';
import { supportsAudio, supportsImage, supportsVideo, supportsImageGen } from '../capabilities.js';
import { icon } from '../icons.js';

const VIDEO_SIZE_LIMIT_MB = 50;

export class InputBar {
  constructor() {
    this.el = null;
    this._pendingImage = null; // { dataUrl, file }
    this._pendingVideo = null; // { dataUrl, file }
    this._pendingAudio = null; // { file }
    this._currentModel = '';
    this._sending = false;
    this._drawMode = false;
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
    const mediaSupported = imageSupported || videoSupported;
    const mediaAccept = [imageSupported && 'image/*', videoSupported && 'video/*'].filter(Boolean).join(',') || 'image/*,video/*';
    const mediaTitle = mediaSupported
      ? `Attach ${[imageSupported && 'image', videoSupported && 'video'].filter(Boolean).join(' / ')} (or paste)`
      : 'Vision not enabled for this model';
    const drawTitle = imageGenSupported ? 'Generate image (Draw mode)' : 'Image generation not enabled for this model';
    const placeholder = this._drawMode ? 'Describe what to draw…' : 'Type a message…';
    return `
      <div class="px-4 pb-4 pt-3 max-w-4xl mx-auto w-full">
        <input id="media-file-input" type="file" accept="${mediaAccept}" class="hidden" aria-label="Attach image or video" />
        <input id="audio-file-input" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm" class="hidden" aria-label="Attach audio" />
        <div id="input-box" class="flex flex-col bg-[var(--c-card)] border ${this._drawMode ? 'border-violet-400 dark:border-violet-500' : 'border-[var(--c-bd)]'} rounded-2xl focus-within:border-[var(--c-bd-hi)] transition-all duration-200 shadow-lg shadow-black/10">

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

          <textarea
            id="message-input"
            class="bg-transparent px-4 pt-3 pb-1 text-[13.5px] text-[var(--c-tx)] placeholder-[var(--c-txph)] focus:outline-none leading-relaxed resize-none w-full"
            placeholder="${placeholder}"
            rows="1"
            style="max-height: 144px; overflow-y: auto;"
            aria-label="Message input"
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
              <button id="draw-mode-btn"
                class="flex items-center justify-center w-8 h-8 rounded-lg transition-all ${imageGenSupported ? (this._drawMode ? 'text-violet-500 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/30' : 'text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-hi)]') : 'text-[var(--c-tx3)] opacity-40 cursor-not-allowed'}"
                ${imageGenSupported ? '' : 'disabled'}
                aria-label="Toggle draw mode"
                title="${drawTitle}">
                ${icon('wand')}
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
    const drawBtn = this.el.querySelector('#draw-mode-btn');
    const fileInput = this.el.querySelector('#media-file-input');
    const audioInput = this.el.querySelector('#audio-file-input');
    const removeImageBtn = this.el.querySelector('#remove-image-btn');
    const removeVideoBtn = this.el.querySelector('#remove-video-btn');
    const removeAudioBtn = this.el.querySelector('#remove-audio-btn');

    // Auto-resize textarea
    textarea.addEventListener('input', () => this._autoResize(textarea));

    // Enter sends; Shift+Enter inserts newline (default behaviour)
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._submit();
      }
    });

    sendBtn.addEventListener('click', () => this._submit());

    drawBtn?.addEventListener('click', () => {
      if (!drawBtn.disabled) this._toggleDrawMode();
    });

    // Media (image/video) upload
    mediaBtn?.addEventListener('click', () => {
      if (!mediaBtn.disabled) fileInput.click();
    });
    audioBtn?.addEventListener('click', () => {
      if (!audioBtn.disabled) audioInput.click();
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

    removeImageBtn.addEventListener('click', () => this._clearImage());
    removeVideoBtn?.addEventListener('click', () => this._clearVideo());
    removeAudioBtn?.addEventListener('click', () => this._clearAudio());

    // Paste media support
    textarea.addEventListener('paste', (e) => this._handlePaste(e));

    // Model change
    document.addEventListener('model:changed', (e) => {
      this.setModel(e.detail.model);
    });
    document.addEventListener('caps:changed', () => {
      this._updateAttachmentButtons();
    });
  }

  _autoResize(textarea) {
    textarea.style.height = 'auto';
    const scrollH = textarea.scrollHeight;
    const maxH = 144; // max-height ~6 rows
    textarea.style.height = Math.min(scrollH, maxH) + 'px';
  }

  async _handleImageFile(file) {
    if (!file.type.startsWith('image/')) return;
    if (this._pendingAudio) this._clearAudio();
    if (this._pendingVideo) this._clearVideo();
    const dataUrl = await this._fileToDataUrl(file);
    this._pendingImage = { dataUrl, file };
    this._showImagePreview(dataUrl);
    // In draw mode, update placeholder to hint at img2img
    if (this._drawMode) {
      const textarea = this.el.querySelector('#message-input');
      if (textarea) textarea.placeholder = 'Describe how to modify the image\u2026';
    }
  }

  async _handleVideoFile(file) {
    if (!file.type.startsWith('video/')) return;
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > VIDEO_SIZE_LIMIT_MB) {
      alert(`Video file is too large (${sizeMB.toFixed(1)} MB). Please keep it under ${VIDEO_SIZE_LIMIT_MB} MB.`);
      return;
    }
    if (this._pendingAudio) this._clearAudio();
    if (this._pendingImage) this._clearImage();
    const dataUrl = await this._fileToDataUrl(file);
    this._pendingVideo = { dataUrl, file };
    this._showVideoPreview(dataUrl);
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
    if (this._pendingImage) this._clearImage();
    this._pendingAudio = { file };
    this._showAudioPreview();
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
  }

  _showVideoPreview(dataUrl) {
    const previewArea = this.el.querySelector('#video-preview-area');
    const player = this.el.querySelector('#video-preview-player');
    player.src = dataUrl;
    previewArea.classList.remove('hidden');
  }

  _clearVideo() {
    this._pendingVideo = null;
    const previewArea = this.el.querySelector('#video-preview-area');
    const player = this.el.querySelector('#video-preview-player');
    if (player) { player.pause(); player.src = ''; }
    previewArea?.classList.add('hidden');
  }

  _showAudioPreview() {
    const previewArea = this.el.querySelector('#audio-preview-area');
    const nameEl = this.el.querySelector('#audio-file-name');
    if (!previewArea || !this._pendingAudio) return;
    nameEl.textContent = this._pendingAudio.file?.name || 'audio';
    previewArea.classList.remove('hidden');
  }

  _clearAudio() {
    this._pendingAudio = null;
    const previewArea = this.el.querySelector('#audio-preview-area');
    const nameEl = this.el.querySelector('#audio-file-name');
    if (nameEl) nameEl.textContent = '';
    previewArea?.classList.add('hidden');
  }

  async _handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const imageSupported = supportsImage(this._currentModel, store.getModelCapabilities());
        if (!imageSupported && !this._drawMode) return;
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await this._handleImageFile(file);
        break;
      }
      if (item.type.startsWith('video/')) {
        const videoSupported = supportsVideo(this._currentModel, store.getModelCapabilities());
        if (!videoSupported || this._drawMode) return;
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await this._handleVideoFile(file);
        break;
      }
      if (item.type.startsWith('audio/')) {
        const audioSupported = supportsAudio(this._currentModel, store.getModelCapabilities());
        if (!audioSupported) return;
        e.preventDefault();
        const file = item.getAsFile();
        if (file) this._handleAudioFile(file);
        break;
      }
    }
  }

  _submit() {
    if (this._sending) return;
    const textarea = this.el.querySelector('#message-input');
    const text = textarea.value.trim();
    if (!text && !this._pendingImage && !this._pendingVideo && !this._pendingAudio) return;

    const image = this._pendingImage;
    const video = this._pendingVideo;
    const audio = this._pendingAudio;
    const draw = this._drawMode;
    this._clearImage();
    this._clearVideo();
    this._clearAudio();
    if (this._drawMode) this._setDrawMode(false);
    textarea.value = '';
    this._autoResize(textarea);

    document.dispatchEvent(new CustomEvent('inputbar:send', {
      detail: { text, image, video, audio, draw },
    }));
  }

  _toggleDrawMode() {
    this._setDrawMode(!this._drawMode);
  }

  _setDrawMode(active) {
    this._drawMode = active;
    if (active) {
      // Keep pending image — it can be used as img2img source.
      // Only clear video and audio (not useful for draw mode).
      if (this._pendingVideo) this._clearVideo();
      if (this._pendingAudio) this._clearAudio();
    }
    // Update DOM in-place to avoid replacing this.el (which would detach event listeners
    // and break textarea.value = '' in _submit, or cause duplicate document listeners).
    const box = this.el.querySelector('#input-box');
    if (box) {
      if (active) {
        box.classList.remove('border-[var(--c-bd)]');
        box.classList.add('border-violet-400', 'dark:border-violet-500');
      } else {
        box.classList.remove('border-violet-400', 'dark:border-violet-500');
        box.classList.add('border-[var(--c-bd)]');
      }
    }
    const textarea = this.el.querySelector('#message-input');
    if (textarea) {
      textarea.placeholder = active
        ? (this._pendingImage ? 'Describe how to modify the image\u2026' : 'Describe what to draw\u2026')
        : 'Type a message\u2026';
      textarea.focus();
    }
    const drawBtn = this.el.querySelector('#draw-mode-btn');
    if (drawBtn && !drawBtn.disabled) {
      drawBtn.className = active
        ? 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-violet-500 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/30'
        : 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-hi)]';
    }
    // Refresh media button (accept & enabled state changes with draw mode)
    this._updateAttachmentButtons();
  }

  setSending(sending) {
    this._sending = sending;
    const sendBtn = this.el.querySelector('#send-btn');
    const textarea = this.el.querySelector('#message-input');
    if (sendBtn) {
      sendBtn.disabled = sending;
      sendBtn.className = sending
        ? 'flex items-center justify-center w-8 h-8 rounded-xl text-[var(--c-tx3)] cursor-not-allowed transition-all'
        : 'flex items-center justify-center w-8 h-8 rounded-xl transition-all hover:bg-[var(--c-hi)]';
      sendBtn.innerHTML = icon(sending ? 'sendMuted' : 'send');
    }
    if (textarea) textarea.disabled = sending;
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
    this._updateAttachmentButtons();
  }

  _updateAttachmentButtons() {
    const mediaBtn = this.el.querySelector('#media-upload-btn');
    const audioBtn = this.el.querySelector('#audio-upload-btn');
    const drawBtn = this.el.querySelector('#draw-mode-btn');
    const fileInput = this.el.querySelector('#media-file-input');
    if (!mediaBtn || !audioBtn) return;
    const imageSupported = supportsImage(this._currentModel, store.getModelCapabilities());
    const videoSupported = supportsVideo(this._currentModel, store.getModelCapabilities());
    const audioSupported = supportsAudio(this._currentModel, store.getModelCapabilities());
    const imageGenSupported = supportsImageGen(this._currentModel, store.getModelCapabilities());
    const mediaSupported = imageSupported || videoSupported;

    // In draw mode, always allow image attachment (for img2img), even if model lacks vision.
    const canAttachMedia = this._drawMode ? true : mediaSupported;
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
      if (this._pendingImage) this._clearImage();
      if (this._pendingVideo) this._clearVideo();
    }

    if (audioSupported) {
      audioBtn.disabled = false;
      audioBtn.className = 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-hi)]';
      audioBtn.title = 'Attach audio for transcription or translation';
    } else {
      audioBtn.disabled = true;
      audioBtn.className = 'flex items-center justify-center w-8 h-8 rounded-lg transition-all text-[var(--c-tx3)] opacity-40 cursor-not-allowed';
      audioBtn.title = 'Audio not enabled for this model';
      if (this._pendingAudio) this._clearAudio();
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
  }

  focus() {
    this.el?.querySelector('#message-input')?.focus();
  }
}
