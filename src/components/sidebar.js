import { store } from '../store.js';
import { icon } from '../icons.js';

function relativeTime(isoString) {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(isoString).toLocaleDateString();
}

export class Sidebar {
  constructor() {
    this.el = null;
    this._mobileOpen = false;
  }

  render() {
    const wrapper = document.createElement('div');
    wrapper.className = 'relative';
    wrapper.innerHTML = this._template();
    this.el = wrapper.firstElementChild;
    this._bindEvents();
    return this.el;
  }

  _template() {
    const convs = store.getConversations();
    const currentId = store.getCurrentConversationId();

    const items = convs.map(conv => {
      const active = conv.id === currentId;
      return `
        <div class="group relative flex items-center gap-2 rounded-xl cursor-pointer border px-3 py-2.5 transition-all ${active ? 'border-[var(--c-side-act-bd)] bg-[var(--c-side-act)]' : 'border-transparent hover:border-[var(--c-side-bd)] hover:bg-[var(--c-side-el)]'}" data-conv-id="${conv.id}" role="option" aria-selected="${active}">
          <div class="flex-1 min-w-0">
            <div class="text-[13px] truncate ${active ? 'font-medium text-[var(--c-side-tx)]' : 'text-[var(--c-side-tx2)]'}">${escapeHtml(conv.title || 'New Chat')}</div>
            <div class="mt-0.5 truncate text-[11px] text-[var(--c-side-tx3)]">${relativeTime(conv.updatedAt || conv.createdAt)}</div>
          </div>
          <button class="delete-conv flex-shrink-0 p-1 rounded-md text-[var(--c-side-tx3)] opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--c-side-el-h)] hover:text-[var(--c-side-tx)]" data-conv-id="${conv.id}" aria-label="Delete conversation">
            ${icon('trash')}
          </button>
        </div>
      `;
    }).join('');

    return `
      <aside id="sidebar" class="sidebar-transition flex h-full w-56 flex-col border-r border-[var(--c-side-bd)] bg-[var(--c-side)] flex-shrink-0">
        <div class="px-3 pt-3 pb-2">
          <button id="new-chat-btn" class="flex w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--c-side-bd)] bg-[var(--c-side-el)] px-3 py-2.5 text-[12px] text-[var(--c-side-tx2)] transition-all hover:bg-[var(--c-side-el-h)] hover:text-[var(--c-side-tx)] hover:border-[var(--c-side-act-bd)]" aria-label="New chat">
            ${icon('plus')} <span>New Chat</span>
          </button>
        </div>
        <div id="conv-list" class="flex-1 overflow-y-auto pb-2 px-2 space-y-px" role="listbox" aria-label="Conversations">
          ${items || '<div class="px-4 py-10 text-center text-[11px] leading-relaxed text-[var(--c-side-tx3)]">No conversations yet.<br>Start a new chat!</div>'}
        </div>
        <div class="border-t border-[var(--c-side-bd)] px-3 py-3">
          <div class="flex items-center gap-2 rounded-xl px-1.5 py-1">
            <div class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--c-side-bd)] bg-[var(--c-side-el)]">
              <img src="/logo.svg" alt="" class="h-4 w-4 object-contain" aria-hidden="true" />
            </div>
            <div class="min-w-0">
              <div class="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--c-side-tx2)]">AXERA</div>
              <div class="truncate text-[10px] text-[var(--c-side-tx3)]">Lite WebUI</div>
            </div>
          </div>
        </div>
      </aside>
    `;
  }

  _bindEvents() {
    this.el.querySelector('#new-chat-btn').addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('sidebar:newchat'));
    });

    this.el.querySelector('#conv-list').addEventListener('click', (e) => {
      const delBtn = e.target.closest('.delete-conv');
      if (delBtn) {
        e.stopPropagation();
        const convId = delBtn.dataset.convId;
        if (confirm('Delete this conversation?')) {
          store.deleteConversation(convId);
          document.dispatchEvent(new CustomEvent('sidebar:deleted', { detail: { convId } }));
          this.update();
        }
        return;
      }
      const item = e.target.closest('[data-conv-id]');
      if (item && !item.classList.contains('delete-conv')) {
        const convId = item.dataset.convId;
        document.dispatchEvent(new CustomEvent('sidebar:select', { detail: { convId } }));
      }
    });
  }

  update() {
    const list = this.el.querySelector('#conv-list');
    const convs = store.getConversations();
    const currentId = store.getCurrentConversationId();

    if (convs.length === 0) {
      list.innerHTML = '<div class="px-4 py-10 text-center text-[11px] leading-relaxed text-[var(--c-side-tx3)]">No conversations yet.<br>Start a new chat!</div>';
      return;
    }

    const items = convs.map(conv => {
      const active = conv.id === currentId;
      return `
        <div class="group relative flex items-center gap-2 rounded-xl cursor-pointer border px-3 py-2.5 transition-all ${active ? 'border-[var(--c-side-act-bd)] bg-[var(--c-side-act)]' : 'border-transparent hover:border-[var(--c-side-bd)] hover:bg-[var(--c-side-el)]'}" data-conv-id="${conv.id}" role="option" aria-selected="${active}">
          <div class="flex-1 min-w-0">
            <div class="text-[13px] truncate ${active ? 'font-medium text-[var(--c-side-tx)]' : 'text-[var(--c-side-tx2)]'}">${escapeHtml(conv.title || 'New Chat')}</div>
            <div class="mt-0.5 truncate text-[11px] text-[var(--c-side-tx3)]">${relativeTime(conv.updatedAt || conv.createdAt)}</div>
          </div>
          <button class="delete-conv flex-shrink-0 p-1 rounded-md text-[var(--c-side-tx3)] opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--c-side-el-h)] hover:text-[var(--c-side-tx)]" data-conv-id="${conv.id}" aria-label="Delete conversation">
            ${icon('trash')}
          </button>
        </div>
      `;
    }).join('');

    list.innerHTML = items;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
