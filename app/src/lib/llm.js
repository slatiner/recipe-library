// The LLM calls behind "Make the card". This is the only place prompts are
// built. Calls go through the Groq proxy (supabase/functions/groq), which holds
// the key server side.
import { UNITS, emptyRecipe, normalizeIngredient } from './recipes.js';

const GROQ_MODEL = 'openai/gpt-oss-20b';
// Writing a method from scratch (Suggest a method) needs the larger model; it
// has the same free-tier limits on Groq (ROADMAP.md, Decisions).
const LARGE_MODEL = 'openai/gpt-oss-120b';
// Same cap as the proxy (supabase/functions/groq/body.js); a long recipe plus
// the reasoning needs more than the 1,500 Content_Project uses.
const MAX_TOKENS = 4000;

const nullable = (type) => ({ type: [type, 'null'] });

const RECIPE_SCHEMA = {
  type: 'object',
  properties: {
    isRecipe: { type: 'boolean' },
    title: nullable('string'),
    summary: nullable('string'),
    servings: nullable('integer'),
    prepMinutes: nullable('integer'),
    cookMinutes: nullable('integer'),
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          group: nullable('string'),
          amount: nullable('number'),
          unit: { type: ['string', 'null'], enum: [...UNITS, null] },
          item: { type: 'string' },
          note: nullable('string'),
        },
        required: ['group', 'amount', 'unit', 'item', 'note'],
        additionalProperties: false,
      },
    },
    steps: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
    notes: nullable('string'),
  },
  required: ['isRecipe', 'title', 'summary', 'servings', 'prepMinutes', 'cookMinutes', 'ingredients', 'steps', 'tags', 'notes'],
  additionalProperties: false,
};

function buildRecipePrompt() {
  return `You turn recipe text the user pasted (from a website, a social media post, a message or their own notes) into one recipe card in metric units. Reply with JSON only.

Rules:
- Always write the card in English, whatever the language of the text: translate the title, summary, ingredients (names, notes and section headings), steps, tags and notes. Keep a dish's own name when English cooks use it too (gnocchi, pad thai, shakshuka). A recipe in another language is still a recipe.
- isRecipe: false if the text is not a recipe (no dish with ingredients or a method); then fill the other fields with null or empty arrays.
- title: the dish's name, only if the text clearly names it, with normal capitalization. Otherwise null. If the user gave a title, use it as context only.
- summary: one or two lines describing the dish, taken from the text. null if there is none.
- servings, prepMinutes, cookMinutes: integers, only when the text states them (convert hours to minutes). Otherwise null.
- ingredients: every ingredient in the order given, as { group, amount, unit, item, note }.
  - unit is one of ${UNITS.map((u) => `"${u}"`).join(', ')} or null. Weights in g or kg; liquids in ml or l; teaspoons and tablespoons stay tsp and tbsp; counted things use "pc" (2 eggs -> amount 2, unit "pc").
  - Convert imperial and US measures to metric: ounces and pounds to g, fluid ounces, pints and quarts to ml or l. Dry ingredients measured by volume (cups, US ounces by volume) become grams using typical densities (1 cup flour = 125 g, sugar = 200 g, butter = 225 g, rice = 185 g), and the original measure goes in note, e.g. "1 cup". Liquids measured in cups become ml (1 cup = 240 ml).
  - amount is a number: fractions become decimals (1/2 -> 0.5, 1 1/2 -> 1.5). For "to taste", "a pinch" or "a handful", amount and unit are null and the words go in note.
  - item is the ingredient alone ("plain flour", "red onion"); preparation such as "finely chopped" goes in note.
  - group is the section heading from the text ("For the sauce" -> "Sauce"), or null.
- steps: the method in order, one step per instruction or small group of instructions, without numbering. Convert Fahrenheit to Celsius (350°F -> 180°C) and inches to cm inside the text.
- Never invent ingredients or steps. If the text has no method, steps is an empty array; if it has no ingredient list, ingredients is an empty array.
- tags: 2 to 5 lower-case words for the cuisine, course, main ingredient or diet (e.g. "italian", "dessert", "chicken", "vegetarian").
- notes: tips, variations or storage advice from the text. null if there are none.`;
}

