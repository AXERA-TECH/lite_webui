// Optional chat parameters. Missing values always preserve backend defaults.
export const GENERATION_PARAMETER_FIELDS = [
  { key: 'temperature', label: 'Temperature', min: 0, max: 2, step: 'any' },
  { key: 'topP', label: 'Top P', min: 0, max: 1, step: 'any' },
  { key: 'maxTokens', label: 'Max Output Tokens', min: 1, integer: true, step: '1' },
  { key: 'seed', label: 'Seed', integer: true, step: '1' },
  { key: 'topK', label: 'Top K', min: -1, integer: true, step: '1' },
  { key: 'minP', label: 'Min P', min: 0, max: 1, step: 'any' },
  { key: 'repetitionPenalty', label: 'Repetition Penalty', min: 0, exclusiveMin: true, step: 'any' },
  { key: 'presencePenalty', label: 'Presence Penalty', min: -2, max: 2, step: 'any' },
  { key: 'frequencyPenalty', label: 'Frequency Penalty', min: -2, max: 2, step: 'any' },
  { key: 'stop', label: 'Stop sequences', type: 'stop' },
  { key: 'enableThinking', label: 'Enable thinking', type: 'boolean' },
];

export function parseStopSequences(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim());
}

export function validateGenerationParameters(raw = {}) {
  const values = {};
  const errors = {};
  for (const field of GENERATION_PARAMETER_FIELDS) {
    const value = raw?.[field.key];
    if (value == null || (typeof value === 'string' && !value.trim())) continue;
    if (field.type === 'boolean') {
      if (typeof value === 'boolean') values[field.key] = value;
      else errors[field.key] = 'Choose server default, enabled, or disabled.';
      continue;
    }
    if (field.type === 'stop') {
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.length)) {
        errors.stop = 'Stop sequences must be an array of nonempty strings.';
      } else if (value.length) values.stop = [...value];
      continue;
    }
    const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(number) || (field.integer && !Number.isSafeInteger(number)) ||
        (field.min !== undefined && (field.exclusiveMin ? number <= field.min : number < field.min)) ||
        (field.max !== undefined && number > field.max)) {
      const range = field.min === undefined ? ''
        : field.max !== undefined ? `from ${field.min} to ${field.max}`
        : `${field.exclusiveMin ? 'greater than' : 'at least'} ${field.min}`;
      errors[field.key] = `Enter ${field.integer ? 'a safe integer' : 'a finite number'}${range ? ' ' + range : ''}.`;
    } else values[field.key] = number;
  }
  return { values, errors };
}

export function sanitizeGenerationParameters(raw) {
  return validateGenerationParameters(raw).values;
}

export function buildGenerationRequestParameters(raw) {
  const values = sanitizeGenerationParameters(raw);
  const fields = {
    temperature: 'temperature', topP: 'top_p', maxTokens: 'max_tokens', seed: 'seed',
    topK: 'top_k', minP: 'min_p', repetitionPenalty: 'repetition_penalty',
    presencePenalty: 'presence_penalty', frequencyPenalty: 'frequency_penalty', stop: 'stop',
  };
  const request = {};
  for (const [key, wireKey] of Object.entries(fields)) {
    if (Object.hasOwn(values, key)) request[wireKey] = values[key];
  }
  if (Object.hasOwn(values, 'enableThinking')) {
    request.chat_template_kwargs = { enable_thinking: values.enableThinking };
  }
  return request;
}
