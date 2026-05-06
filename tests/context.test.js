import { describe, expect, it } from 'vitest';
import { formatCompactTokenCount } from '../src/api.js';
import {
  DEFAULT_CONTEXT_LIMIT_TOKENS,
  DEFAULT_CONTEXT_RESET_THRESHOLD_PERCENT,
  resolveContextConfig,
  estimateThreadTokens,
} from '../src/context.js';

describe('context helpers – resolveContextConfig', () => {
  it('falls back to the default context window when nothing is configured', () => {
    const config = resolveContextConfig({}, '');
    expect(config.maxTokens).toBe(DEFAULT_CONTEXT_LIMIT_TOKENS);
    expect(config.resetPercent).toBe(DEFAULT_CONTEXT_RESET_THRESHOLD_PERCENT);
    expect(config.source).toBe('default');
  });

  it('prefers a manually configured context window', () => {
    const config = resolveContextConfig({ contextLimitTokens: 65536 }, 'qwen-32k');
    expect(config.maxTokens).toBe(65536);
    expect(config.source).toBe('manual');
  });

  it('does not infer context length from model ids anymore', () => {
    const config = resolveContextConfig({ contextLimitTokens: null }, 'qwen-128k');
    expect(config.maxTokens).toBe(DEFAULT_CONTEXT_LIMIT_TOKENS);
    expect(config.source).toBe('default');
  });

  it('respects thresholds below the default warning band', () => {
    const config = resolveContextConfig({
      contextLimitTokens: 4096,
      contextResetThresholdPercent: 70,
    }, '');

    expect(config.resetTokens).toBe(Math.floor(4096 * 0.7));
    expect(config.warnTokens).toBe(config.resetTokens);
  });

  it('keeps resetTokens below the hard window when threshold percent is too aggressive', () => {
    const config = resolveContextConfig({
      contextLimitTokens: 32768,
      contextResetThresholdPercent: 95,
    }, '');

    expect(config.warnTokens).toBe(Math.floor(32768 * 0.8));
    expect(config.resetTokens).toBe(30720);
  });
});

describe('context helpers – estimateThreadTokens', () => {
  it('includes pending messages in the projected estimate', () => {
    const messages = [{ role: 'user', content: 'hello world' }];
    const pending = { role: 'assistant', content: 'reply' };

    expect(estimateThreadTokens(messages, pending)).toBeGreaterThan(estimateThreadTokens(messages));
  });
});

describe('api helpers – formatCompactTokenCount', () => {
  it('keeps 4k-class windows readable without rounding them up', () => {
    expect(formatCompactTokenCount(4096)).toBe('4.1k');
  });
});
