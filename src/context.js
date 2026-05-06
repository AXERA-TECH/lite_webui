import { estimateMessageTokens } from './api.js';

export const DEFAULT_CONTEXT_LIMIT_TOKENS = 4096;
export const DEFAULT_CONTEXT_WARN_PERCENT = 80;
export const DEFAULT_CONTEXT_RESET_THRESHOLD_PERCENT = 85;
export const DEFAULT_CONTEXT_RESPONSE_RESERVE = 2048;
export const DEFAULT_CONTEXT_RESPONSE_RESERVE_RATIO = 0.2;

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function resolveContextConfig(settings = {}, modelId = '') {
  const configuredMaxTokens = toPositiveInteger(settings.contextLimitTokens);
  const maxTokens = configuredMaxTokens || DEFAULT_CONTEXT_LIMIT_TOKENS;

  const resetPercent = clamp(
    toPositiveInteger(settings.contextResetThresholdPercent) || DEFAULT_CONTEXT_RESET_THRESHOLD_PERCENT,
    50,
    95
  );

  const percentThreshold = Math.max(1, Math.floor(maxTokens * (resetPercent / 100)));
  const responseReserve = Math.max(128, Math.min(
    DEFAULT_CONTEXT_RESPONSE_RESERVE,
    Math.floor(maxTokens * DEFAULT_CONTEXT_RESPONSE_RESERVE_RATIO)
  ));
  const reserveThreshold = maxTokens > responseReserve
    ? maxTokens - responseReserve
    : maxTokens;
  const resetTokens = Math.max(1, Math.min(percentThreshold, reserveThreshold));
  const warnTokens = Math.min(
    Math.max(1, Math.floor(maxTokens * (DEFAULT_CONTEXT_WARN_PERCENT / 100))),
    resetTokens
  );

  return {
    maxTokens,
    warnTokens,
    resetTokens,
    resetPercent,
    source: configuredMaxTokens ? 'manual' : 'default',
  };
}

export function estimateThreadTokens(messages = [], pendingMessage = null) {
  const baseMessages = Array.isArray(messages) ? messages : [];
  const thread = pendingMessage ? [...baseMessages, pendingMessage] : baseMessages;
  return estimateMessageTokens(thread);
}
