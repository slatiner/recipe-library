import { describe, it, expect } from 'vitest';
import { groqBody, MAX_TOKENS } from './body.js';

const m = { role: 'user', content: 'hi' };
const rf = { type: 'json_schema', json_schema: { name: 'x', strict: true, schema: {} } };

describe('groqBody', () => {
  it('keeps only the allowed fields and caps the tokens', () => {
    expect(groqBody({
      model: 'openai/gpt-oss-20b', messages: [m], temperature: 0, response_format: rf, reasoning_effort: 'medium',
      max_completion_tokens: 9999, max_tokens: 9999, n: 5, tools: [{ type: 'function' }], stream: true,
    })).toEqual({
      model: 'openai/gpt-oss-20b', messages: [m], temperature: 0, response_format: rf, reasoning_effort: 'medium',
      max_completion_tokens: 4000,
    });
  });

  it('defaults the token cap, and keeps a smaller one', () => {
    expect(MAX_TOKENS).toBe(4000);
    expect(groqBody({ model: 'openai/gpt-oss-20b', messages: [m] }).max_completion_tokens).toBe(4000);
    expect(groqBody({ model: 'openai/gpt-oss-20b', messages: [m], max_completion_tokens: 800 }).max_completion_tokens).toBe(800);
  });

  it('refuses other models', () => {
    expect(groqBody({ model: 'llama-3.3-70b', messages: [] })).toBeNull();
  });

  it('leaves out fields the caller did not send', () => {
    expect(Object.keys(groqBody({ model: 'openai/gpt-oss-120b', messages: [m] })).sort())
      .toEqual(['max_completion_tokens', 'messages', 'model']);
  });
});
