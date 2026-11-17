import { sanitizeGenerationParameters } from './generation-parameters.js';
import { DEFAULT_CONTEXT_LIMIT_TOKENS } from './context.js';

// LocalStorage keys
const KEYS = {
  MODEL_GENERATION: 'lw_model_generation_v1',
  SETTINGS: 'lw_settings',
  CONVERSATIONS: 'lw_conversations',
  CURRENT_CONV: 'lw_current_conv',
  MODEL_CAPS: 'lw_model_caps',
  AVAILABLE_MODELS: 'lw_available_models',
  MODEL_SELECTIONS: 'lw_model_selections',
  ENDPOINTS: 'lw_endpoints',
  ACTIVE_ENDPOINT: 'lw_active_endpoint',
  PROMPTS: 'lw_prompts',
};

const DEFAULT_SETTINGS = {
  apiKey: '',
  baseUrl: 'http://127.0.0.1:8000',
  theme: 'light',
  contextLimitTokens: DEFAULT_CONTEXT_LIMIT_TOKENS,
  contextResetThresholdPercent: 85,
  temperature: null,
  maxTokens: null,
  topP: null,
  systemPrompt: '',
  // Multimodal video: the browser samples N stills and sends them as images
  videoFrames: 8,
  videoFrameMaxSide: 448,
  documentMaxChars: 24000,
  // Stop streaming automatically when the model falls into a repetition loop
  autoStopRepetition: true,
  // VoxCPM2-style raw PCM streaming. Non-streaming WAV remains the fallback.
  streamTTS: true,
  // Optional read-only AX8860 aggregator, e.g. http://192.0.2.20:8888/api/all
  deviceMetricsUrl: '',
};

const DEFAULT_PROMPTS = [
  {
    id: 'builtin-code-review',
    name: 'Code review',
    content: 'Please review the following code. Focus on correctness, security, performance, maintainability, and edge cases. Give concrete patches or pseudocode for each issue.',
    builtin: true,
  },
  {
    id: 'builtin-explain',
    name: 'Explain simply',
    content: 'Explain the following concept step by step for a developer. Use analogies where useful, then finish with a short summary and three self-check questions.',
    builtin: true,
  },
  {
    id: 'builtin-refactor',
    name: 'Refactor plan',
    content: 'Refactor the following implementation. Preserve behavior, explain the design tradeoffs, and provide the complete refactored version plus tests you would add.',
    builtin: true,
  },
];

export function normalizeBaseUrl(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) return DEFAULT_SETTINGS.baseUrl;
  // OpenAI-compatible UIs are frequently given a copied Base URL ending in /v1.
  // LiteWebUI appends /v1/... itself, so normalize both styles to the server root.
  return raw
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '');
}

function normalizeDeviceMetricsUrl(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/+$/, '');
}

function isCapabilityRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return ['text', 'image', 'audio', 'imageGen', 'tts'].some((key) => key in value);
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
  const temperature = merged.temperature === '' || merged.temperature === null || merged.temperature === undefined
    ? null : Number(merged.temperature);
  const maxTokens = merged.maxTokens === '' || merged.maxTokens === null || merged.maxTokens === undefined
    ? null : Number(merged.maxTokens);
  const topP = merged.topP === '' || merged.topP === null || merged.topP === undefined
    ? null : Number(merged.topP);

  merged.baseUrl = normalizeBaseUrl(merged.baseUrl);
  merged.contextLimitTokens = Number.isFinite(contextLimitTokens) && contextLimitTokens >= 1024
    ? Math.round(contextLimitTokens)
    : DEFAULT_SETTINGS.contextLimitTokens;

  merged.contextResetThresholdPercent = Number.isFinite(contextResetThresholdPercent)
    ? Math.min(95, Math.max(50, Math.round(contextResetThresholdPercent)))
    : DEFAULT_SETTINGS.contextResetThresholdPercent;

  merged.temperature = Number.isFinite(temperature) && temperature >= 0 && temperature <= 2
    ? temperature : DEFAULT_SETTINGS.temperature;
  merged.maxTokens = Number.isFinite(maxTokens) && maxTokens > 0
    ? Math.round(maxTokens) : DEFAULT_SETTINGS.maxTokens;
  merged.topP = Number.isFinite(topP) && topP >= 0 && topP <= 1
    ? topP : DEFAULT_SETTINGS.topP;
  merged.systemPrompt = typeof merged.systemPrompt === 'string' ? merged.systemPrompt : '';

  const videoFrames = Number(merged.videoFrames);
  merged.videoFrames = Number.isFinite(videoFrames) && videoFrames >= 1
    ? Math.min(32, Math.round(videoFrames))
    : DEFAULT_SETTINGS.videoFrames;

  merged.autoStopRepetition = merged.autoStopRepetition !== false;
  merged.streamTTS = merged.streamTTS !== false;
  merged.deviceMetricsUrl = normalizeDeviceMetricsUrl(merged.deviceMetricsUrl);

  const videoFrameMaxSide = Number(merged.videoFrameMaxSide);
  merged.videoFrameMaxSide = Number.isFinite(videoFrameMaxSide) && videoFrameMaxSide >= 64
    ? Math.min(1024, Math.round(videoFrameMaxSide))
    : DEFAULT_SETTINGS.videoFrameMaxSide;

  const documentMaxChars = Number(merged.documentMaxChars);
  merged.documentMaxChars = Number.isFinite(documentMaxChars) && documentMaxChars >= 1000
    ? Math.min(200000, Math.round(documentMaxChars))
    : DEFAULT_SETTINGS.documentMaxChars;

  return merged;
}

function normalizePrompt(prompt = {}, index = 0) {
  const name = typeof prompt.name === 'string' && prompt.name.trim()
    ? prompt.name.trim().slice(0, 80)
    : `Prompt ${index + 1}`;
  const content = typeof prompt.content === 'string' ? prompt.content : '';
  return {
    id: typeof prompt.id === 'string' && prompt.id ? prompt.id : uuid(),
    name,
    content,
    builtin: prompt.builtin === true,
  };
}

