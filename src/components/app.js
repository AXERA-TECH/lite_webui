import { store } from '../store.js';
import {
  streamCompletion,
  formatMessagesForApi,
  transcribeAudio,
  generateImage,
  generateSpeech,
  isRepeatingOutput,
} from '../api.js';
import { estimateThreadTokens, resolveContextConfig } from '../context.js';
import { formatDocumentForModel } from '../documents.js';
import { Sidebar } from './sidebar.js';
import { Chat } from './chat.js';
import { InputBar } from './input-bar.js';
import { ModelPicker } from './model-picker.js';
import { SettingsModal } from './settings-modal.js';
import { HealthPanel } from './health-panel.js';
import { icon } from '../icons.js';

export class App {
  constructor(rootEl) {
    this.root = rootEl;
    this.sidebar = new Sidebar();
    this.chat = new Chat();
    this.inputBar = new InputBar();
    this.modelPicker = new ModelPicker();
    this.settingsModal = new SettingsModal();
    this.healthPanel = new HealthPanel();
    this._sidebarOpen = false;
    this._abortController = null;
    // The model that owns the API context represented by the ctx badge. Switching
    // models/endpoints starts a fresh server-side context.
    this._activeContextModel = '';
    // In-memory message cache keyed by convId.  Persists for the page session so
    // that media (video/image dataUrls) remains visible even after an auto-reset
    // clears localStorage, or when localStorage quota prevents persistence.
    this._sessionMessages = new Map();
  }

  init() {
    this._render();
    this._initTheme();
    this._syncSidebarLayout();
    this._bindEvents();
    this._loadCurrentConversation();
    this.settingsModal.render(); // pre-render (portal pattern)
    this._updateContextInfo();
    this.inputBar.focus();
  }

  // --- Session message cache helpers ---

  _pushSessionMsg(convId, msg) {
    if (!this._sessionMessages.has(convId)) this._sessionMessages.set(convId, []);
    this._sessionMessages.get(convId).push(msg);
  }

