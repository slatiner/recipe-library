# Phase 1: Recipe Card Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste a recipe (with an optional title), get an editable metric card, save it, and browse, search, star, edit and delete cards in the library. A privacy page goes up before anyone is invited.

**Architecture:** One `recipes` table with RLS (owner and member only). The storage adapter is the only code that touches it. `app/src/lib/llm.js` is the only code that builds prompts; it calls the hardened `groq` edge function. Views are switched by a small hash router (`#/` library, `#/recipe/<id>` card); no vue-router.

**Tech Stack:** Vue 3 + Vite, Vitest + @vue/test-utils (jsdom), Supabase (Postgres + pgTAP, Deno edge function), Groq `openai/gpt-oss-20b`.

**Spec:** `docs/superpowers/specs/2026-11-09-recipe-library-design.md` (Data model, Flows → Add from text, Error handling, Testing). Issues: #9 (Task 1), #7 (Tasks 2–6), #8 (Task 7).

## Global Constraints

- No new npm dependencies.
- All table access goes through `app/src/lib/storage/`; all prompts through `app/src/lib/llm.js`.
- Schema changes: one migration in `supabase/migrations/` with pgTAP tests in `supabase/tests/database/`.
- Units stored are exactly `g`, `kg`, `ml`, `l`, `tsp`, `tbsp`, `pc`, or null. Amount is a number or null.
- Owner decisions (2026-11-09): dry volume measures (cups) become **grams** (LLM estimate) and the original measure goes in the ingredient's `note` (e.g. `"1 cup"`); liquids go to ml. A card opens on its own route `#/recipe/<id>`.
- Title rule: a typed title is kept as-is; else the LLM's title if the text has a clear one; else empty, and the preview asks for one (saving needs a title).
- LLM: strict JSON schema, `reasoning_effort: 'medium'`, one retry on `json_validate_failed`, daily-limit 429 gets its own message.
- Save errors keep the preview open with the edits intact.
- Copy is plain English, sentence case, no exclamation marks.
- Never commit `secrets.json`. Commit locally at the end of each task; never push.

## Review Focus

1. **Text that isn't a recipe** (a shopping note, a link alone): the parser says so ("That doesn't look like a recipe…") and the pasted text stays in the box. → Task 4 (`isRecipe`) and Task 5 test.
2. **Very long pastes** (a whole web page copied): over 12,000 characters is refused before any LLM call with a message saying how to trim it. → Task 5 test.
3. **Save fails** (offline, RLS error): the editor stays open with every edit, error shown. → Task 5 test.
4. **A `#/recipe/<id>` that doesn't exist** (deleted, mistyped, other user's): shows "Recipe not found." with a link back, never a blank page. → Task 6 test.
5. **Long recipes overflow the token cap**: a 25-ingredient, 15-step recipe plus medium reasoning doesn't fit in 1,500 tokens; the proxy cap rises to 4,000 and a `finish_reason: 'length'` answer gets a "too long" message instead of a parse error. → Tasks 1 and 4.

---

### Task 1: Harden the Groq proxy (#9)

**Files:**
- Create: `supabase/functions/groq/body.js` (plain JS so both Deno and Vitest load it)
- Create: `supabase/functions/groq/body.test.js`
- Modify: `supabase/functions/groq/index.ts`
- Modify: `vite.config.js` (`test.include` adds `'supabase/functions/**/*.test.js'`)

**Interfaces:**
- Produces: `export const MODELS: Set<string>`, `export const MAX_TOKENS = 4000`, `export function groqBody(input: object): object | null` — returns null when the model isn't allowed.

- [ ] **Step 1: Write failing tests** in `body.test.js`:
  - `groqBody({ model: 'openai/gpt-oss-20b', messages: [m], temperature: 0, response_format: rf, reasoning_effort: 'medium', max_completion_tokens: 9999, max_tokens: 9999, n: 5, tools: [t], stream: true })` equals `{ model, messages: [m], temperature: 0, response_format: rf, reasoning_effort: 'medium', max_completion_tokens: 4000 }` (dropped: `max_tokens`, `n`, `tools`, `stream`).
  - missing `max_completion_tokens` → 4000; `max_completion_tokens: 800` → 800.
  - `groqBody({ model: 'llama-3.3-70b', messages: [] })` → `null`.
  - keys absent from the input stay absent (no `temperature: undefined`).
