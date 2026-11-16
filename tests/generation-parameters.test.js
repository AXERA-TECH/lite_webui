import { describe, it, expect } from 'vitest';
import {
  validateGenerationParameters, sanitizeGenerationParameters,
  buildGenerationRequestParameters, parseStopSequences,
} from '../src/generation-parameters.js';

describe('generation parameter validation and serialization', () => {
  it('retains explicit zero and false and maps only known chat fields', () => {
    expect(buildGenerationRequestParameters({
      temperature: 0, topP: 0, maxTokens: 1, seed: 0, topK: 0, minP: 0,
      repetitionPenalty: 1.1, presencePenalty: -2, frequencyPenalty: 2,
      stop: [' END ', '\n'], enableThinking: false,
      model: 'override', messages: ['override'], stream: false,
      chat_template_kwargs: { arbitrary: true }, unknown: 123,
    })).toEqual({
      temperature: 0, top_p: 0, max_tokens: 1, seed: 0, top_k: 0, min_p: 0,
      repetition_penalty: 1.1, presence_penalty: -2, frequency_penalty: 2,
      stop: [' END ', '\n'], chat_template_kwargs: { enable_thinking: false },
    });
    expect(buildGenerationRequestParameters({ enableThinking: true })).toEqual({ chat_template_kwargs: { enable_thinking: true } });
  });

  it('omits empty values and rejects invalid types, ranges and unsafe integers', () => {
    expect(sanitizeGenerationParameters({ temperature: '', topP: null, stop: [], enableThinking: '' })).toEqual({});
    const raw = { temperature: Infinity, topP: -0.1, maxTokens: 1.5, seed: Number.MAX_SAFE_INTEGER + 1,
      topK: -2, minP: 2, repetitionPenalty: 0, presencePenalty: -3, frequencyPenalty: true,
      stop: [''], enableThinking: 'false' };
    const { values, errors } = validateGenerationParameters(raw);
    expect(values).toEqual({});
    expect(Object.keys(errors).sort()).toEqual(Object.keys(raw).sort());
  });

  it('parses stop lines without changing significant surrounding whitespace', () => {
    expect(parseStopSequences('  END  \r\n\r\n   \r\nSTOP')).toEqual(['  END  ', 'STOP']);
  });
});