// A task is { name, schema, prompt(), model? }.
export const RECIPE_TASK = { name: 'recipe_card', schema: RECIPE_SCHEMA, prompt: buildRecipePrompt };

const STEPS_SCHEMA = {
  type: 'object',
  properties: { steps: { type: 'array', items: { type: 'string' } } },
  required: ['steps'],
  additionalProperties: false,
};

const STEP_RULES = `- Always write the steps in English, translating them if the text is in another language.
- One step per instruction or small group of instructions, in order, without numbering.
- Metric only: convert Fahrenheit to Celsius (350°F -> 180°C), inches to cm, and imperial amounts mentioned in the text to metric.`;

// The method of a recipe from text the user pasted or a page they linked.
export const STEPS_TASK = {
  name: 'recipe_steps',
  schema: STEPS_SCHEMA,
  prompt: () => `You extract the method (the cooking steps) of one recipe from text: steps the user pasted, or the text of a recipe web page. Reply with JSON only.

Rules:
- steps: only the method, never the ingredient list, stories, adverts or comments.
${STEP_RULES}
- Never invent steps. If the text has no method, steps is an empty array.`,
};

// A plausible method for a card that has none (the creator kept theirs off the post).
export const METHOD_TASK = {
  name: 'suggested_method',
  schema: STEPS_SCHEMA,
  model: LARGE_MODEL,
  prompt: () => `You write a home-cooking method for a recipe whose creator didn't publish the steps. You get its title, ingredients and notes. Reply with JSON only.

Rules:
- steps: a clear method a home cook can follow, using every ingredient listed and nothing else except water, salt and pepper.
${STEP_RULES}
- Give oven temperatures in °C and times in minutes, typical for this kind of dish.
- Follow anything the notes say about the method.`,
};

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// endpoint is { url, headers } of the Groq proxy.
async function groqRequest(endpoint, text, temperature, task) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw fail('NETWORK', "You're offline. Check your connection and try again.");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    return await fetch(endpoint.url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...endpoint.headers },
      body: JSON.stringify({
        model: task.model || GROQ_MODEL,
        messages: [{ role: 'system', content: task.prompt() }, { role: 'user', content: text }],
        temperature,
        reasoning_effort: 'medium',
        max_completion_tokens: MAX_TOKENS,
        response_format: { type: 'json_schema', json_schema: { name: task.name, strict: true, schema: task.schema } },
      }),
    });
  } catch (e) {
    throw fail('NETWORK', e && e.name === 'AbortError' ? 'The assistant took too long to answer. Try again.' : "Couldn't reach the assistant. Check your connection.");
  } finally {
    clearTimeout(timer);
  }
}