- [ ] **Step 2:** `npm test -- body` → FAIL (module not found).
- [ ] **Step 3: Implement `groqBody`**, then rewire `index.ts`: parse JSON → `groqBody` (400 'Model not allowed' if null) → check `GROQ_API_KEY` (500) → claim. On claim failure map `err.code === '42501'` → 403 not_member, `err.message === 'daily_limit'` → 429, anything else → 502 `{ error: { code: 'limit_check_failed', message: 'Could not check your daily limit. Try again.' } }`. Update the header comment ("Requests are passed to Groq as they are" is no longer true).
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5: Commit** `Groq proxy: allow-listed body, key check before the claim (#9)`. The function is deployed in Task 8.

### Task 2: `recipes` table

**Files:**
- Create: `supabase/migrations/20261109130000_recipes.sql`
- Create: `supabase/tests/database/recipes.test.sql`
- Modify: `supabase/tests/database/authz.test.sql` only if an existing assertion lists tables explicitly and now fails.

**Interfaces:**
- Produces: table `public.recipes` exactly as in the spec's Data model, plus:
  - `owner uuid not null default auth.uid() references auth.users(id) on delete cascade`
  - `title text not null check (length(btrim(title)) between 1 and 200)`
  - `ingredients jsonb not null default '[]' check (jsonb_typeof(ingredients) = 'array')`, same for `steps`
  - `steps_origin text not null default 'source' check (steps_origin in ('source','ai_suggested','user'))`
  - `source_kind text not null default 'text' check (source_kind in ('text','instagram','web','youtube'))`
  - `source_text text not null default '' check (length(source_text) <= 20000)`
  - `tags text[] not null default '{}'`, `starred boolean not null default false`, `share_token uuid unique`
  - `created_at`/`updated_at timestamptz not null default now()`, trigger `set_updated_at` before update
  - index on `(owner, created_at desc)`
  - RLS on; one policy `for all to authenticated using (owner = (select auth.uid()) and public.is_member()) with check (same)`; grant select, insert, update, delete to authenticated; nothing to anon.

- [ ] **Step 1: Write `recipes.test.sql`** (pgTAP, same throwaway-user pattern as `authz.test.sql`): member A inserts a recipe and reads it back; member B sees 0 rows of A's and its update/delete of A's row affects 0 rows; B can't insert with `owner = A` (throws 42501); a signed-in non-member sees 0 rows and can't insert; anon gets `permission denied`; empty title, `steps_origin = 'x'`, and `ingredients = '{}'` each throw 23514; `updated_at` moves on update; deleting A's auth user deletes A's recipes.
- [ ] **Step 2:** `supabase start` (if not running), `npm run test:db` → FAIL (relation does not exist).
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4:** `supabase db reset && npm run test:db` → all pass, including the existing "row-level security is on for every public table" and anon-grants assertions.
- [ ] **Step 5: Commit** `Database: recipes table with owner-only RLS`.

### Task 3: Storage adapter and state for recipes

**Files:**
- Modify: `app/src/lib/storage/supabaseStorage.js`, `app/src/lib/storage/index.js` (doc comment), `app/src/lib/storage/storage.test.js`
- Modify: `app/src/state.js`, `app/src/app.test.js` (fake adapter gains the new methods, keeps recipes in memory)

