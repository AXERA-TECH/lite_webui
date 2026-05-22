// LocalStorage keys
const KEYS = {
  SETTINGS: 'lw_settings',
  CONVERSATIONS: 'lw_conversations',
  CURRENT_CONV: 'lw_current_conv',
  MODEL_CAPS: 'lw_model_caps',
  AVAILABLE_MODELS: 'lw_available_models',
  MODEL_SELECTIONS: 'lw_model_selections',
  ENDPOINTS: 'lw_endpoints',
  ACTIVE_ENDPOINT: 'lw_active_endpoint',
};

const DEFAULT_SETTINGS = {
  apiKey: '',
  baseUrl: 'http://127.0.0.1:8000',
  theme: 'light',
  contextLimitTokens: 4096,
  contextResetThresholdPercent: 85,
};

export function normalizeBaseUrl(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) return DEFAULT_SETTINGS.baseUrl;
  return raw.replace(/\/+$/, '');
}

function isCapabilityRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return ['text', 'image', 'audio'].some((key) => key in value);
}

function isLegacyCapabilityMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.values(value);
  return entries.length > 0 && entries.every(isCapabilityRecord);
}

function normalizeSettings(settings = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  const contextLimitTokens = Number(merged.contextLimitTokens);
  const contextResetThresholdPercent = Number(merged.contextResetThresholdPercent);

  merged.baseUrl = normalizeBaseUrl(merged.baseUrl);
  merged.contextLimitTokens = Number.isFinite(contextLimitTokens) && contextLimitTokens >= 1024
    ? Math.round(contextLimitTokens)
    : DEFAULT_SETTINGS.contextLimitTokens;

  merged.contextResetThresholdPercent = Number.isFinite(contextResetThresholdPercent)
    ? Math.min(95, Math.max(50, Math.round(contextResetThresholdPercent)))
    : DEFAULT_SETTINGS.contextResetThresholdPercent;

  return merged;
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    if (e?.name === 'QuotaExceededError' || e?.code === 22) {
      console.warn('[store] localStorage quota exceeded — conversation not persisted');
    } else {
      throw e;
    }
  }
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const store = {
  getSettings() {
    return normalizeSettings(load(KEYS.SETTINGS, {}));
  },

  saveSettings(settings) {
    save(KEYS.SETTINGS, normalizeSettings(settings));
  },

  getConversations() {
    return load(KEYS.CONVERSATIONS, []);
  },

  saveConversations(conversations) {
    save(KEYS.CONVERSATIONS, conversations);
  },

  getCurrentConversationId() {
    return localStorage.getItem(KEYS.CURRENT_CONV) || null;
  },

  setCurrentConversationId(id) {
    if (id) {
      localStorage.setItem(KEYS.CURRENT_CONV, id);
    } else {
      localStorage.removeItem(KEYS.CURRENT_CONV);
    }
  },

  getCurrentConversation() {
    const id = this.getCurrentConversationId();
    if (!id) return null;
    const convs = this.getConversations();
    return convs.find(c => c.id === id) || null;
  },

  getAvailableModels(baseUrl = this.getSettings().baseUrl) {
    const catalogs = load(KEYS.AVAILABLE_MODELS, {});
    const list = catalogs[normalizeBaseUrl(baseUrl)];
    return Array.isArray(list) ? [...new Set(list.filter(Boolean))].sort() : [];
  },

  saveAvailableModels(baseUrl, models) {
    const catalogs = load(KEYS.AVAILABLE_MODELS, {});
    catalogs[normalizeBaseUrl(baseUrl)] = Array.isArray(models)
      ? [...new Set(models.filter(Boolean))].sort()
      : [];
    save(KEYS.AVAILABLE_MODELS, catalogs);
  },

  getCurrentModel(baseUrl = this.getSettings().baseUrl) {
    const selections = load(KEYS.MODEL_SELECTIONS, {});
    const selected = selections[normalizeBaseUrl(baseUrl)];
    return typeof selected === 'string' ? selected : '';
  },

  setCurrentModel(baseUrl, modelId) {
    const selections = load(KEYS.MODEL_SELECTIONS, {});
    const normalizedUrl = normalizeBaseUrl(baseUrl);
    if (modelId) {
      selections[normalizedUrl] = modelId;
    } else {
      delete selections[normalizedUrl];
    }
    save(KEYS.MODEL_SELECTIONS, selections);
  },

  getModelCapabilities(baseUrl = (this.getActiveEndpoint()?.baseUrl || this.getSettings().baseUrl)) {
    const raw = load(KEYS.MODEL_CAPS, {});
    if (isLegacyCapabilityMap(raw)) return raw;

    const caps = raw[normalizeBaseUrl(baseUrl)];
    return caps && typeof caps === 'object' && !Array.isArray(caps) ? caps : {};
  },

  saveModelCapabilities(baseUrlOrCaps, maybeCaps) {
    if (maybeCaps === undefined) {
      save(KEYS.MODEL_CAPS, baseUrlOrCaps);
      return;
    }

    const raw = load(KEYS.MODEL_CAPS, {});
    const nested = isLegacyCapabilityMap(raw) ? {} : raw;
    nested[normalizeBaseUrl(baseUrlOrCaps)] = maybeCaps;
    save(KEYS.MODEL_CAPS, nested);
  },

  getEndpoints() {
    const saved = load(KEYS.ENDPOINTS, null);
    if (Array.isArray(saved) && saved.length > 0) return saved;
    const settings = this.getSettings();
    return [{ id: 'default', name: 'Default', baseUrl: settings.baseUrl, apiKey: settings.apiKey }];
  },

  saveEndpoints(endpoints) {
    if (!Array.isArray(endpoints) || endpoints.length === 0) return;
    const normalized = endpoints.map(ep => ({
      ...ep,
      baseUrl: normalizeBaseUrl(ep.baseUrl),
    }));
    save(KEYS.ENDPOINTS, normalized);
  },

  getActiveEndpointId() {
    const saved = localStorage.getItem(KEYS.ACTIVE_ENDPOINT);
    if (saved) return saved;
    return this.getEndpoints()[0]?.id || 'default';
  },

  setActiveEndpointId(id) {
    localStorage.setItem(KEYS.ACTIVE_ENDPOINT, id);
  },

  getActiveEndpoint() {
    const id = this.getActiveEndpointId();
    const eps = this.getEndpoints();
    return eps.find(ep => ep.id === id) || eps[0] || null;
  },

  createConversation(model) {
    const conv = {
      id: uuid(),
      title: 'New Chat',
      model: model || '',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const convs = this.getConversations();
    convs.unshift(conv);
    this.saveConversations(convs);
    return conv;
  },

  addMessage(convId, message) {
    const convs = this.getConversations();
    const idx = convs.findIndex(c => c.id === convId);
    if (idx === -1) return;
    convs[idx].messages.push(message);
    convs[idx].updatedAt = new Date().toISOString();
    this.saveConversations(convs);
  },

  updateLastAssistantMessage(convId, content) {
    const convs = this.getConversations();
    const idx = convs.findIndex(c => c.id === convId);
    if (idx === -1) return;
    const msgs = convs[idx].messages;
    // Find last assistant message
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') {
        msgs[i].content = content;
        msgs[i].timestamp = new Date().toISOString();
        break;
      }
    }
    convs[idx].updatedAt = new Date().toISOString();
    this.saveConversations(convs);
  },

  updateMessage(convId, timestamp, updates) {
    const convs = this.getConversations();
    const idx = convs.findIndex(c => c.id === convId);
    if (idx === -1) return;
    const msgIdx = convs[idx].messages.findIndex(m => m.timestamp === timestamp);
    if (msgIdx === -1) return;
    convs[idx].messages[msgIdx] = { ...convs[idx].messages[msgIdx], ...updates };
    convs[idx].updatedAt = new Date().toISOString();
    this.saveConversations(convs);
  },

  clearMessages(convId) {
    const convs = this.getConversations();
    const idx = convs.findIndex(c => c.id === convId);
    if (idx === -1) return;
    convs[idx].messages = [];
    convs[idx].updatedAt = new Date().toISOString();
    this.saveConversations(convs);
  },

  deleteConversation(convId) {
    let convs = this.getConversations();
    convs = convs.filter(c => c.id !== convId);
    this.saveConversations(convs);
    if (this.getCurrentConversationId() === convId) {
      this.setCurrentConversationId(convs[0]?.id || null);
    }
  },

  updateConversationTitle(convId, title) {
    const convs = this.getConversations();
    const idx = convs.findIndex(c => c.id === convId);
    if (idx === -1) return;
    convs[idx].title = title;
    this.saveConversations(convs);
  },

  updateConversationModel(convId, model) {
    const convs = this.getConversations();
    const idx = convs.findIndex(c => c.id === convId);
    if (idx === -1) return;
    convs[idx].model = model;
    this.saveConversations(convs);
  },
};
