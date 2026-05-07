const DEV_PROXY_BASE = '/lw-proxy';
const NON_ASCII_TOKEN_ESTIMATE = 1;
const ASCII_CHARS_PER_TOKEN = 4;
const IMAGE_MESSAGE_TOKEN_ESTIMATE = 256;

/**
 * Builds the fetch URL and headers for a given API call.
 * In dev mode: routes through the Vite CORS proxy (/lw-proxy) using X-LW-Target.
 * In prod mode: calls the baseUrl directly (server must have CORS configured).
 *
 * Exported for unit testing with an explicit isDev parameter.
 */
export function buildRequestConfig(baseUrl, apiKey, isDev = import.meta.env.DEV, options = {}) {
  const cleanBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  const { contentType = 'application/json' } = options;
  const headers = {};
  if (contentType) headers['Content-Type'] = contentType;
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  if (isDev) {
    headers['X-LW-Target'] = cleanBase;
    return { urlBase: DEV_PROXY_BASE, headers };
  }
  return { urlBase: cleanBase, headers };
}

export async function fetchModels(baseUrl, apiKey) {
  const { urlBase, headers } = buildRequestConfig(baseUrl, apiKey);
  const url = `${urlBase}/v1/models`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch models (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  // OpenAI returns { data: [{ id, ... }] }
  const list = data.data || data.models || data;
  return Array.isArray(list) ? list.map(m => (typeof m === 'string' ? m : m.id)).filter(Boolean).sort() : [];
}

function extractAudioText(payload) {
  if (typeof payload === 'string') return payload.trim();
  if (typeof payload?.text === 'string') return payload.text.trim();
  if (typeof payload?.transcript === 'string') return payload.transcript.trim();
  if (typeof payload?.output_text === 'string') return payload.output_text.trim();
  if (Array.isArray(payload?.segments)) {
    return payload.segments
      .map((segment) => String(segment?.text || '').trim())
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  return '';
}

async function submitAudioTextRequest(baseUrl, apiKey, model, file, endpoint, options = {}) {
  const { prompt = '', language = '' } = options;
  const { urlBase, headers } = buildRequestConfig(baseUrl, apiKey, import.meta.env.DEV, { contentType: null });
  const url = `${urlBase}${endpoint}`;
  const body = new FormData();

  body.append('file', file, file?.name || 'audio.wav');
  if (model) body.append('model', model);
  if (prompt) body.append('prompt', prompt);
  if (language) body.append('language', language);
  body.append('response_format', 'json');

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let errMsg = `API error (${res.status})`;
    try {
      const json = JSON.parse(text);
      errMsg = json.error?.message || errMsg;
    } catch {
      if (text) errMsg += ': ' + text.slice(0, 200);
    }
    throw new Error(errMsg);
  }

  const payload = await res.json().catch(async () => {
    const text = await res.text().catch(() => '');
    return { text };
  });
  const text = extractAudioText(payload);
  if (!text) throw new Error('Audio API returned an empty text result');
  return text;
}

export async function transcribeAudio(baseUrl, apiKey, model, file, options = {}) {
  return submitAudioTextRequest(baseUrl, apiKey, model, file, '/v1/audio/transcriptions', options);
}

export function estimateTextTokens(text) {
  const value = String(text || '');
  let asciiChars = 0;
  let nonAsciiTokens = 0;

  for (const char of value) {
    if (/\s/.test(char)) continue;
    if (char.charCodeAt(0) <= 0x7f) {
      asciiChars += 1;
    } else {
      nonAsciiTokens += NON_ASCII_TOKEN_ESTIMATE;
    }
  }

  return nonAsciiTokens + Math.ceil(asciiChars / ASCII_CHARS_PER_TOKEN);
}

function estimateContentTokens(content) {
  if (typeof content === 'string') return estimateTextTokens(content);
  if (!Array.isArray(content)) return 0;

  return content.reduce((total, part) => {
    if (part?.type === 'text') return total + estimateTextTokens(part.text);
    if (part?.type === 'image_url') return total + IMAGE_MESSAGE_TOKEN_ESTIMATE;
    if (part?.type === 'video_url') return total + IMAGE_MESSAGE_TOKEN_ESTIMATE * 8; // rough: ~8 keyframes
    return total;
  }, 0);
}

export function estimateMessageTokens(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;

  return messages.reduce((total, message) => {
    return total + 4 + estimateContentTokens(message.content);
  }, 2);
}

export function formatCompactTokenCount(tokens) {
  const safe = Math.max(0, Math.round(Number(tokens) || 0));

  if (safe < 1000) return String(safe);
  if (safe < 100000) return `${(safe / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(safe / 1000)}k`;
}

export async function* streamCompletion(baseUrl, apiKey, model, messages, options = {}) {
  const { onUsage } = options;
  const { urlBase, headers } = buildRequestConfig(baseUrl, apiKey);
  const url = `${urlBase}/v1/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let errMsg = `API error (${res.status})`;
    try {
      const json = JSON.parse(text);
      errMsg = json.error?.message || errMsg;
    } catch {
      if (text) errMsg += ': ' + text.slice(0, 200);
    }
    throw new Error(errMsg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!trimmed.startsWith('data: ')) continue;

      const data = trimmed.slice(6);
      if (data === '[DONE]') return;

      try {
        const json = JSON.parse(data);
        if (json.usage?.total_tokens != null) onUsage?.(json.usage);
        const delta = json.choices?.[0]?.delta;
        if (delta?.content) yield delta.content;
      } catch {
        // ignore malformed SSE lines
      }
    }
  }

  // flush any remaining buffer
  if (buffer.trim().startsWith('data: ')) {
    const data = buffer.trim().slice(6);
    if (data && data !== '[DONE]') {
      try {
        const json = JSON.parse(data);
        if (json.usage?.total_tokens != null) onUsage?.(json.usage);
        const delta = json.choices?.[0]?.delta;
        if (delta?.content) yield delta.content;
      } catch { /* ignore */ }
    }
  }
}

export function formatMessagesForApi(messages) {
  // Find the index of the last user message so we can preserve its media dataUrls.
  // Historical video messages are stripped (huge dataUrls, already processed by the model).
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIdx = i; break; }
  }

  return messages.map((msg, i) => {
    if (msg.role === 'assistant') return { role: 'assistant', content: msg.content };

    // For the most recent user message keep content verbatim (includes any media dataUrl).
    if (i === lastUserIdx || !Array.isArray(msg.content)) {
      return { role: 'user', content: msg.content };
    }

    // For historical user messages: replace video_url parts with a text note so the
    // API payload stays small and uses only standard content types.
    const content = msg.content.map(part => {
      if (part?.type === 'video_url') return { type: 'text', text: '[Video attachment]' };
      return part;
    });
    return { role: 'user', content };
  });
}
