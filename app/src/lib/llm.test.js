import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseRecipe } from './llm.js';

const endpoint = { url: 'https://proxy/groq', headers: { Authorization: 'Bearer t' } };
const card = (o = {}) => ({
  isRecipe: true, title: 'Tomato Soup', summary: null, servings: 4, prepMinutes: 10, cookMinutes: 30,
  ingredients: [{ group: null, amount: 125, unit: 'g', item: 'flour', note: '1 cup' }],
  steps: ['Cook the tomatoes.', 'Blend.'], tags: ['Soup', 'soup', 'vegetarian'], notes: null, ...o,
});
const answer = (content, finish = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(content) } }] }), { status: 200 });
const error = (status, err) => new Response(JSON.stringify({ error: err }), { status });

let replies, requests;
beforeEach(() => {
  requests = [];
  globalThis.fetch = vi.fn(async (url, init) => { requests.push(JSON.parse(init.body)); return replies.shift(); });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('parseRecipe', () => {
  it('a typed title wins over the one in the text, and is passed as context', async () => {
    replies = [answer(card())];
    const { recipe, needsTitle } = await parseRecipe(endpoint, { title: " Nan's soup ", text: 'soup text' });
    expect(recipe.title).toBe("Nan's soup");
    expect(needsTitle).toBe(false);
    expect(requests[0].messages[1].content).toBe("Title given by the user: Nan's soup\n\nsoup text");
  });

  it('no typed title: the title from the text is used', async () => {
    replies = [answer(card())];
    const { recipe, needsTitle } = await parseRecipe(endpoint, { title: '', text: 'soup text' });
    expect(recipe.title).toBe('Tomato Soup');
    expect(needsTitle).toBe(false);
    expect(requests[0].messages[1].content).toBe('soup text');
  });

  it('no title anywhere: needsTitle', async () => {
    replies = [answer(card({ title: null }))];
    const { recipe, needsTitle } = await parseRecipe(endpoint, { title: '', text: 't' });
    expect(recipe.title).toBe('');
    expect(needsTitle).toBe(true);
  });

  it('maps the answer onto a card', async () => {
    replies = [answer(card({ ingredients: [{ group: 'Sauce', amount: 1, unit: 'cup', item: 'milk', note: null }] }))];
    const { recipe } = await parseRecipe(endpoint, { title: '', text: 'raw text' });
    expect(recipe).toMatchObject({
      servings: 4, prepMinutes: 10, cookMinutes: 30, stepsOrigin: 'source', sourceKind: 'text', sourceText: 'raw text',
      steps: [{ text: 'Cook the tomatoes.' }, { text: 'Blend.' }], tags: ['soup', 'vegetarian'],
      ingredients: [{ group: 'Sauce', amount: 1, unit: null, item: 'milk', note: '1 cup' }],
    });
  });

  it('text that is not a recipe is refused', async () => {
    replies = [answer(card({ isRecipe: false }))];
    await expect(parseRecipe(endpoint, { title: '', text: 'buy milk' })).rejects.toMatchObject({
      code: 'NOT_RECIPE', message: "That doesn't look like a recipe. Paste the ingredients and the method." });
  });

  it('asks with the app model, medium reasoning and a strict schema', async () => {
    replies = [answer(card())];
    await parseRecipe(endpoint, { title: '', text: 't' });
    expect(requests[0]).toMatchObject({ model: 'openai/gpt-oss-20b', reasoning_effort: 'medium', max_completion_tokens: 4000, temperature: 0 });
    expect(requests[0].response_format.json_schema.strict).toBe(true);
    expect(requests[0].messages[0].content).toContain('1 cup');
  });

  it('retries once with a little sampling noise when the JSON fails validation', async () => {
    replies = [error(400, { code: 'json_validate_failed', message: 'x' }), answer(card())];
    await parseRecipe(endpoint, { title: '', text: 't' });
    expect(requests.map((r) => r.temperature)).toEqual([0, 0.3]);
  });

  it('the daily limit has its own message', async () => {
    replies = [error(429, { code: 'daily_limit', message: 'All 50 assistant requests for today are used.' })];
    await expect(parseRecipe(endpoint, { title: '', text: 't' })).rejects.toMatchObject({
      code: 'DAILY_LIMIT', message: 'All 50 assistant requests for today are used.' });
  });

  it('an answer cut off at the token cap says the recipe is too long', async () => {
    replies = [answer('{"isRecipe": tr', 'length')];
    await expect(parseRecipe(endpoint, { title: '', text: 't' })).rejects.toMatchObject({ code: 'TOO_LONG' });
  });

  it('signed out: no endpoint', async () => {
    await expect(parseRecipe(null, { title: '', text: 't' })).rejects.toMatchObject({ code: 'NO_KEY', message: 'Sign in to use the assistant.' });
  });
});
