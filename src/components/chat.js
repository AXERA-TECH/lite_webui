import { renderMarkdown, attachCopyButtons, parseThinkStream } from '../markdown.js';
import { icon } from '../icons.js';

const MAX_VISIBLE = 50;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getTextContent(message) {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    const textParts = message.content.filter(p => p.type === 'text').map(p => p.text);
    return textParts.join('\n');
  }
  return '';
}

function getImageParts(message) {
  if (!Array.isArray(message.content)) return [];
  return message.content.filter(p => p.type === 'image_url');
}

function getVideoParts(message) {
  if (!Array.isArray(message.content)) return [];
  return message.content.filter(p => p.type === 'video_url');
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export class Chat {
  constructor() {
    this.el = null;
    this._messages = [];
    this._offset = 0; // how many messages we've hidden
    this._streamingEl = null;
    this._typingEl = null;
    this._errorEl = null;
  }

  render() {
    const el = document.createElement('div');
    el.className = 'flex flex-col h-full';
    el.innerHTML = `
      <div id="chat-messages" class="flex-1 overflow-y-auto py-6" role="log" aria-live="polite" aria-label="Chat messages">
        ${this._welcomeScreen()}
      </div>
    `;
    this.el = el;
    return this.el;
  }

  _welcomeScreen() {
    return `
      <div id="welcome-screen" class="flex h-full items-center justify-center px-6 py-16">
        <div class="w-full max-w-2xl text-center">
          <h2 class="text-3xl font-semibold tracking-tight text-[var(--c-tx)] md:text-4xl">需要我为你做些什么？</h2>
          <p class="mx-auto mt-4 max-w-xl text-sm leading-7 text-[var(--c-tx2)] md:text-[15px]">
            直接开始提问，或先在 Settings 中配置模型与上下文限制。
          </p>
        </div>
      </div>
    `;
  }

  loadConversation(conversation) {
    this._messages = conversation?.messages || [];
    this._streamingEl = null;
    this._typingEl = null;
    this._rerender();
  }

  _rerender() {
    const container = this.el.querySelector('#chat-messages');
    if (!container) return;

    container.innerHTML = '';

    if (this._messages.length === 0) {
      container.innerHTML = this._welcomeScreen();
      return;
    }

    const msgs = this._messages;
    const total = msgs.length;
    this._offset = Math.max(0, total - MAX_VISIBLE);
    const visible = msgs.slice(this._offset);

    if (this._offset > 0) {
      const loadMore = document.createElement('div');
      loadMore.className = 'max-w-4xl mx-auto w-full px-6 flex justify-center py-4';
      loadMore.innerHTML = `<button id="load-older-btn" class="text-[12px] text-[var(--c-tx3)] border border-[var(--c-bd)] rounded-full px-4 py-1.5 hover:text-[var(--c-tx2)] hover:border-[var(--c-bd-hi)] transition-all">Load ${this._offset} older messages</button>`;
      loadMore.querySelector('#load-older-btn').addEventListener('click', () => this._loadOlder(container));
      container.appendChild(loadMore);
    }

    visible.forEach(msg => {
      const el = this._buildMessageEl(msg);
      container.appendChild(el);
    });

    this._scrollToBottom();
  }

  _loadOlder(container) {
    const loadMoreDiv = container.querySelector('#load-older-btn')?.parentElement;
    const msgs = this._messages;
    const newOffset = Math.max(0, this._offset - MAX_VISIBLE);
    const olderMsgs = msgs.slice(newOffset, this._offset);
    this._offset = newOffset;

    const fragment = document.createDocumentFragment();
    if (newOffset > 0) {
      const newLoadMore = document.createElement('div');
      newLoadMore.className = 'max-w-4xl mx-auto w-full px-6 flex justify-center py-4';
      newLoadMore.innerHTML = `<button id="load-older-btn" class="text-[12px] text-[var(--c-tx3)] border border-[var(--c-bd)] rounded-full px-4 py-1.5 hover:text-[var(--c-tx2)] hover:border-[var(--c-bd-hi)] transition-all">Load ${newOffset} older messages</button>`;
      newLoadMore.querySelector('#load-older-btn').addEventListener('click', () => this._loadOlder(container));
      fragment.appendChild(newLoadMore);
    }

    olderMsgs.forEach(msg => {
      fragment.appendChild(this._buildMessageEl(msg));
    });

    if (loadMoreDiv) {
      container.insertBefore(fragment, loadMoreDiv);
      loadMoreDiv.remove();
    } else {
      container.insertBefore(fragment, container.firstChild);
    }
  }

  _buildMessageEl(msg) {
    const isUser = msg.role === 'user';
    const text = getTextContent(msg);
    const images = getImageParts(msg);
    const videos = getVideoParts(msg);
    const genImages = msg.generatedImages || [];
    const time = formatTime(msg.timestamp);

    const wrapper = document.createElement('div');
    wrapper.className = 'message-enter max-w-4xl mx-auto w-full px-6 mb-4';
    wrapper.dataset.msgId = msg.timestamp || Math.random();

    if (isUser) {
      const imageHtml = images.map(img => `
        <img src="${img.image_url?.url || ''}" alt="Attached image" class="max-w-xs max-h-48 rounded-xl border border-[var(--c-bd)] object-cover mb-2" />
      `).join('');

      const videoHtml = videos.map(vid => `
        <video src="${escapeHtml(vid.video_url?.url || '')}" controls muted playsinline
          class="max-w-xs max-h-48 rounded-xl border border-[var(--c-bd)] bg-black mb-2"></video>
      `).join('');

      wrapper.innerHTML = `
        <div class="flex justify-end">
          <div class="max-w-[65%]">
            ${imageHtml}
            ${videoHtml}
            <div class="user-bubble px-4 py-3 text-[13.5px] text-[var(--c-utx)] whitespace-pre-wrap break-words leading-relaxed">${escapeHtml(text)}</div>
            ${time ? `<div class="text-[11px] text-[var(--c-tx3)] mt-1.5 text-right">${time}</div>` : ''}
          </div>
        </div>
      `;
    } else {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'w-full';

      if (genImages.length > 0) {
        genImages.forEach((src, idx) => {
          const imgWrapper = document.createElement('div');
          imgWrapper.className = 'mb-3';

          const imgEl = document.createElement('img');
          imgEl.src = src;
          imgEl.alt = 'Generated image';
          imgEl.className = 'max-w-full rounded-xl border border-[var(--c-bd)] shadow-sm';
          imgWrapper.appendChild(imgEl);

          const dlRow = document.createElement('div');
          dlRow.className = 'mt-2 flex items-center gap-2';

          if (msg.generatedSeed != null) {
            const seedBadge = document.createElement('span');
            seedBadge.className = 'inline-flex items-center gap-1 text-[11px] font-mono text-[var(--c-tx3)] border border-[var(--c-bd)] rounded-lg px-2.5 py-1 select-all';
            seedBadge.title = 'Seed used for generation — click to copy';
            seedBadge.textContent = `seed: ${msg.generatedSeed}`;
            seedBadge.style.cursor = 'pointer';
            seedBadge.addEventListener('click', () => {
              navigator.clipboard?.writeText(String(msg.generatedSeed)).catch(() => {});
            });
            dlRow.appendChild(seedBadge);
          }

          const dlLink = document.createElement('a');
          dlLink.href = src;
          dlLink.download = `generated-${idx + 1}.png`;
          dlLink.className = 'inline-flex items-center gap-1.5 text-[12px] text-[var(--c-tx3)] hover:text-[var(--c-tx2)] border border-[var(--c-bd)] rounded-lg px-3 py-1 transition-colors';
          dlLink.innerHTML = `${icon('download')} Download`;

          dlRow.appendChild(dlLink);
          imgWrapper.appendChild(dlRow);
          msgDiv.appendChild(imgWrapper);
        });
      } else {
        this._renderAssistantBubble(text, msgDiv);
      }

      if (time) {
        const timeEl = document.createElement('div');
        timeEl.className = 'text-[11px] text-[var(--c-tx3)] mt-2';
        timeEl.textContent = time;
        msgDiv.appendChild(timeEl);
      }

      wrapper.appendChild(msgDiv);
    }

    return wrapper;
  }

  // Renders an assistant text message into `container`, handling <think> blocks.
  _renderAssistantBubble(text, container) {
    const { thinkText, mainText } = parseThinkStream(text);
    if (thinkText) {
      const details = document.createElement('details');
      details.className = 'think-block';
      details.innerHTML = `
        <summary>
          ${icon('sparkle')}
          <span>Thinking</span>
          <span class="think-chevron">${icon('chevronDown')}</span>
        </summary>
        <div class="think-block-content">${renderMarkdown(thinkText)}</div>
      `;
      attachCopyButtons(details);
      container.appendChild(details);
    }
    const bubble = document.createElement('div');
    bubble.className = 'text-[13.5px] prose-dark leading-relaxed';
    bubble.innerHTML = renderMarkdown(thinkText ? mainText : text);
    attachCopyButtons(bubble);
    container.appendChild(bubble);
  }

  appendUserMessage(message) {
    this._messages.push(message);
    const container = this.el.querySelector('#chat-messages');

    // Remove welcome screen if present
    const welcome = container.querySelector('#welcome-screen');
    if (welcome) welcome.remove();

    const el = this._buildMessageEl(message);
    container.appendChild(el);
    this._scrollToBottom();
  }

  showTypingIndicator() {
    const container = this.el.querySelector('#chat-messages');
    this.hideTypingIndicator();

    this._typingEl = document.createElement('div');
    this._typingEl.className = 'max-w-4xl mx-auto w-full px-6 mb-4';
    this._typingEl.innerHTML = `
      <div class="flex justify-start">
        <div class="flex items-center gap-1.5 py-3 px-1">
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
        </div>
      </div>
    `;
    container.appendChild(this._typingEl);
    this._scrollToBottom();
  }

  hideTypingIndicator() {
    if (this._typingEl) {
      this._typingEl.remove();
      this._typingEl = null;
    }
  }

  startAssistantMessage() {
    this.hideTypingIndicator();
    const container = this.el.querySelector('#chat-messages');

    const wrapper = document.createElement('div');
    wrapper.className = 'message-enter max-w-4xl mx-auto w-full px-6 mb-4';

    const msgDiv = document.createElement('div');
    msgDiv.className = 'w-full';

    const bubble = document.createElement('div');
    bubble.className = 'text-[13.5px] prose-dark leading-relaxed';
    bubble.innerHTML = '<span class="streaming-cursor opacity-60">▋</span>';

    msgDiv.appendChild(bubble);
    wrapper.appendChild(msgDiv);
    container.appendChild(wrapper);
    this._scrollToBottom();
    this._streamingEl = bubble;
    this._streamingThinkEl = null;
    this._streamingText = '';
    return bubble;
  }

  appendToAssistantMessage(chunk) {
    if (!this._streamingEl) return;
    this._streamingText = (this._streamingText || '') + chunk;

    const { thinkText, mainText, inThink } = parseThinkStream(this._streamingText);

    // Create or update the think streaming block (skip if think text is only whitespace)
    if (thinkText.trim() || inThink) {
      if (!this._streamingThinkEl && thinkText.trim()) {
        const thinkEl = document.createElement('div');
        thinkEl.className = 'think-streaming';
        thinkEl.dataset.state = 'active';
        thinkEl.innerHTML = `
          <div class="think-streaming-header">
            <span class="think-streaming-icon">${icon('sparkle')}</span>
            <span class="think-streaming-label">Thinking…</span>
          </div>
          <div class="think-streaming-body"></div>
        `;
        this._streamingEl.parentNode.insertBefore(thinkEl, this._streamingEl);
        this._streamingThinkEl = thinkEl;
      }
      // Guard: element may not exist yet if think block just opened with whitespace only
      if (this._streamingThinkEl) {
        const label = this._streamingThinkEl.querySelector('.think-streaming-label');
        const body = this._streamingThinkEl.querySelector('.think-streaming-body');
        if (!inThink) {
          // Think block is complete; stop animation
          this._streamingThinkEl.dataset.state = 'done';
          if (label) label.textContent = 'Thought';
        }
        if (body) {
          body.textContent = thinkText;
          // Auto-scroll the think body to keep latest content visible
          body.scrollTop = body.scrollHeight;
        }
      }
    }

    const cursor = '<span class="streaming-cursor opacity-60 animate-pulse">▋</span>';
    this._streamingEl.innerHTML = mainText
      ? renderMarkdown(mainText) + cursor
      : cursor;

    this._scrollToBottom();
  }

  finalizeAssistantMessage(fullText) {
    if (!this._streamingEl) return;

    const msgDiv = this._streamingEl.parentNode;
    const { thinkText, mainText } = parseThinkStream(fullText);

    // Remove streaming think block
    if (this._streamingThinkEl) {
      this._streamingThinkEl.remove();
      this._streamingThinkEl = null;
    }

    // Insert collapsed think <details> if we have thinking content
    if (thinkText) {
      const details = document.createElement('details');
      details.className = 'think-block';
      details.innerHTML = `
        <summary>
          ${icon('sparkle')}
          <span>Thinking</span>
          <span class="think-chevron">${icon('chevronDown')}</span>
        </summary>
        <div class="think-block-content">${renderMarkdown(thinkText)}</div>
      `;
      attachCopyButtons(details);
      msgDiv.insertBefore(details, this._streamingEl);
    }

    const renderedText = thinkText ? mainText : fullText;
    this._streamingEl.innerHTML = renderMarkdown(renderedText);
    attachCopyButtons(this._streamingEl);
    this._streamingEl = null;
    this._streamingText = '';
    this._messages.push({
      role: 'assistant',
      content: fullText,
      timestamp: new Date().toISOString(),
    });
    this._scrollToBottom();
  }

  appendGeneratedImageMessage(msg) {
    this.hideTypingIndicator();
    const container = this.el.querySelector('#chat-messages');
    this._messages.push(msg);
    const el = this._buildMessageEl(msg);
    container.appendChild(el);
    this._scrollToBottom();
  }

  showError(message) {
    const container = this.el.querySelector('#chat-messages');
    this.hideTypingIndicator();
    if (this._streamingEl) {
      if (this._streamingThinkEl) {
        this._streamingThinkEl.remove();
        this._streamingThinkEl = null;
      }
      this._streamingEl.innerHTML = `<span class="text-red-600 dark:text-red-400">${escapeHtml(message)}</span>`;
      this._streamingEl = null;
      this._streamingText = '';
      return;
    }
    const errEl = document.createElement('div');
    errEl.className = 'max-w-4xl mx-auto w-full px-6 mb-4 message-enter';
    errEl.innerHTML = `
      <div class="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-xl px-4 py-3 text-[13px] text-red-700 dark:text-red-400 flex items-center gap-2">
        ${icon('x')} ${escapeHtml(message)}
      </div>
    `;
    this._errorEl = errEl;
    container.appendChild(errEl);
    this._scrollToBottom();
  }

  clearError() {
    if (this._errorEl) {
      this._errorEl.remove();
      this._errorEl = null;
    }
  }

  showSystemMessage(text) {
    const container = this.el.querySelector('#chat-messages');
    if (!container) return;
    const welcome = container.querySelector('#welcome-screen');
    if (welcome) welcome.remove();
    const el = document.createElement('div');
    el.className = 'max-w-4xl mx-auto w-full px-6 my-3 message-enter flex justify-center';
    el.innerHTML = `
      <div class="text-[11px] text-[var(--c-tx3)] border border-[var(--c-bd)] rounded-full px-3 py-1 bg-[var(--c-ho)] select-none">
        ${escapeHtml(text)}
      </div>
    `;
    container.appendChild(el);
    this._scrollToBottom();
  }

  _scrollToBottom() {
    const container = this.el.querySelector('#chat-messages');
    if (container) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }

  clear() {
    this._messages = [];
    this._streamingEl = null;
    this._streamingText = '';
    this._typingEl = null;
    this._errorEl = null;
    const container = this.el.querySelector('#chat-messages');
    if (container) container.innerHTML = this._welcomeScreen();
  }
}
