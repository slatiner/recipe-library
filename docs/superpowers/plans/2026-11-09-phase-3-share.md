# Phase 3: Share & Shopping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans (the owner chose native, i.e. executing-plans, for Phase 2.5) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public, read-only link per recipe, and a merged shopping list for several recipes copied as plain text.

**Architecture:**
- **Share link.** It sets `recipes.share_token` through an owner-only RPC. A visitor's page reads the recipe through a `security definer` RPC that returns only public fields. The route `#/r/<token>` renders before the sign-in gate.
- **Shopping list.** A pure function in `lib/shopping.js` builds it, with no AI and nothing stored. The library gets a pick mode to choose the recipes.

**Tech Stack:** Vue 3, Vitest + @vue/test-utils, Supabase migrations + pgTAP.

**Spec:** `docs/superpowers/specs/2026-11-09-recipe-library-design.md` (Share, Shopping list, data model `share_token`). ROADMAP.md Phase 3 and Decisions. Issue: #11.

## Owner decisions (2026-11-09)

- **Picking recipes for a list.** A **Shopping list** button in the library bar switches to a pick mode: tap tiles to select them, and a bar shows `N selected · Copy list · Cancel`. It works on either list.
- **What the public page shows:**
  - Shown: title, summary, times, ingredients, method (with the AI badge when `steps_origin = ai_suggested`), notes, tags, and the source link and author.
  - Not shown: the star, the date cooked, the list, or the owner.
- **Photos on the public page.** Only a `stock` photo shows, with its credit. A recipe site's own photo (`image_source = site`) never does. Uploads come in Phase 4.
- **The list text.** The recipe names come first, then one line per item, sorted alphabetically by ingredient. There's no grouping by aisle.

## Global Constraints

- **Link format:** `${location.origin}${location.pathname}#/r/<token>`. The token is a server-made `uuid` (`gen_random_uuid()`), never one made in the browser.
- **What the RPC returns:** the RPC for visitors never returns `owner`, `id`, `source_text`, `starred`, `status`, `cooked_on`, `share_token` or the timestamps.
- **Who can share:** only the owner can turn sharing on or off. `saveRecipe`'s `toRow` keeps not sending `share_token`, so an edit doesn't touch the link.
- **Exact copy:**
  - Buttons: `Share link` / `Copy link` / `Stop sharing`.
  - Toasts: `Link copied` and, for the list, `List copied`.
  - A bad or revoked link shows: `This link doesn't work any more. Ask for a new one.`
- **Shopping-list format:** header line `Shopping list: <title>, <title>`, then the items. Each item is `formatAmount(i)` + ` ` + item, or just the item when there's no amount.

## Review Focus

1. **The clipboard isn't available** (permission denied, an old browser). Test: when `navigator.clipboard.writeText` throws, the text shows in a read-only, preselected textarea with "Copy it from here", for both the link and the list.
2. **A signed-in member opens a share link.** They see the public page, not the library. Their own recipe shows the same public view. Test: mount as `ok`, hash `#/r/t1`, `.shared-recipe` is rendered.
3. **A revoked link, or a token that isn't a uuid.** The RPC returns null; it doesn't error. Postgres raises `22P02` on a malformed uuid, so the adapter catches that error and returns null. Tests: pgTAP for revoked and unknown tokens; Vitest for a malformed token returning null.
4. **The same item in g and kg, or ml and l.** These are not merged in v1; each unit gets its own line. A line without an amount ("salt") is listed once, even when several recipes have it. Test in `shopping.test.js`.
5. **A recipe deleted while it's selected in pick mode.** It drops out of the selection, and the count updates. Test: the selection is computed against `recipes`.

---

### Task 1: Share RPCs and pgTAP

**Files:**
- Create: `supabase/migrations/20261109170000_share.sql`
- Create: `supabase/tests/database/share.test.sql`, in the style of `recipes.test.sql`

**Interfaces (SQL):**
- `public.share_recipe(p_id uuid) returns uuid`
  - Security invoker, so RLS applies.
  - Sets `share_token = coalesce(share_token, gen_random_uuid())` on the caller's own row and returns the token.
  - If no row was updated, it raises `P0002` with the message `Recipe not found`.
- `public.stop_sharing(p_id uuid) returns void`
  - Security invoker. Sets `share_token = null`.
- `public.get_shared_recipe(p_token uuid) returns jsonb`
  - `security definer`, `set search_path = ''`, `stable`.
  - Execute is granted to `anon` and `authenticated`.
  - Returns `null` when no row matches.
  - Keys: `title, summary, servings, prep_minutes, cook_minutes, ingredients, steps, steps_origin, tags, notes, source_kind, source_url, source_author`, plus `image_url, image_credit, image_credit_url` only when `image_source = 'stock'`.