  /**
   * Fetches an HTTP image URL and returns a base64 data URL so the image
   * is self-contained in the browser and doesn't require the backend to
   * remain running. Falls back to the original URL on any error.
   */
  async _fetchImageAsDataUrl(url) {
    if (!url || !url.startsWith('http')) return url;
    try {
      const res = await fetch(url);
      if (!res.ok) return url;
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(url);
        reader.readAsDataURL(blob);
      });
    } catch {
      return url;
    }
  }

  _createObjectUrl(blob) {
    try {
      return URL.createObjectURL(blob);
    } catch {
      return '';
    }
  }

  _clearSessionMsgs(convId) {
    this._sessionMessages.delete(convId);
  }

  // Returns a conv-like object backed by in-memory messages when available,
  // so that media dataUrls survive auto-resets and localStorage quota failures.
  _sessionConvFor(conv) {
    if (!conv) return conv;
    const mem = this._sessionMessages.get(conv.id);
    return mem?.length ? { ...conv, messages: mem } : conv;
  }

  _render() {
    this.root.className = 'flex h-screen overflow-hidden bg-[var(--c-bg)]';

    // Sidebar
    const sidebarEl = this.sidebar.render();
    this.root.appendChild(sidebarEl);

    // Mobile overlay
    this._mobileOverlay = document.createElement('div');
    this._mobileOverlay.className = 'fixed inset-0 bg-black/50 z-20 hidden md:hidden';
    this._mobileOverlay.addEventListener('click', () => this._closeMobileSidebar());
    document.body.appendChild(this._mobileOverlay);

    // Main content
    const main = document.createElement('div');
    main.className = 'flex flex-col flex-1 min-w-0 h-full';
    main.id = 'main-content';

    // Header
    const header = document.createElement('header');
    header.className = 'flex items-center justify-between px-4 py-2.5 border-b border-[var(--c-top-bd)] bg-[var(--c-top)] flex-shrink-0 gap-3';
    header.innerHTML = `
      <div class="flex items-center gap-3">
        <button id="mobile-menu-btn" class="md:hidden p-1.5 rounded text-[var(--c-tx3)] hover:text-[var(--c-tx)] transition-colors" aria-label="Toggle sidebar">
          ${icon('menu')}
        </button>
        <div id="model-picker-mount"></div>
      </div>
      <div class="flex items-center gap-2">
        <div id="health-panel-mount"></div>
        <button id="theme-toggle-btn" class="p-1.5 rounded-lg text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-top-el)] border border-transparent hover:border-[var(--c-top-bd)] transition-all" aria-label="Toggle theme">
          ${icon('sun')}
        </button>
        <button id="settings-btn" class="p-1.5 rounded-lg text-[var(--c-tx3)] hover:text-[var(--c-tx2)] hover:bg-[var(--c-top-el)] border border-transparent hover:border-[var(--c-top-bd)] transition-all" aria-label="Settings">
          ${icon('settings')}
        </button>
      </div>
    `;

    // Mount model picker
    header.querySelector('#model-picker-mount').appendChild(this.modelPicker.render());
    header.querySelector('#health-panel-mount').appendChild(this.healthPanel.render());
    main.appendChild(header);

    // Chat area
    const chatWrapper = document.createElement('div');
    chatWrapper.className = 'flex-1 min-h-0 overflow-hidden';
    chatWrapper.appendChild(this.chat.render());
    main.appendChild(chatWrapper);

    // Input bar
    main.appendChild(this.inputBar.render());

    this.root.appendChild(main);
  }

  _bindEvents() {
    // Settings button
    this.root.querySelector('#settings-btn').addEventListener('click', () => {
      this.settingsModal.toggle();
    });

    // Theme toggle
    this.root.querySelector('#theme-toggle-btn')?.addEventListener('click', () => {
      this._toggleTheme();
    });

    // Mobile menu
    this.root.querySelector('#mobile-menu-btn')?.addEventListener('click', () => {
      this._toggleMobileSidebar();
    });

    window.addEventListener('resize', () => {
      this._syncSidebarLayout();
    });

    // New chat
    document.addEventListener('sidebar:newchat', () => this._newChat());

    // Select conversation
    document.addEventListener('sidebar:select', (e) => {
      this._selectConversation(e.detail.convId);
    });

    // Delete conversation
    document.addEventListener('sidebar:deleted', () => {
      const currentId = store.getCurrentConversationId();
      if (currentId) {
        this._selectConversation(currentId);
      } else {
        this.chat.clear();
        this.sidebar.update();
      }
    });

    // Export / import conversation
    document.addEventListener('sidebar:export', () => this._exportConversation());
    document.addEventListener('sidebar:import', (e) => this._importConversation(e.detail.file));

    // Send message
    document.addEventListener('inputbar:send', (e) => {
      this._handleSend(
        e.detail.text,
        e.detail.image,
        e.detail.video,
        e.detail.audio,
        e.detail.draw,
        e.detail.seed ?? null,
        e.detail.tts || false,
        e.detail.document || null,
      );
    });

    // Stop generation
    document.addEventListener('inputbar:stop', () => {
      this._abortController?.abort();
      this._abortController = null;
    });

    // Regenerate image in-place with same prompt (no new user message, new random seed)
    document.addEventListener('chat:regenerate', async (e) => {
      const { prompt, msgTimestamp } = e.detail;
      if (!prompt || !msgTimestamp) return;
      const model = this.modelPicker.getModel();
      if (!model) {
        this.chat.showError('Error: no model selected');
        return;
      }
      await this._handleRegenerateTask({ originalTimestamp: msgTimestamp, model, prompt });
    });

    // Regenerate the last text response (remove it and re-run the last prompt)
    document.addEventListener('chat:regenerate-text', () => this._regenerateLastText());

    // Edit a historical user message. The active continuation is saved as a branch.
    document.addEventListener('chat:edit-user', async (e) => {
      await this._editUserMessage(e.detail?.msgTimestamp, e.detail?.text);
    });

    document.addEventListener('chat:restore-branch', (e) => {
      this._restoreConversationBranch(e.detail?.branchId);
    });

    // Model change
    document.addEventListener('model:changed', (e) => {
      const nextModel = e.detail?.model ?? this.modelPicker.getModel();
      const previousModel = this._activeContextModel;
      this._activeContextModel = nextModel;
      this.inputBar.setModel(nextModel);

      if (previousModel && nextModel !== previousModel) {
        this._resetConversationContext(
          store.getCurrentConversationId(),
          `model changed from ${previousModel} to ${nextModel || '(none)'}`,
        );
      } else {
        this._updateContextInfo();
      }
    });

    document.addEventListener('settings:changed', () => {
      this._syncSelectedModel();
    });

    document.addEventListener('models:changed', () => {
      this._syncSelectedModel();
    });
  }

  _syncSelectedModel() {
    this.modelPicker.syncToConversation(store.getCurrentConversation());
    this.inputBar.setModel(this.modelPicker.getModel());
    this._updateContextInfo();
  }

  _loadCurrentConversation() {
    const currentId = store.getCurrentConversationId();
    if (currentId) {
      const conv = store.getCurrentConversation();
      if (conv) {
        this.chat.loadConversation(this._sessionConvFor(conv));
        this.modelPicker.syncToConversation(conv);
        const model = this.modelPicker.getModel();
        this.inputBar.setModel(model);
        this._activeContextModel = model;
        this._updateContextInfo();
        return;
      }
    }
    // No current or invalid current — pick first if exists
    const convs = store.getConversations();
    if (convs.length > 0) {
      this._selectConversation(convs[0].id);
      return;
    }
    // Even without a conversation, the input bar must follow the selected model
    // so generation modes (Draw/Speak) are active for the first message.
    const model = this.modelPicker.getModel();
    this.inputBar.setModel(model);
    this._activeContextModel = model;
  }

  _newChat() {
    const model = this.modelPicker.getModel();
    const conv = store.createConversation(model);
    store.setCurrentConversationId(conv.id);
    this.chat.loadConversation(conv);
    this.inputBar.setModel(model);
    this._activeContextModel = model;
    this.sidebar.update();
    this._updateContextInfo();
    this.inputBar.focus();
    this._syncSidebarLayout();
  }

  _exportConversation() {
    const conv = store.getCurrentConversation();
    if (!conv) {
      this.chat.showError('Error: no conversation to export');
      return;
    }
    const payload = JSON.stringify(conv, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(conv.title || 'conversation').replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async _importConversation(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const messages = Array.isArray(data.messages) ? data.messages : data;
      if (!Array.isArray(messages) || messages.length === 0) {
        this.chat.showError('Error: file does not contain a valid conversation');
        return;
      }
      const conv = store.createConversation(data.model || '');
      store.updateConversationTitle(conv.id, data.title || 'Imported Chat');
      for (const msg of messages) {
        if (msg && (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system')) {
          store.addMessage(conv.id, {
            role: msg.role,
            content: msg.content,
            model: msg.model,
            timestamp: msg.timestamp || new Date().toISOString(),
            ...(typeof msg.apiContent === 'string' ? { apiContent: msg.apiContent } : {}),
            ...(msg.meta ? { meta: msg.meta } : {}),
            ...(msg.generatedImages ? { generatedImages: msg.generatedImages } : {}),
            ...(msg.generatedPrompt ? { generatedPrompt: msg.generatedPrompt } : {}),
            ...(msg.generatedSeed !== undefined ? { generatedSeed: msg.generatedSeed } : {}),
            ...(msg.metrics ? { metrics: msg.metrics } : {}),
          });
        }
      }
      store.setCurrentConversationId(conv.id);
      this.chat.loadConversation(store.getCurrentConversation());
      this.sidebar.update();
      this._updateContextInfo();
    } catch (err) {
      this.chat.showError(`Import failed: ${err.message}`);
    }
  }

  _selectConversation(convId) {
    store.setCurrentConversationId(convId);
    const conv = store.getCurrentConversation();
    if (!conv) {
      this.chat.clear();
      this._updateContextInfo();
      return;
    }
    this.chat.loadConversation(this._sessionConvFor(conv));
    this.modelPicker.syncToConversation(conv);
    const model = this.modelPicker.getModel();
    this.inputBar.setModel(model);
    this._activeContextModel = model;
    this.sidebar.update();
    this._updateContextInfo();
    this.inputBar.focus();
    this._closeMobileSidebar();
  }

  async _handleSend(text, image, video, audio, draw, seed = null, tts = false, documentAttachment = null) {
    const settings = store.getSettings();
    const cfg = this._getApiConfig();
    const trimmedText = text.trim();

    // /clean — wipes both the API context and the visual chat display
    if (trimmedText === '/clean' && !image && !video && !audio) {
      const convId = store.getCurrentConversationId();
      if (convId) {
        store.clearMessages(convId);
        this._clearSessionMsgs(convId);
        this.chat.clear();
        this._updateContextInfo();
      }
      return;
    }

    if (trimmedText === '/reset' && !image && !video && !audio) {
      this._resetConversationContext(store.getCurrentConversationId(), 'manual /reset command');
      return;
    }

    // Ensure we have a conversation
    let convId = store.getCurrentConversationId();
    if (!convId) {
      const conv = store.createConversation(this.modelPicker.getModel());
      convId = conv.id;
      store.setCurrentConversationId(convId);
      this.sidebar.update();
    }

    const model = this.modelPicker.getModel();
    if (!model) {
      this.chat.showError('Error: no model selected for the current API Base URL');
      return;
    }

    if (audio) {
      await this._handleAudioTask({
        convId,
        model,
        instruction: trimmedText,
        audio,
      });
      return;
    }

    if (documentAttachment) {
      await this._handleDocumentTask({
        convId,
        model,
        instruction: trimmedText,
        document: documentAttachment,
      });
      return;
    }

    if (tts && trimmedText) {
      await this._handleTTSTask({
        convId,
        model,
        text: trimmedText,
        seed,
      });
      return;
    }

    if (draw && trimmedText) {
      await this._handleDrawTask({ convId, model, prompt: trimmedText, image, seed });
      return;
    }

    const contextConfig = resolveContextConfig(settings, model);
    const userMessage = this._buildUserMessage(text, image, video);
    const preConv = store.getCurrentConversation();
    const projectedTokens = estimateThreadTokens(preConv?.messages, userMessage);

    if (preConv?.messages?.length && projectedTokens >= contextConfig.resetTokens) {
      this._resetConversationContext(
        convId,
        `estimated ${projectedTokens.toLocaleString()} tokens reached the ${contextConfig.resetPercent}% auto-reset threshold`
      );
    }

    // Add to store & render — wrapped so any localStorage/DOM error is caught
    let renderOk = false;
    try {
      this.chat.clearError();
      store.addMessage(convId, userMessage);
      this._pushSessionMsg(convId, userMessage);
      this.chat.appendUserMessage(userMessage);
      this._updateContextInfo();
      renderOk = true;
    } catch (err) {
      this.chat.showError(`Error: ${err.message}`);
      this.inputBar.setSending(false);
      this.inputBar.focus();
      return;
    }

    // Update title if first message
    const conv = store.getCurrentConversation();
    if (conv && conv.messages.length === 1) {
      const title = text.slice(0, 40) || (video ? 'Video message' : 'Image message');
      store.updateConversationTitle(convId, title);
      this.sidebar.update();
    }

    // Disable input
    this.inputBar.setSending(true);
    this.chat.showTypingIndicator();

    // Get conversation history for API.
    // Use preConv (read before the store write) + userMessage directly so the
    // current message is always included even if the localStorage save failed,
    // and formatMessagesForApi can correctly identify it as the latest message.
    let apiMessages = formatMessagesForApi([...(preConv?.messages || []), userMessage]);
    if (settings.systemPrompt && settings.systemPrompt.trim()) {
      apiMessages = [{ role: 'system', content: settings.systemPrompt.trim() }, ...apiMessages];
    }

    await this._streamAssistantResponse(convId, model, apiMessages, cfg, settings);
  }

  async _streamAssistantResponse(convId, model, apiMessages, cfg, settings) {
    this._abortController = new AbortController();
    const { signal } = this._abortController;

    let started = false;
    let fullText = '';
    let metrics = null;
    let autoStopped = false;
    let lastRepCheckLen = 0;
    const autoStopRepetition = settings.autoStopRepetition !== false;
    try {
      for await (const chunk of streamCompletion(cfg.baseUrl, cfg.apiKey, model, apiMessages, {
        signal,
        onMetrics: (m) => { metrics = m; },
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        topP: settings.topP,
        idleTimeoutMs: 60000,
        retries: 2,
      })) {
        if (!started) {
          this.chat.startAssistantMessage();
          started = true;
        }
        fullText += chunk;
        this.chat.appendToAssistantMessage(chunk);
        // Throttle the (non-trivial) repetition check to every ~64 new chars.
        if (autoStopRepetition && fullText.length - lastRepCheckLen >= 64) {
          lastRepCheckLen = fullText.length;
          if (isRepeatingOutput(fullText)) {
            autoStopped = true;
            this._abortController?.abort();
            break;
          }
        }
      }

      if (!started) this.chat.startAssistantMessage();

      // Finalize
      if (autoStopped) {
        fullText += '\n\n_(检测到重复输出，已自动停止)_';
        this.chat.appendToAssistantMessage('\n\n_(检测到重复输出，已自动停止)_');
      }
      this.chat.finalizeAssistantMessage(fullText, model, metrics);
      const assistantMsg = {
        role: 'assistant',
        content: fullText,
        model,
        timestamp: new Date().toISOString(),
        ...(metrics ? { metrics } : {}),
      };
      store.addMessage(convId, assistantMsg);
      this._pushSessionMsg(convId, assistantMsg);
      this._updateContextInfo();
      this.sidebar.update();
    } catch (err) {
      if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        // User stopped, or the stream went idle — finalize whatever arrived.
        if (!started) this.chat.startAssistantMessage();
        this.chat.finalizeAssistantMessage(fullText, model, metrics);
        if (err.name === 'TimeoutError') {
          this.chat.showError('Warning: stream timed out (idle) — showing partial output.');
        }
        if (fullText) {
          const assistantMsg = {
            role: 'assistant',
            content: fullText,
            model,
            timestamp: new Date().toISOString(),
            ...(metrics ? { metrics } : {}),
          };
          store.addMessage(convId, assistantMsg);
          this._pushSessionMsg(convId, assistantMsg);
          this._updateContextInfo();
          this.sidebar.update();
        }
      } else {
        this.chat.showError(`Error: ${err.message}`);
      }
    } finally {
      this._abortController = null;
      this.inputBar.setSending(false);
      this.inputBar.focus();
    }
  }

  _setSessionMessages(convId, messages) {
    this._sessionMessages.set(convId, [...messages]);
  }

  async _editUserMessage(timestamp, text) {
    const convId = store.getCurrentConversationId();
    if (!convId || typeof text !== 'string' || !text.trim()) return;

    const conv = this._sessionConvFor(store.getCurrentConversation());
    const messages = conv?.messages || [];
    const index = messages.findIndex(message => message.timestamp === timestamp && message.role === 'user');
    if (index === -1 || typeof messages[index].content !== 'string') return;

    const model = this.modelPicker.getModel();
    if (!model) {
      this.chat.showError('Error: no model selected');
      return;
    }

    const cfg = this._getApiConfig();
    const settings = store.getSettings();
    const oldText = messages[index].content;

    // Preserve the original path before replacing the suffix. This makes prompt
    // experimentation reversible instead of silently deleting generated work.
    store.saveConversationBranch(
      convId,
      `Original: ${oldText.slice(0, 36) || 'empty prompt'}`,
      messages,
    );

    const editedMessage = {
      ...messages[index],
      content: text.trim(),
      editedAt: new Date().toISOString(),
    };
    const activeMessages = [...messages.slice(0, index), editedMessage];
    store.replaceMessages(convId, activeMessages);
    this._setSessionMessages(convId, activeMessages);

    const restoredConv = store.getCurrentConversation();
    this.chat.loadConversation(this._sessionConvFor(restoredConv));
    this._updateContextInfo();
    this.sidebar.update();

    let apiMessages = formatMessagesForApi(activeMessages);
    if (settings.systemPrompt && settings.systemPrompt.trim()) {
      apiMessages = [{ role: 'system', content: settings.systemPrompt.trim() }, ...apiMessages];
    }

    this.inputBar.setSending(true);
    this.chat.showTypingIndicator();
    await this._streamAssistantResponse(convId, model, apiMessages, cfg, settings);
  }

  _restoreConversationBranch(branchId) {
    const convId = store.getCurrentConversationId();
    if (!convId || !branchId) return;
    const branch = store.restoreConversationBranch(convId, branchId);
    if (!branch) {
      this.chat.showError('Error: conversation branch not found');
      return;
    }

    this._setSessionMessages(convId, branch.messages || []);
    const conv = store.getCurrentConversation();
    this.chat.loadConversation(this._sessionConvFor(conv));
    this._updateContextInfo();
    this.sidebar.update();
    this.chat.showSystemMessage('Restored conversation branch');
  }

  async _regenerateLastText() {
    const convId = store.getCurrentConversationId();
    if (!convId) return;
    const conv = this._sessionConvFor(store.getCurrentConversation());
    const messages = conv?.messages || [];
    if (!messages.length || messages[messages.length - 1].role !== 'assistant') return;

    // Find the last user message before the final assistant message.
    let userIdx = -1;
    for (let i = messages.length - 2; i >= 0; i--) {
      if (messages[i].role === 'user') { userIdx = i; break; }
    }
    if (userIdx === -1) return;

    const model = this.modelPicker.getModel();
    if (!model) { this.chat.showError('Error: no model selected'); return; }
    const cfg = this._getApiConfig();
    const settings = store.getSettings();

    // Keep the old response recoverable before dropping it from the active path.
    store.saveConversationBranch(convId, `Before regenerate: ${messages[messages.length - 1].content.slice(0, 32) || 'response'}`, messages);

    // Drop the last assistant message from both the store and the session cache.
    store.removeLastMessage(convId);
    if (this._sessionMessages.has(convId)) {
      this._sessionMessages.get(convId).pop();
    }

    // Rebuild the request from the truncated history (now ending at the user message).
    const truncated = this._sessionConvFor(store.getCurrentConversation())?.messages || [];
    let apiMessages = formatMessagesForApi(truncated);
    if (settings.systemPrompt && settings.systemPrompt.trim()) {
      apiMessages = [{ role: 'system', content: settings.systemPrompt.trim() }, ...apiMessages];
    }

    this.chat.loadConversation(this._sessionConvFor(store.getCurrentConversation()));
    this.inputBar.setSending(true);
    this.chat.showTypingIndicator();

    await this._streamAssistantResponse(convId, model, apiMessages, cfg, settings);
  }

  _buildUserMessage(text, image, video) {
    let content;
    if (image) {
      content = [
        { type: 'text', text: text || '' },
        { type: 'image_url', image_url: { url: image.dataUrl } },
      ];
    } else if (video) {
      const frames = Array.isArray(video.frames) ? video.frames : [];
      if (frames.length) {
        // AX8860 vision backend cannot encode merged video frames, so send sampled stills.
        content = [{ type: 'text', text: text || '' }];
        for (const frame of frames) {
          content.push({ type: 'image_url', image_url: { url: frame } });
        }
      } else {
        content = [
          { type: 'text', text: text || '' },
          { type: 'video_url', video_url: { url: video.dataUrl } },
        ];
      }
    } else {
      content = text;
    }

    const message = {
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };
    // The API receives sampled frames, but the chat must keep echoing the whole video.
    if (video) message.videoUrl = video.dataUrl;
    return message;
  }

  _buildDocumentUserMessage(instruction, attachment) {
    const extracted = attachment?.extracted || {};
    const fileName = extracted.name || attachment.file?.name || 'document';
    const content = instruction || `Please read ${fileName} and summarize the key points.`;
    const apiContent = formatDocumentForModel(instruction, extracted);

    return {
      role: 'user',
      content,
      apiContent,
      timestamp: new Date().toISOString(),
      meta: {
        type: 'document',
        fileName,
        kind: extracted.kind || '',
        sizeBytes: extracted.sizeBytes || attachment.file?.size || 0,
        charCount: extracted.text?.length || 0,
        truncated: extracted.truncated === true,
        pages: extracted.pages || null,
      },
    };
  }

  async _handleDocumentTask({ convId, model, instruction, document: attachment }) {
    if (attachment?.status !== 'ready' || !attachment.extracted?.text) {
      this.chat.showError('Error: document text is not ready');
      return;
    }

    const settings = store.getSettings();
    const cfg = this._getApiConfig();
    const contextConfig = resolveContextConfig(settings, model);
    const userMessage = this._buildDocumentUserMessage(instruction, attachment);
    const preConv = store.getCurrentConversation();
    const projectedTokens = estimateThreadTokens(preConv?.messages, userMessage);

    if (preConv?.messages?.length && projectedTokens >= contextConfig.resetTokens) {
      this._resetConversationContext(
        convId,
        `estimated ${projectedTokens.toLocaleString()} tokens reached the ${contextConfig.resetPercent}% auto-reset threshold`,
      );
    }

    try {
      this.chat.clearError();
      store.addMessage(convId, userMessage);
      this._pushSessionMsg(convId, userMessage);
      this.chat.appendUserMessage(userMessage);
      this._updateContextInfo();
    } catch (err) {
      this.chat.showError(`Error: ${err.message}`);
      this.inputBar.setSending(false);
      this.inputBar.focus();
      return;
    }

    const conv = store.getCurrentConversation();
    if (conv && conv.messages.length === 1) {
      store.updateConversationTitle(convId, `Doc: ${userMessage.meta.fileName}`.slice(0, 80));
      this.sidebar.update();
    }

    let apiMessages = formatMessagesForApi([...(preConv?.messages || []), userMessage]);
    if (settings.systemPrompt && settings.systemPrompt.trim()) {
      apiMessages = [{ role: 'system', content: settings.systemPrompt.trim() }, ...apiMessages];
    }

    this.inputBar.setSending(true);
    this.chat.showTypingIndicator();
    await this._streamAssistantResponse(convId, model, apiMessages, cfg, settings);
  }

  _buildAudioUserMessage(audio, instruction = '') {
    const summary = `Audio upload: ${audio.file?.name || 'audio'}`;
    const suffix = instruction ? `\nInstruction: ${instruction}` : '';
    return {
      role: 'user',
      content: `${summary}${suffix}`,
      timestamp: new Date().toISOString(),
      meta: {
        type: 'audio',
        fileName: audio.file?.name || 'audio',
      },
    };
  }

  async _handleDrawTask({ convId, model, prompt, image = null, seed = null }) {
    const ts = new Date().toISOString();
    // Full message (with source image for img2img) kept in-memory only — never in localStorage.
    const userMessage = {
      role: 'user',
      content: image?.dataUrl
        ? [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: image.dataUrl } },
          ]
        : prompt,
      timestamp: ts,
      meta: { type: 'draw' },
    };

    this.chat.clearError();
    // Store text-only version in localStorage to avoid quota issues with dataUrls.
    store.addMessage(convId, { role: 'user', content: prompt, timestamp: ts });
    this._pushSessionMsg(convId, userMessage);
    this.chat.appendUserMessage(userMessage);
    this._updateContextInfo();

    const conv = store.getCurrentConversation();
    if (conv && conv.messages.length === 1) {
      store.updateConversationTitle(convId, `Draw: ${prompt.slice(0, 35)}`);
      this.sidebar.update();
    }

    this.inputBar.setSending(true);
    this.chat.showTypingIndicator();

    this._abortController = new AbortController();
    const { signal } = this._abortController;
    const cfg = this._getApiConfig();

    try {
      const result = await generateImage(cfg.baseUrl, cfg.apiKey, model, prompt, { image, seed, signal });
      if (!result.images.length) {
        throw new Error('No images returned — the model may not support image generation');
      }
      // Convert HTTP URLs to base64 data URLs so images remain accessible
      // even after the backend is stopped — they become self-contained in the browser.
      const dataImages = await Promise.all(result.images.map(u => this._fetchImageAsDataUrl(u)));
      const assistantMsg = {
        role: 'assistant',
        content: `Generated image for: "${prompt}"`,
        generatedImages: dataImages,
        generatedPrompt: prompt,
        model,
        ...(result.seed !== null ? { generatedSeed: result.seed } : {}),
        timestamp: new Date().toISOString(),
      };

      this.chat.appendGeneratedImageMessage(assistantMsg);
      // Persist to localStorage with data URLs so images survive page reload too.
      // The store's quota handler will swallow any QuotaExceededError gracefully.
      store.addMessage(convId, {
        role: 'assistant',
        content: assistantMsg.content,
        model,
        timestamp: assistantMsg.timestamp,
        generatedPrompt: prompt,
        ...(dataImages.length ? { generatedImages: dataImages } : {}),
        ...(assistantMsg.generatedSeed !== undefined ? { generatedSeed: assistantMsg.generatedSeed } : {}),
      });
      this._pushSessionMsg(convId, assistantMsg);
      this._updateContextInfo();
      this.sidebar.update();
    } catch (err) {
      if (err.name !== 'AbortError') this.chat.showError(`Error: ${err.message}`);
    } finally {
      this._abortController = null;
      this.inputBar.setSending(false);
      this.inputBar.focus();
    }
  }

  async _handleRegenerateTask({ originalTimestamp, model, prompt }) {
    const originalMsg = this.chat.getMessageByTimestamp(originalTimestamp);
    this.chat.startRegeneratingMessage(originalTimestamp);
    this.inputBar.setSending(true);

    this._abortController = new AbortController();
    const { signal } = this._abortController;
    const cfg = this._getApiConfig();

    try {
      const newSeed = Math.floor(Math.random() * 1_000_000_000);
      const result = await generateImage(cfg.baseUrl, cfg.apiKey, model, prompt, { seed: newSeed, signal });
      if (!result.images.length) throw new Error('No images returned — the model may not support image generation');

      // Convert HTTP URLs to base64 data URLs for persistence.
      const dataImages = await Promise.all(result.images.map(u => this._fetchImageAsDataUrl(u)));
      const newMsg = {
        role: 'assistant',
        content: `Generated image for: "${prompt}"`,
        generatedImages: dataImages,
        generatedPrompt: prompt,
        generatedSeed: result.seed !== null ? result.seed : newSeed,
        model: model || (originalMsg?.model ?? ''),
        timestamp: originalTimestamp,
      };

      this.chat.replaceGeneratedImageMessage(originalTimestamp, newMsg);

      // Update persisted message in store with data URLs.
      const convId = store.getCurrentConversationId();
      if (convId) {
        store.updateMessage(convId, originalTimestamp, {
          ...(dataImages.length ? { generatedImages: dataImages } : {}),
          generatedSeed: newMsg.generatedSeed,
          generatedPrompt: prompt,
        });
      }
    } catch (err) {
      // Restore original message on any failure (including abort)
      if (originalMsg) this.chat.replaceGeneratedImageMessage(originalTimestamp, originalMsg);
      if (err.name !== 'AbortError') this.chat.showError(`Regenerate failed: ${err.message}`);
    } finally {
      this._abortController = null;
      this.inputBar.setSending(false);
      this.inputBar.focus();
    }
  }

  async _handleTTSTask({ convId, model, text, seed = null }) {
    const timestamp = new Date().toISOString();
    const userMessage = {
      role: 'user',
      content: text,
      timestamp,
      meta: { type: 'tts' },
    };

    this.chat.clearError();
    store.addMessage(convId, userMessage);
    this._pushSessionMsg(convId, userMessage);
    this.chat.appendUserMessage(userMessage);
    this._updateContextInfo();

    const conv = store.getCurrentConversation();
    if (conv && conv.messages.length === 1) {
      store.updateConversationTitle(convId, `TTS: ${text.slice(0, 36)}`);
      this.sidebar.update();
    }

    this.inputBar.setSending(true);
    this.chat.showTypingIndicator();

    this._abortController = new AbortController();
    const { signal } = this._abortController;
    const cfg = this._getApiConfig();

    try {
      const started = performance.now();
      // VoxCPM2's `/v1/models` currently advertises the BaseLM GGUF path, while
      // `/v1/audio/speech` expects the stable `voxcpm2` service model name.
      const requestModel = /voxcpm/i.test(model) ? 'voxcpm2' : model;
      const result = await generateSpeech(cfg.baseUrl, cfg.apiKey, requestModel, text, {
        seed,
        signal,
      });
      const url = this._createObjectUrl(result.blob);
      const elapsedMs = Math.round(performance.now() - started);
      const assistantMessage = {
        role: 'assistant',
        content: '语音已生成',
        model,
        generatedPrompt: text,
        generatedAudio: {
          ...(url ? { url } : {}),
          contentType: result.contentType,
          sizeBytes: result.blob.size,
        },
        ...(result.seed !== null ? { generatedSeed: result.seed } : {}),
        metrics: {
          elapsedMs,
        },
        timestamp: new Date().toISOString(),
      };

      this.chat.appendGeneratedAudioMessage(assistantMessage);

      // Do not persist the blob URL: it is only valid for this page session and
      // base64 WAV would easily exceed localStorage quota.
      const persistentMessage = {
        ...assistantMessage,
        generatedAudio: {
          contentType: result.contentType,
          sizeBytes: result.blob.size,
        },
      };
      store.addMessage(convId, persistentMessage);
      this._pushSessionMsg(convId, assistantMessage);
      this._updateContextInfo();
      this.sidebar.update();
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.chat.showError(`Error: ${err.message}`);
      } else {
        this.chat.hideTypingIndicator();
      }
    } finally {
      this._abortController = null;
      this.inputBar.setSending(false);
      this.inputBar.focus();
    }
  }

  async _handleAudioTask({ convId, model, instruction, audio }) {
    const userMessage = this._buildAudioUserMessage(audio, instruction);
    store.addMessage(convId, userMessage);
    this._pushSessionMsg(convId, userMessage);
    this.chat.appendUserMessage(userMessage);
    this._updateContextInfo();

    const conv = store.getCurrentConversation();
    if (conv && conv.messages.length === 1) {
      const title = (instruction || userMessage.content).slice(0, 40) || 'Audio task';
      store.updateConversationTitle(convId, title);
      this.sidebar.update();
    }

    this.inputBar.setSending(true);
    this.chat.showTypingIndicator();

    this._abortController = new AbortController();
    const { signal } = this._abortController;
    const cfg = this._getApiConfig();

    let fullText = '';
    let metrics = null;
    try {
      const transcript = await transcribeAudio(cfg.baseUrl, cfg.apiKey, model, audio.file, { signal });

      if (!instruction) {
        this.chat.hideTypingIndicator();
        this.chat.startAssistantMessage();
        this.chat.finalizeAssistantMessage(transcript, model);
        const assistantMsg = {
          role: 'assistant',
          content: transcript,
          model,
          timestamp: new Date().toISOString(),
        };
        store.addMessage(convId, assistantMsg);
        this._pushSessionMsg(convId, assistantMsg);
        this._updateContextInfo();
        this.sidebar.update();
        return;
      }

      const followUpMessage = {
        role: 'user',
        content: [
          `The following text came from an uploaded audio file.`,
          `Task: ${instruction}`,
          `Audio text:`,
          transcript,
        ].join('\n\n'),
        timestamp: new Date().toISOString(),
      };

      const currentConv = store.getCurrentConversation();
      const apiMessages = [
        ...formatMessagesForApi(currentConv.messages),
        { role: 'user', content: followUpMessage.content },
      ];

      this.chat.hideTypingIndicator();
      this.chat.showSystemMessage('Audio transcribed — applying instruction');
      this.chat.startAssistantMessage();

      for await (const chunk of streamCompletion(cfg.baseUrl, cfg.apiKey, model, apiMessages, {
        signal,
        onMetrics: (m) => { metrics = m; },
      })) {
        fullText += chunk;
        this.chat.appendToAssistantMessage(chunk);
      }

      this.chat.finalizeAssistantMessage(fullText, model, metrics);
      const assistantMsg = {
        role: 'assistant',
        content: fullText,
        model,
        timestamp: new Date().toISOString(),
        ...(metrics ? { metrics } : {}),
      };
      store.addMessage(convId, assistantMsg);
      this._pushSessionMsg(convId, assistantMsg);
      this._updateContextInfo();
      this.sidebar.update();
    } catch (err) {
      if (err.name === 'AbortError') {
        // Finalize partial text if any was received
        this.chat.finalizeAssistantMessage(fullText, model, metrics);
        if (fullText) {
          const assistantMsg = {
            role: 'assistant',
            content: fullText,
            model,
            timestamp: new Date().toISOString(),
            ...(metrics ? { metrics } : {}),
          };
          store.addMessage(convId, assistantMsg);
          this._pushSessionMsg(convId, assistantMsg);
          this._updateContextInfo();
          this.sidebar.update();
        }
      } else {
        this.chat.showError(`Error: ${err.message}`);
      }
    } finally {
      this._abortController = null;
      this.inputBar.setSending(false);
      this.inputBar.focus();
    }
  }

  _getApiConfig() {
    const ep = store.getActiveEndpoint();
    const settings = store.getSettings();
    return {
      baseUrl: ep?.baseUrl || settings.baseUrl,
      apiKey: ep?.apiKey ?? settings.apiKey,
    };
  }

  _initTheme() {
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.classList.toggle('dark', saved === 'dark');
    this._updateThemeBtn();
  }

  _toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    this._updateThemeBtn();
  }

  _updateThemeBtn() {
    const btn = this.root.querySelector('#theme-toggle-btn');
    if (!btn) return;
    const isDark = document.documentElement.classList.contains('dark');
    btn.innerHTML = isDark ? icon('sun') : icon('moon');
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  }

  _resetConversationContext(convId, reason) {
    if (!convId) return;
    const conv = store.getConversations().find((item) => item.id === convId);
    if (!conv) return;

    const { maxTokens } = resolveContextConfig(store.getSettings(), this.modelPicker.getModel());
    const currentTokens = estimateThreadTokens(conv.messages);
    store.clearMessages(convId);
    this.chat.showSystemMessage(
      `Context /reset — cleared ${currentTokens.toLocaleString()} estimated tokens (${reason}; window ${maxTokens.toLocaleString()})`
    );
    this._updateContextInfo();
  }

  _updateContextInfo() {
    const conv = store.getCurrentConversation();
    const model = this.modelPicker.getModel();
    const { maxTokens, warnTokens } = resolveContextConfig(store.getSettings(), model);
    const currentTokens = estimateThreadTokens(conv?.messages);
    this.inputBar.setContextInfo(currentTokens, maxTokens, warnTokens);
  }

  _toggleMobileSidebar() {
    if (this._isDesktopLayout()) return;
    this._sidebarOpen = !this._sidebarOpen;
    this._syncSidebarLayout();
  }

  _closeMobileSidebar() {
    if (this._isDesktopLayout()) {
      this._syncSidebarLayout();
      return;
    }
    this._sidebarOpen = false;
    this._syncSidebarLayout();
  }

  _isDesktopLayout() {
    return window.innerWidth >= 768;
  }

  _syncSidebarLayout() {
    const sidebar = this.root.querySelector('#sidebar');
    if (!sidebar) return;

    if (this._isDesktopLayout()) {
      sidebar.classList.remove('-translate-x-full', 'translate-x-0', 'fixed', 'inset-y-0', 'left-0', 'z-30');
      this._mobileOverlay?.classList.add('hidden');
      this._sidebarOpen = true;
      return;
    }

    sidebar.classList.add('fixed', 'inset-y-0', 'left-0', 'z-30');

    if (this._sidebarOpen) {
      sidebar.classList.remove('-translate-x-full');
      sidebar.classList.add('translate-x-0');
      this._mobileOverlay?.classList.remove('hidden');
    } else {
      sidebar.classList.add('-translate-x-full');
      sidebar.classList.remove('translate-x-0');
      this._mobileOverlay?.classList.add('hidden');
    }
  }
}
