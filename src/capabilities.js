export const DEFAULT_CAPABILITIES = {
  'gpt-4o':                { text: true,  image: true,  audio: false },
  'gpt-4o-mini':           { text: true,  image: true,  audio: false },
  'gpt-4-turbo':           { text: true,  image: true,  audio: false },
  'gpt-4-vision-preview':  { text: true,  image: true,  audio: false },
  'gpt-4':                 { text: true,  image: false, audio: false },
  'gpt-3.5-turbo':         { text: true,  image: false, audio: false },
  'deepseek-v3':           { text: true,  image: false, audio: false },
  'deepseek-chat':         { text: true,  image: false, audio: false },
  'qwen2.5-7b-instruct':   { text: true,  image: false, audio: false },
  'claude-3-5-sonnet':     { text: true,  image: true,  audio: false },
  'claude-3-opus':         { text: true,  image: true,  audio: false },
};

const UNKNOWN_DEFAULT = { text: true, image: false, audio: false };

export function getCapabilities(modelId, userOverrides = {}) {
  const base = DEFAULT_CAPABILITIES[modelId] || UNKNOWN_DEFAULT;
  const override = userOverrides[modelId];
  if (!override) return { ...base };
  return { ...base, ...override };
}

export function supportsImage(modelId, userOverrides = {}) {
  return getCapabilities(modelId, userOverrides).image;
}

// Video is treated as part of the Vision capability — same toggle, same gate.
export function supportsVideo(modelId, userOverrides = {}) {
  return supportsImage(modelId, userOverrides);
}

export function supportsAudio(modelId, userOverrides = {}) {
  return getCapabilities(modelId, userOverrides).audio;
}