// endpoint: the proxy, or null when signed out (throws code NO_KEY).
export async function llmJson(endpoint, text, task) {
  if (!endpoint) throw fail('NO_KEY', 'Sign in to use the assistant.');
  let r = await groqRequest(endpoint, text, 0, task);
  if (r.status === 400) {
    // The small model occasionally returns an empty answer that fails strict-JSON validation; one retry with a little sampling noise clears it.
    const body = await r.clone().json().catch(() => null);
    if (body && body.error && body.error.code === 'json_validate_failed') r = await groqRequest(endpoint, text, 0.3, task);
  }
  if (!r.ok) {
    const raw = await r.clone().text().catch(() => '');
    let body = null;
    try { body = JSON.parse(raw); } catch (e) { /* plain-text error page */ }
    const code = body && body.error && body.error.code;
    // The server's own reason (Groq's, or the gateway's), so a 500 can be told apart from another.
    const reason = String((body && ((body.error && body.error.message) || body.message || body.msg)) || raw || '').trim().slice(0, 200);
    if (r.status === 429 && code === 'daily_limit') throw fail('DAILY_LIMIT', body.error.message);
    throw fail(r.status,
      r.status === 401 ? 'Your sign-in has expired. Reload the page and sign in again.' :
      r.status === 403 ? 'Redeem an invite code to use the assistant.' :
      r.status === 429 ? 'The assistant is busy (free tier limit). Wait a minute and try again.' :
      r.status === 502 && code === 'limit_check_failed' ? body.error.message :
      r.status === 502 ? "The assistant's server key was rejected. Check GROQ_API_KEY in Supabase." :
      r.status >= 500 ? `The assistant is having trouble right now (HTTP ${r.status}${reason ? `: ${reason}` : ''}). Try again shortly.` :
      `The assistant returned an error (HTTP ${r.status}).`);
  }
  let choice;
  try {
    choice = (await r.json()).choices[0];
  } catch (e) {
    throw fail('PARSE', "The assistant's answer wasn't in the expected format. Try again.");
  }
  if (choice.finish_reason === 'length') {
    throw fail('TOO_LONG', 'That recipe is too long to read in one go. Paste a shorter part.');
  }
  try {
    return JSON.parse(choice.message.content);
  } catch (e) {
    throw fail('PARSE', "The assistant's answer wasn't in the expected format. Try again.");
  }
}

const int = (v) => (Number.isInteger(v) && v > 0 ? v : null);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// Pasted text (and an optional title) to an unsaved card. Title rule: a typed
// title is kept as-is; otherwise the one the text clearly names; otherwise
// empty, and needsTitle asks the user for one.
export async function parseRecipe(endpoint, { title = '', text }) {
  const typed = title.trim();
  const r = await llmJson(endpoint, typed ? `Title given by the user: ${typed}\n\n${text}` : text, RECIPE_TASK);
  if (!r.isRecipe) throw fail('NOT_RECIPE', "That doesn't look like a recipe. Paste the ingredients and the method.");
  const recipe = {
    ...emptyRecipe(),
    title: typed || str(r.title) || '',
    summary: str(r.summary),
    servings: int(r.servings),
    prepMinutes: int(r.prepMinutes),
    cookMinutes: int(r.cookMinutes),
    ingredients: (r.ingredients || []).map(normalizeIngredient).filter((i) => i.item),
    steps: stepList(r),
    tags: [...new Set((r.tags || []).map((t) => str(t)).filter(Boolean).map((t) => t.toLowerCase()))],
    notes: str(r.notes),
    sourceText: text,
  };
  return { recipe, needsTitle: !recipe.title };
}

const stepList = (r) => (r.steps || []).map(str).filter(Boolean).map((t) => ({ text: t }));

// Steps from pasted text or a fetched page: [{ text }]. Throws code NO_STEPS
// when there are none.
export async function parseSteps(endpoint, text) {
  const steps = stepList(await llmJson(endpoint, text, STEPS_TASK));
  if (!steps.length) throw fail('NO_STEPS', "Couldn't find any steps in that. Paste the method itself.");
  return steps;
}

// A suggested method for a card without one: [{ text }]. Only on request; the
// caller marks it ai_suggested.
export async function suggestMethod(endpoint, recipe) {
  const lines = [
    `Title: ${recipe.title || 'untitled'}`,
    recipe.servings && `Serves: ${recipe.servings}`,
    'Ingredients:',
    ...recipe.ingredients.map((i) => `- ${[i.amount, i.unit && i.unit !== 'pc' ? i.unit : null, i.item, i.note && `(${i.note})`].filter((x) => x !== null && x !== undefined && x !== '').join(' ')}${i.group ? ` [${i.group}]` : ''}`),
    recipe.notes && `Notes: ${recipe.notes}`,
  ].filter(Boolean);
  const steps = stepList(await llmJson(endpoint, lines.join('\n'), METHOD_TASK));
  if (!steps.length) throw fail('NO_STEPS', "The assistant couldn't suggest a method. Try again.");
  return steps;
}
