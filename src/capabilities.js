export const DEFAULT_CAPABILITIES = {
  'gpt-4o':                { text: true,  image: true,  audio: false, imageGen: false },
  'gpt-4o-mini':           { text: true,  image: true,  audio: false, imageGen: false },
  'gpt-4-turbo':           { text: true,  image: true,  audio: false, imageGen: false },
  'gpt-4-vision-preview':  { text: true,  image: true,  audio: false, imageGen: false },
  'gpt-4':                 { text: true,  image: false, audio: false, imageGen: false },
  'gpt-3.5-turbo':         { text: true,  image: false, audio: false, imageGen: false },
  'dall-e-3':              { text: false, image: false, audio: false, imageGen: true  },
  'dall-e-2':              { text: false, image: false, audio: false, imageGen: true  },
  'deepseek-v3':           { text: true,  image: false, audio: false, imageGen: false },
  'deepseek-chat':         { text: true,  image: false, audio: false, imageGen: false },
  'qwen2.5-7b-instruct':   { text: true,  image: false, audio: false, imageGen: false },
  'claude-3-5-sonnet':     { text: true,  image: true,  audio: false, imageGen: false },
  'claude-3-opus':         { text: true,  image: true,  audio: false, imageGen: false },
};

const UNKNOWN_DEFAULT = { text: true, image: false, audio: false, imageGen: false };

// Heuristic: detect image-generation models by id pattern when not in DEFAULT_CAPABILITIES.
function looksLikeImageGenModel(modelId) {
  const id = String(modelId || '').toLowerCase();
  return /dall[- ]?e|flux|stable[- ]?diffusion|sdxl|imagen|wanx|cogview|playground|midjourney|ideogram/.test(id);
}

export function getCapabilities(modelId, userOverrides = {}) {
  const base = DEFAULT_CAPABILITIES[modelId] || {
    ...UNKNOWN_DEFAULT,
    imageGen: looksLikeImageGenModel(modelId),
  };
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

export function supportsImageGen(modelId, userOverrides = {}) {
  return getCapabilities(modelId, userOverrides).imageGen;
}