**Interfaces:**
- A recipe in the app (camelCase): `{ id, title, summary, servings, prepMinutes, cookMinutes, ingredients: [{ group, amount, unit, item, note }], steps: [{ text }], stepsOrigin, tags, notes, sourceKind, sourceUrl, sourceAuthor, sourceText, starred, createdAt, updatedAt }`. `id` is absent on a new recipe.
- Adapter produces: `saveRecipe(recipe) → recipe` (insert when no `id`, else update by id; returns the stored row mapped), `deleteRecipe(id) → void`, `setStarred(id, starred) → void`. `loadAll()` selects `*` ordered `created_at desc`. `exportAccount()` adds `recipes: [...]` (mapped, without `id`). Errors throw via `fail('Could not save the recipe', error)` etc.
- `state.js` produces: `saveRecipe(recipe) → recipe` (replaces or prepends in `recipes.value`), `deleteRecipe(id)`, `toggleStar(id)` (optimistic; reverts and rethrows on error), `parseRecipe({ title, text })` (Task 4 wiring: gets `storage.llmEndpoint()` and calls `llm.parseRecipe`).
- Mapping lives in two private functions `toRow(recipe)` / `fromRow(row)` in `supabaseStorage.js`; `toRow` never sends `id`, `owner`, `created_at`, `updated_at`, `share_token`.

- [ ] **Step 1: Write failing tests** in `storage.test.js`: `init()` with `tables.recipes = [row]` returns `[fromRow(row)]` and the query has `order('created_at', { ascending: false })`; `saveRecipe` without id calls `insert` with snake_case keys and no `id`; with id calls `update(...).eq('id', id)`; `deleteRecipe('r1')` calls `delete().eq('id','r1')`; `setStarred('r1', true)` calls `update({ starred: true }).eq('id','r1')`; `exportAccount()` contains `recipes`. Extend the fake client so `insert/update` chains resolve to `{ data: row }` when `.select().single()` is used.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement** adapter methods and state functions.
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5: Commit** `Storage: load, save, star and delete recipes`.

### Task 4: `llm.js` — parse pasted text into a card

**Files:**
- Create: `app/src/lib/llm.js`, `app/src/lib/llm.test.js`
- Create: `app/src/lib/recipes.js`, `app/src/lib/recipes.test.js`

**Interfaces:**
- `recipes.js` produces: `UNITS = ['g','kg','ml','l','tsp','tbsp','pc']`; `MAX_PASTE = 12000`; `emptyRecipe() → recipe` (all fields empty, `stepsOrigin: 'source'`, `sourceKind: 'text'`); `normalizeIngredient(i) → { group, amount, unit, item, note }` (non-finite amount → null; unit not in `UNITS` → null and, if there was one, `"<amount> <unit>"` prepended to `note`; trims strings; empty strings → null except `item`); `formatAmount(i) → string` (e.g. `"200 g"`, `"1.5 tbsp"`, `"2"`, `""`; numbers trimmed to at most 2 decimals); `filterRecipes(list, { query, tag, starredOnly }) → list` (case- and accent-insensitive match on title, summary, ingredient items, tags); `allTags(list) → string[]` sorted, unique, lower-case.
- `llm.js` produces: `RECIPE_TASK = { name: 'recipe_card', schema, prompt() }`; `llmJson(endpoint, text, task)` ported from Content_Project's `llm.js` (proxy only: `endpoint` is `{ url, headers }` or null → code `NO_KEY` "Sign in to use the assistant."), with `max_completion_tokens: 4000`, and `finish_reason === 'length'` → error code `TOO_LONG` "That recipe is too long to read in one go. Paste a shorter part."; `parseRecipe(endpoint, { title, text }) → { recipe, needsTitle }` or throws code `NOT_RECIPE` "That doesn't look like a recipe. Paste the ingredients and the method." The user message is `Title given by the user: <title>\n\n<text>` when a title was typed, else just the text.
- Schema fields (all required, strict): `isRecipe` bool, `title` string|null, `summary` string|null, `servings` int|null, `prepMinutes` int|null, `cookMinutes` int|null, `ingredients` array of `{ group: string|null, amount: number|null, unit: enum UNITS + null, item: string, note: string|null }`, `steps` array of string, `tags` array of string, `notes` string|null.
- Prompt rules that must be in the text: metric only, units only from the list; weights in g/kg; liquids in ml/l; spoons stay tsp/tbsp; countable items use `pc` ("2 eggs" → amount 2, unit `pc`); dry volume measures (cups, US ounces by volume) become grams using typical densities with the original measure in `note` (e.g. `"1 cup"`); Fahrenheit → Celsius inside step text; fractions → decimals; "to taste"/"a pinch" → amount null, unit null, words in note; keep the source's ingredient groups ("For the sauce"); steps are the method in order, one action-group per step, without numbering; never invent ingredients or steps — empty array if the text has none; title only if the text clearly names the dish, else null; tags 2–5 lower-case words (cuisine, course, main ingredient, diet); notes are tips from the source.
- `parseRecipe` result: `recipe = { ...emptyRecipe(), ...mapped fields, ingredients normalized, steps: steps.map(text => ({ text })), tags lower-cased and de-duplicated, sourceText: text }`; title = typed title (trimmed) if non-empty, else LLM title, else `''`; `needsTitle = !recipe.title`.