- [ ] **Step 1: Write the pgTAP tests.**
  - a shares their recipe and gets a uuid. Sharing twice returns the same token.
  - b calling `share_recipe` on a's recipe raises `P0002`. A newcomer gets `42501`, or whatever the existing RLS gives; match `recipes.test.sql`.
  - As `anon`, `get_shared_recipe(token)` returns the title, and its keys contain none of `owner, id, source_text, starred, status, cooked_on, share_token, created_at`.
  - A `site` photo is left out. A `stock` photo and its credit are included.
  - An unknown token returns null. After `stop_sharing`, the old token returns null.
  - `anon` cannot `select` from `public.recipes`. This is already tested; keep it.
- [ ] **Step 2:** Run `npm run test:db`. The new tests should fail because the functions don't exist.
- [ ] **Step 3: Write the migration.** Revoke execute from `public`, then grant it as listed above. Add a header comment in the house style.
- [ ] **Step 4:** Run `supabase migration up`, then `npm run test:db`. Everything should pass.
- [ ] **Step 5:** Commit.

### Task 2: Adapter, route, shopping list helper

**Files:**
- Modify: `app/src/lib/storage/supabaseStorage.js`, `index.js` (doc), `storage.test.js`
- Modify: `app/src/lib/route.js`, `route.test.js`
- Create: `app/src/lib/shopping.js`, `app/src/lib/shopping.test.js`
- Modify: `app/src/state.js`

**Interfaces:**
- **Adapter:**
  - `fromRow` adds `shareToken: r.share_token ?? null`. `toRow` doesn't send it.
  - `shareRecipe(id) → token`, via rpc `share_recipe`.
  - `stopSharing(id)`, via rpc `stop_sharing`.
  - `getSharedRecipe(token) → card | null`, via rpc `get_shared_recipe`. It maps snake_case to camelCase like `fromRow`. It returns null for a null result and for error code `22P02`. Any other error fails with `Could not load the recipe`. It works without a session.
- **Route:** `parseHash('#/r/<token>')` gives `{ name: 'shared', id: token }`.
- **`shopping.js`:** `shoppingList(recipes: card[]) → string`.
  - **Merge key:** the item folded like `filterRecipes` does (lower case, no accents, trimmed), plus the unit.
  - **Amounts:** items with the same key and amounts are summed. A key that appears with no amount is listed once. When the same key has both an amount and no amount, the line keeps the summed amount.
  - **Item text:** the first spelling seen is kept.
  - **Order:** lines are sorted by item with `localeCompare`.
  - **Ignored:** notes and groups.
- **`state.js`:** `shareRecipe(id)` and `stopSharing(id)` update `shareToken` on the card in `recipes` after the adapter succeeds. Also `getSharedRecipe(token)` and `shareUrl(token)`.

- [ ] **Step 1: Write the failing tests.**
  - **`shopping.test.js`:**
    - 200 g flour + 100 g Flour gives `300 g flour`.
    - 200 g flour + 1 kg flour stay as two lines.
    - salt (no amount) twice gives one `salt` line.
    - 3 pc bananas gives `3 bananas`.
    - The header lists the titles in the order given.
    - 0.1 + 0.2 tsp gives `0.3 tsp`.
  - **`route.test.js`:** `#/r/abc` gives `{ name: 'shared', id: 'abc' }`.
  - **`storage.test.js`:**
    - `getSharedRecipe` maps the fields.
    - A `22P02` error gives null.
    - `shareRecipe` calls rpc `share_recipe` with `{ p_id }`.
    - `toRow` has no `share_token`.
- [ ] **Step 2:** Run `npx vitest run` and confirm these tests fail.
- [ ] **Step 3:** Implement the interfaces above.
- [ ] **Step 4:** Run `npx vitest run`. It should pass.
- [ ] **Step 5:** Commit.

### Task 3: Share on the recipe page, the public page

**Files:**
- Create: `app/src/components/RecipeBody.vue`. Move the shared read-only parts of `RecipeView.vue` here: times, ingredients by section, the method with the AI badge, notes, tags, and the source. `RecipeView` uses it. `MissingSteps` stays in `RecipeView` and goes in a slot shown when there are no steps.
- Create: `app/src/components/SharedRecipe.vue`. Props `token`. It loads the recipe and shows:
  - a loading state;
  - the stock photo with `PhotoCredit`, if there is one;
  - the title, summary and `RecipeBody`;
  - the "doesn't work any more" message when the result is null;
  - a footer: `Recipe Library` and a Privacy link.