function normalizePrompts(prompts) {
  if (!Array.isArray(prompts)) return [];
  const seen = new Set();
  return prompts
    .map((prompt, index) => normalizePrompt(prompt, index))
    .filter((prompt) => {
      if (!prompt.content.trim() || seen.has(prompt.id)) return false;
      seen.add(prompt.id);
      return true;
    });
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
  getModelGenerationConfig(baseUrl, modelId) {
    const profiles = load(KEYS.MODEL_GENERATION, {});
    const models = profiles?.[normalizeBaseUrl(baseUrl)];
    const profile = models && Object.hasOwn(models, modelId) ? models[modelId] : null;
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      return { enabled: false, parameters: {}, exists: false };
    }
    return { enabled: profile.enabled === true, parameters: sanitizeGenerationParameters(profile.parameters), exists: true };
  },

  saveModelGenerationConfig(baseUrl, modelId, config) {
    if (!modelId) return;
    const saved = load(KEYS.MODEL_GENERATION, {});
    const profiles = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    const url = normalizeBaseUrl(baseUrl);
    const models = profiles[url] && typeof profiles[url] === 'object' && !Array.isArray(profiles[url]) ? profiles[url] : {};
    const previous = this.getModelGenerationConfig(url, modelId);
    const parameters = config?.parameters === undefined ? previous.parameters : config.parameters;
    save(KEYS.MODEL_GENERATION, { ...profiles, [url]: { ...models, [modelId]: {
      enabled: config?.enabled === true,
      parameters: sanitizeGenerationParameters(parameters),
    } } });
  },

  getGenerationParameters(baseUrl, modelId) {
    const profile = this.getModelGenerationConfig(baseUrl, modelId);
    if (profile.enabled) return profile.parameters;
    const { temperature, topP, maxTokens } = this.getSettings();
    return sanitizeGenerationParameters({ temperature, topP, maxTokens });
  },

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

  getPrompts() {
    const saved = load(KEYS.PROMPTS, null);
    const custom = normalizePrompts(saved);
    // Built-ins are not persisted, so future releases can update them without
    // migrating every browser's localStorage.
    if (custom.length === 0) return [...DEFAULT_PROMPTS];
    const builtin = DEFAULT_PROMPTS.filter((prompt) => !custom.some((item) => item.id === prompt.id));
    return [...builtin, ...custom];
  },

  savePrompt({ id, name, content }) {
    const prompts = this.getPrompts();
    const normalized = normalizePrompt({
      id,
      name,
      content,
      builtin: prompts.find((prompt) => prompt.id === id)?.builtin === true,
    });
    if (!normalized.content.trim()) return null;

    const existing = prompts.find((prompt) => prompt.id === normalized.id);
    const next = existing
      ? prompts.map((prompt) => (prompt.id === normalized.id ? { ...prompt, ...normalized } : prompt))
      : [...prompts, normalized];
    save(KEYS.PROMPTS, next.filter((prompt) => !prompt.builtin));
    return normalized;
  },

  deletePrompt(id) {
    const prompts = this.getPrompts();
    const target = prompts.find((prompt) => prompt.id === id);
    if (!target || target.builtin) return false;
    save(KEYS.PROMPTS, prompts.filter((prompt) => prompt.id !== id));
    return true;
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

  removeLastMessage(convId) {
    const convs = this.getConversations();
    const idx = convs.findIndex(c => c.id === convId);
    if (idx === -1) return;
    convs[idx].messages.pop();
    convs[idx].updatedAt = new Date().toISOString();
    this.saveConversations(convs);
  },

  replaceMessages(convId, messages) {
    const convs = this.getConversations();
    const idx = convs.findIndex(c => c.id === convId);
    if (idx === -1 || !Array.isArray(messages)) return;
    convs[idx].messages = messages.filter(message => message && typeof message === 'object');
    convs[idx].updatedAt = new Date().toISOString();
    this.saveConversations(convs);
  },

  saveConversationBranch(convId, label, messages = []) {
    const convs = this.getConversations();
    const idx = convs.findIndex(c => c.id === convId);
    if (idx === -1 || !Array.isArray(messages)) return null;

    const branch = {
      id: uuid(),
      label: String(label || 'Conversation branch').slice(0, 100),
      createdAt: new Date().toISOString(),
      messages: messages.filter(message => message && typeof message === 'object'),
    };
    const existing = Array.isArray(convs[idx].branches) ? convs[idx].branches : [];
    // Keep the newest branches. Old chat data (including media URLs) can grow
    // quickly, and localStorage is the only persistent store in LiteWebUI.
    convs[idx].branches = [...existing, branch].slice(-12);
    convs[idx].updatedAt = new Date().toISOString();
    this.saveConversations(convs);
    return branch;
  },

  restoreConversationBranch(convId, branchId) {
    const convs = this.getConversations();
    const idx = convs.findIndex(c => c.id === convId);
    if (idx === -1) return null;

    const branches = Array.isArray(convs[idx].branches) ? convs[idx].branches : [];
    const branch = branches.find(item => item.id === branchId);
    if (!branch) return null;

    // Snapshot the active path before restoring. Otherwise switching branches
    // would silently discard any response generated after that branch was saved.
    if (convs[idx].messages.length > 0) {
      const snapshot = {
        id: uuid(),
        label: `Active path · ${new Date().toLocaleString()}`,
        createdAt: new Date().toISOString(),
        messages: convs[idx].messages,
      };
      convs[idx].branches = [...branches, snapshot].slice(-12);
    }

    convs[idx].messages = Array.isArray(branch.messages) ? branch.messages : [];
    convs[idx].updatedAt = new Date().toISOString();
    this.saveConversations(convs);
    return branch;
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
