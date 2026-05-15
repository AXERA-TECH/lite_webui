import { store } from '../store.js';
import {
  streamCompletion,
  formatMessagesForApi,
  transcribeAudio,
  generateImage,
} from '../api.js';
import { estimateThreadTokens, resolveContextConfig } from '../context.js';
import { Sidebar } from './sidebar.js';
import { Chat } from './chat.js';
import { InputBar } from './input-bar.js';
import { ModelPicker } from './model-picker.js';
import { SettingsModal } from './settings-modal.js';
import { icon } from '../icons.js';

export class App {
  constructor(rootEl) {
    this.root = rootEl;
    this.sidebar = new Sidebar();
    this.chat = new Chat();
    this.inputBar = new InputBar();
    this.modelPicker = new ModelPicker();
    this.settingsModal = new SettingsModal();
    this._sidebarOpen = false;
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

    // Send message
    document.addEventListener('inputbar:send', (e) => {
      this._handleSend(e.detail.text, e.detail.image, e.detail.video, e.detail.audio, e.detail.draw);
    });

    // Model change
    document.addEventListener('model:changed', () => {
      this.inputBar.setModel(this.modelPicker.getModel());
      this._updateContextInfo();
    });

    document.addEventListener('settings:changed', () => {
      this.inputBar.setModel(this.modelPicker.getModel());
      this._updateContextInfo();
    });

    document.addEventListener('models:changed', () => {
      this.modelPicker.setModels(store.getAvailableModels());
      this.inputBar.setModel(this.modelPicker.getModel());
      this._updateContextInfo();
    });
  }

  _loadCurrentConversation() {
    const currentId = store.getCurrentConversationId();
    if (currentId) {
      const conv = store.getCurrentConversation();
      if (conv) {
        this.chat.loadConversation(this._sessionConvFor(conv));
        this.modelPicker.syncToConversation(conv);
        this.inputBar.setModel(this.modelPicker.getModel());
        this._updateContextInfo();
        return;
      }
    }
    // No current or invalid current — pick first if exists
    const convs = store.getConversations();
    if (convs.length > 0) {
      this._selectConversation(convs[0].id);
    }
  }

  _newChat() {
    const model = this.modelPicker.getModel();
    const conv = store.createConversation(model);
    store.setCurrentConversationId(conv.id);
    this.chat.loadConversation(conv);
    this.sidebar.update();
    this._updateContextInfo();
    this.inputBar.focus();
    this._syncSidebarLayout();
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
    this.inputBar.setModel(this.modelPicker.getModel());
    this.sidebar.update();
    this._updateContextInfo();
    this.inputBar.focus();
    this._closeMobileSidebar();
  }

  async _handleSend(text, image, video, audio, draw) {
    const settings = store.getSettings();
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
        settings,
        instruction: trimmedText,
        audio,
      });
      return;
    }

    if (draw && trimmedText) {
      await this._handleDrawTask({ convId, model, settings, prompt: trimmedText });
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
    const apiMessages = formatMessagesForApi([...(preConv?.messages || []), userMessage]);

    try {
      let started = false;
      let fullText = '';

      for await (const chunk of streamCompletion(settings.baseUrl, settings.apiKey, model, apiMessages)) {
        if (!started) {
          this.chat.startAssistantMessage();
          started = true;
        }
        fullText += chunk;
        this.chat.appendToAssistantMessage(chunk);
      }

      if (!started) this.chat.startAssistantMessage();

      // Finalize
      this.chat.finalizeAssistantMessage(fullText);
      const assistantMsg = {
        role: 'assistant',
        content: fullText,
        timestamp: new Date().toISOString(),
      };
      store.addMessage(convId, assistantMsg);
      this._pushSessionMsg(convId, assistantMsg);
      this._updateContextInfo();
      this.sidebar.update();
    } catch (err) {
      this.chat.showError(`Error: ${err.message}`);
    } finally {
      this.inputBar.setSending(false);
      this.inputBar.focus();
    }
  }

  _buildUserMessage(text, image, video) {
    let content;
    if (image) {
      content = [
        { type: 'text', text: text || '' },
        { type: 'image_url', image_url: { url: image.dataUrl } },
      ];
    } else if (video) {
      content = [
        { type: 'text', text: text || '' },
        { type: 'video_url', video_url: { url: video.dataUrl } },
      ];
    } else {
      content = text;
    }

    return {
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };
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

  async _handleDrawTask({ convId, model, settings, prompt }) {
    const userMessage = {
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
    };

    this.chat.clearError();
    store.addMessage(convId, userMessage);
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

    try {
      const dataUrls = await generateImage(settings.baseUrl, settings.apiKey, model, prompt);
      if (!dataUrls.length) {
        throw new Error('No images returned — the model may not support image generation');
      }
      const assistantMsg = {
        role: 'assistant',
        content: `Generated image for: "${prompt}"`,
        generatedImages: dataUrls,
        timestamp: new Date().toISOString(),
      };

      this.chat.appendGeneratedImageMessage(assistantMsg);
      // Persist text-only version to localStorage (avoid storing large b64 dataUrls)
      store.addMessage(convId, { role: 'assistant', content: assistantMsg.content, timestamp: assistantMsg.timestamp });
      this._pushSessionMsg(convId, assistantMsg);
      this._updateContextInfo();
      this.sidebar.update();
    } catch (err) {
      this.chat.showError(`Error: ${err.message}`);
    } finally {
      this.inputBar.setSending(false);
      this.inputBar.focus();
    }
  }

  async _handleAudioTask({ convId, model, settings, instruction, audio }) {
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

    try {
      const transcript = await transcribeAudio(settings.baseUrl, settings.apiKey, model, audio.file);

      if (!instruction) {
        this.chat.hideTypingIndicator();
        this.chat.startAssistantMessage();
        this.chat.finalizeAssistantMessage(transcript);
        const assistantMsg = {
          role: 'assistant',
          content: transcript,
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

      let fullText = '';
      for await (const chunk of streamCompletion(settings.baseUrl, settings.apiKey, model, apiMessages)) {
        fullText += chunk;
        this.chat.appendToAssistantMessage(chunk);
      }

      this.chat.finalizeAssistantMessage(fullText);
      const assistantMsg = {
        role: 'assistant',
        content: fullText,
        timestamp: new Date().toISOString(),
      };
      store.addMessage(convId, assistantMsg);
      this._pushSessionMsg(convId, assistantMsg);
      this._updateContextInfo();
      this.sidebar.update();
    } catch (err) {
      this.chat.showError(`Error: ${err.message}`);
    } finally {
      this.inputBar.setSending(false);
      this.inputBar.focus();
    }
  }

  _initTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
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