- Create: `app/src/lib/clipboard.js` with `copyText(text) → Promise<boolean>`. It returns false when the clipboard throws or is missing.
- Modify: `App.vue`. When `route.name === 'shared'`, render `SharedRecipe` instead of anything else, whatever the connection state, and hide the Add recipe button and the menu.
- Modify: `RecipeView.vue`. Add `Share link` to the actions.
  - When the recipe is shared, show a share row: `Copy link · Stop sharing`.
  - When copying fails, show the link in a read-only textarea with the text "Copy it from here".
- Modify: the fake adapter in `app.test.js` (`shareRecipe`, `stopSharing`, `getSharedRecipe`), and `styles.css`. Port the look from Content_Project's `SharedItem.vue`, `.si-*`, which is already in the stylesheet.

- [ ] **Step 1: Write the failing tests** in `app.test.js`:
  - **Share link:** it calls `shareRecipe`, copies the URL ending `#/r/<token>` (stub `navigator.clipboard`), and shows `Link copied`.
  - **Copying fails:** `writeText` rejects, and the link shows in the textarea.
  - **Stop sharing:** calls `stopSharing`. `Share link` shows again.
  - **Signed out:** `#/r/t1` shows the title and ingredients, with no sign-in button and no Edit/Delete/star.
  - **Signed in:** `#/r/t1` also shows `.shared-recipe`.
  - **Bad token:** `getSharedRecipe` returns null, and the page shows `This link doesn't work any more. Ask for a new one.`
  - **Photos:** a stock photo shows with its credit. A card without `imageUrl` shows no photo.
  - **Existing tests:** the existing recipe page tests still pass after the `RecipeBody` split.
- [ ] **Step 2:** Run `npx vitest run` and confirm these tests fail.
- [ ] **Step 3:** Implement the files above.
- [ ] **Step 4:** Run `npx vitest run` and `npm run build`. Both should pass.
- [ ] **Step 5:** Commit.

### Task 4: Shopping list pick mode

**Files:**
- Modify: `app/src/components/LibraryView.vue`, `styles.css`, `app.test.js`

**Behaviour:**
- **The button.** A `Shopping list` button sits in the library bar, after Starred.
- **Pick mode:**
  - Tiles toggle selection on click and Enter, with `aria-pressed` and a `selected` class, instead of opening.
  - Their ✓ and star are hidden.
  - A sticky bar `.pick-bar` shows `N selected`, `Copy list` (disabled at 0) and `Cancel`.
- **Copy list.** It calls `copyText(shoppingList(selected))` and shows `List copied`. If copying fails, the list shows in a read-only textarea. The mode stays on, so the list can be copied again. Cancel clears the selection and leaves the mode.
- **Selection.** It's a `Set` of ids. `selected` is computed from `recipes` filtered by that set, so a deleted recipe drops out. Switching lists keeps the selection, so you can pick from both.

- [ ] **Step 1: Write the failing tests:**
  - **Picking:** enter pick mode, click two tiles, and the hash doesn't change. The bar shows `2 selected`. Copy list writes text starting `Shopping list: ` with both titles.
  - **Clicking again:** clicking a selected tile again unselects it.
  - **Copying fails:** the textarea shows the list.
  - **Cancel:** leaves pick mode, and clicking a tile opens the recipe again.
  - **Deleted recipe:** a selected recipe removed from `state.recipes` drops the count.
- [ ] **Step 2:** Run `npx vitest run` and confirm these tests fail.
- [ ] **Step 3:** Implement the behaviour above.
- [ ] **Step 4:** Run `npx vitest run` and `npm run build`. Both should pass.
- [ ] **Step 5:** Commit.

### Task 5: Docs and deploy (owner)

- [ ] **Privacy page:**
  - A shared link makes that recipe readable by anyone who has the link, until you stop sharing it.
  - What a visitor sees: no account details, and no site photo.
  - The shopping list isn't stored.
- [ ] **ROADMAP.md:** set the status to 🚧, then ✅ after the owner checks it.
- [ ] **#11:** comment "implemented in <sha>, awaiting verification".
- [ ] **Owner:** run `supabase db push`. Then in Chrome via `npm run dev`:
  - share a recipe, and open the link in a private window;
  - stop sharing, and reload the private window;
  - pick three recipes, copy the list, and paste it in WhatsApp or Notes.

## Not in this phase

Scaling servings for the list (Polish), grouping by aisle, merging g with kg, saving someone's shared recipe into your own library, and a list of everything you've shared.

## Not covered by tests

How the public link looks once deployed on GitHub Pages (the base path), and real clipboard behaviour on iOS Safari.