- [ ] **Step 1: Write failing tests.** `recipes.test.js`: `normalizeIngredient({ amount: 1, unit: 'cup', item: 'flour', note: null, group: null })` → unit null, note `'1 cup'`; `{ amount: 'a pinch' ... }` → amount null; `formatAmount({ amount: 0.333333, unit: 'tsp' })` → `'0.33 tsp'`; `filterRecipes` finds "crème brûlée" by query `creme`, by an ingredient item, by tag, and `starredOnly`. `llm.test.js` (stub `globalThis.fetch`): typed title "Nan's soup" wins over LLM "Tomato Soup"; empty title + LLM title → LLM title, `needsTitle` false; empty title + LLM null → `needsTitle` true; `isRecipe: false` → throws `NOT_RECIPE`; first response 400 `json_validate_failed` → second request made with `temperature: 0.3`; 429 `daily_limit` → code `DAILY_LIMIT` with the server message; `finish_reason: 'length'` → `TOO_LONG`; request body has `model: 'openai/gpt-oss-20b'`, `reasoning_effort: 'medium'`, `response_format.json_schema.strict: true`; null endpoint → `NO_KEY`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement** `recipes.js` and `llm.js`; wire `parseRecipe` in `state.js`.
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5: Commit** `Parse pasted recipes into metric cards with the LLM`.

### Task 5: Add sheet and card editor

**Files:**
- Create: `app/src/components/AddRecipeDialog.vue`, `app/src/components/RecipeEditor.vue`
- Modify: `app/src/App.vue` (an **Add recipe** button in the library toolbar opens the dialog), `app/src/styles.css`, `app/src/app.test.js`

**Interfaces:**
- `RecipeEditor.vue`: props `modelValue: recipe`, `saving: boolean`, `error: string`; emits `update:modelValue`, `save`, `cancel`. Fields: title (required; when empty shows "Give it a title to save it."), summary, servings, prep and cook minutes, ingredient rows (group, amount, unit select of `UNITS` + blank, item, note; add/remove row), steps (one textarea, one step per line), tags (comma-separated input), notes. Editing the steps text sets `stepsOrigin` to `'user'`. Save is disabled while `saving` or without a title.
- `AddRecipeDialog.vue` (uses `Modal.vue`): `v-model:open`. Stage 1: **Title (optional)** input and **Paste the recipe** textarea, button **Make the card**; over `MAX_PASTE` characters shows "That's over 12,000 characters. Paste just the ingredients and method." and doesn't call the LLM. While parsing, the button reads "Reading…". Errors from `parseRecipe` show under the textarea; the pasted text stays. Stage 2: `RecipeEditor`; **Back** returns to stage 1 with the text; save calls `state.saveRecipe`, closes the dialog and navigates to `#/recipe/<id>`; a save error stays in stage 2 with edits intact.

