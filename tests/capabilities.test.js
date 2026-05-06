import { describe, it, expect } from 'vitest';
import { DEFAULT_CAPABILITIES, getCapabilities, supportsImage, supportsAudio, supportsVideo } from '../src/capabilities.js';

describe('DEFAULT_CAPABILITIES', () => {
  it('gpt-4o supports image', () => {
    expect(DEFAULT_CAPABILITIES['gpt-4o'].image).toBe(true);
  });

  it('gpt-4o does not support audio', () => {
    expect(DEFAULT_CAPABILITIES['gpt-4o'].audio).toBe(false);
  });

  it('deepseek-v3 does not support image', () => {
    expect(DEFAULT_CAPABILITIES['deepseek-v3'].image).toBe(false);
  });
});

describe('getCapabilities', () => {
  it('returns default for known model with no overrides', () => {
    const caps = getCapabilities('gpt-4o', {});
    expect(caps.text).toBe(true);
    expect(caps.image).toBe(true);
  });

  it('unknown model defaults to text-only', () => {
    const caps = getCapabilities('totally-unknown-model', {});
    expect(caps.text).toBe(true);
    expect(caps.image).toBe(false);
    expect(caps.audio).toBe(false);
  });

  it('user override takes precedence over defaults', () => {
    const userCaps = { 'gpt-4': { text: true, image: true, audio: false } };
    const caps = getCapabilities('gpt-4', userCaps);
    expect(caps.image).toBe(true); // overridden from false → true
  });

  it('user override for unknown model is applied', () => {
    const userCaps = { 'my-local-model': { text: true, image: true, audio: false } };
    const caps = getCapabilities('my-local-model', userCaps);
    expect(caps.image).toBe(true);
  });

  it('partial override preserves unspecified defaults', () => {
    // Default for gpt-4o: image=true. Override only audio.
    const userCaps = { 'gpt-4o': { audio: true } };
    const caps = getCapabilities('gpt-4o', userCaps);
    expect(caps.image).toBe(true); // preserved from default
    expect(caps.audio).toBe(true); // from override
  });
});

describe('supportsImage', () => {
  it('returns true for vision model', () => {
    expect(supportsImage('gpt-4o', {})).toBe(true);
  });

  it('returns false for text-only model', () => {
    expect(supportsImage('gpt-3.5-turbo', {})).toBe(false);
  });

  it('returns false for unknown model', () => {
    expect(supportsImage('some-new-model', {})).toBe(false);
  });

  it('respects user override enabling image on text-only model', () => {
    const userCaps = { 'my-model': { text: true, image: true, audio: false } };
    expect(supportsImage('my-model', userCaps)).toBe(true);
  });
});

describe('supportsAudio', () => {
  it('returns false for gpt-4o (audio not in MVP)', () => {
    expect(supportsAudio('gpt-4o', {})).toBe(false);
  });

  it('respects user override enabling audio', () => {
    const userCaps = { 'gpt-4o': { text: true, image: true, audio: true } };
    expect(supportsAudio('gpt-4o', userCaps)).toBe(true);
  });
});

describe('supportsVideo', () => {
  it('returns true when Vision is enabled (same as supportsImage)', () => {
    expect(supportsVideo('gpt-4o', {})).toBe(true);
  });

  it('returns false when Vision is disabled', () => {
    expect(supportsVideo('gpt-3.5-turbo', {})).toBe(false);
    expect(supportsVideo('some-unknown-model', {})).toBe(false);
  });

  it('respects user override enabling vision (image=true implies video=true)', () => {
    const userCaps = { 'my-vl-model': { text: true, image: true, audio: false } };
    expect(supportsVideo('my-vl-model', userCaps)).toBe(true);
  });
});
