// What the Groq proxy forwards. Plain JavaScript so the Deno function and the
// Vitest tests load the same file.

export const MODELS = new Set(['openai/gpt-oss-20b', 'openai/gpt-oss-120b']);
export const MAX_TOKENS = 4000;
const PASSED = ['model', 'messages', 'temperature', 'response_format', 'reasoning_effort'];

// The caller's body cut down to the fields the app uses, with the tokens
// capped, so the shared quota can't be spent on anything else (no n, tools or
// streaming). null when the model isn't one of the app's.
export function groqBody(input) {
  if (!input || !MODELS.has(String(input.model))) return null;
  const body = {};
  for (const k of PASSED) if (input[k] !== undefined) body[k] = input[k];
  body.max_completion_tokens = Math.min(Number(input.max_completion_tokens) || MAX_TOKENS, MAX_TOKENS);
  return body;
}