- [ ] **Step 1: Write failing app tests** (fake adapter's `llmEndpoint` returns `{ url: 'x', headers: {} }`; stub `fetch` with a canned Groq answer): paste → Make the card → editor shows the parsed title and an ingredient `200 g`; empty-title case shows the title prompt and Save is disabled until typed; NOT_RECIPE message keeps the text; 12,001-char paste shows the limit message and `fetch` is not called; a `saveRecipe` that throws keeps the editor open with the edited title and shows the error; a successful save adds the card to the library and the hash becomes `#/recipe/<id>`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement** both components and the toolbar button.
- [ ] **Step 4:** `npm test && npm run build` → pass.
- [ ] **Step 5: Commit** `Add sheet: paste a recipe, edit the card, save`.

### Task 6: Library grid, card page, star, search, tags, edit, delete

**Files:**
- Create: `app/src/lib/route.js` (+ `route.test.js`), `app/src/components/LibraryView.vue`, `app/src/components/RecipeView.vue`
- Modify: `app/src/App.vue`, `app/src/styles.css`, `app/src/app.test.js`

**Interfaces:**
- `route.js` produces: `route` (reactive `{ name: 'library' | 'recipe', id: string | null }`, kept in step with `location.hash` via `hashchange`), `parseHash(hash) → { name, id }` (`''`, `'#/'`, unknown → library; `'#/recipe/<id>'` → recipe), `go(hash)`.
- `LibraryView.vue`: toolbar with search input, **Starred** toggle, tag chips from `allTags`, **Add recipe** button (moved here from Task 5's App toolbar). Grid of tiles (title, summary, total time `prep+cook` as "45 min", up to 3 tags, star button). Empty library: "No recipes yet." plus the Add button; filters with no match: "No recipes match." with **Clear filters**. Default order newest first. Tile click → `#/recipe/<id>`.
- `RecipeView.vue`: prop `id`. Back link to library; title, star, summary, servings/times, ingredients grouped under their `group` headings with `formatAmount`, numbered steps, tags, notes, source (author/url if present). **Edit** opens `RecipeEditor` in place (save → `state.saveRecipe`, error keeps edits). **Delete** opens a `Modal` confirm ("Delete <title>? This can't be undone.") → `state.deleteRecipe` → `#/`. Unknown id → "Recipe not found." with a link to the library.

- [ ] **Step 1: Write failing tests.** `route.test.js` for `parseHash`. App tests with three seeded recipes: search narrows tiles; tag chip filters; Starred toggle filters; star on a tile calls `setStarred` and the tile shows starred; a failing `setStarred` reverts the star and shows the error; tile click shows the card page with ingredient "200 g flour"; edit → change title → save updates the page and the tile; delete → confirm → back to library without it; `#/recipe/nope` shows "Recipe not found.".
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement** route, views and App wiring.
- [ ] **Step 4:** `npm test && npm run build` → pass.
- [ ] **Step 5: Commit** `Library grid and recipe page: search, tags, star, edit, delete`.

### Task 7: Privacy page (#8)

**Files:**
- Create: `app/public/privacy.html` (adapted from `../Content_Project/app/public/privacy.html`; same styles and structure)
- Modify: `app/src/App.vue` (a "Privacy" link on the sign-in screen and in a small footer), `app/src/app.test.js`

**Interfaces:**
- Content must match what Phases 0–1 store and send: account (email, name, picture link, join date), recipes (all card fields and the pasted source text), invites and access requests, assistant usage counts (per day, older days dropped); pasted text and titles are sent to Groq to make the card (Groq's own retention terms; link to Groq's privacy policy); Supabase hosts the data (EU region if that's the project's region — check `supabase projects list`); export and account deletion in **Your data**; no ads, analytics or tracking cookies; contact = the GitHub repo's issues. No mention of sharing or imports (later phases update the page).

- [ ] **Step 1: Write failing test:** the signed-out screen and the library footer each have a link with `href="privacy.html"`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Write the page and links.**
- [ ] **Step 4:** `npm test && npm run build && ls dist/privacy.html` → pass, file present.
- [ ] **Step 5: Commit** `Privacy page (#8)`.

### Task 8: Ship-readiness (owner go-ahead for each outward step)

- [ ] **Step 1:** `npm test`, `npm run test:db`, `npm run build` all green; record counts.
- [ ] **Step 2 (outward, ask first):** `supabase db push` (recipes migration) and `supabase functions deploy groq --no-verify-jwt`.
- [ ] **Step 3:** Comment on #7, #8, #9 "implemented in <sha>, awaiting verification"; leave them open. ROADMAP stays 🟡 until the owner has tried it.
- [ ] **Step 4:** Tell the owner what to try in Chrome (`npm run dev`): paste a recipe with cups and °F, one without a title, one that isn't a recipe; star, search, tag filter, edit, delete; the privacy link. Push only when the owner says "push".
