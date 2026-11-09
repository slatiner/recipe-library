# Phase 2: Import from Links Implementation Plan

**Goal:** Paste a link to a recipe site or an Instagram post instead of the recipe, and get the same editable card. Cards without a method are flagged and offer *Suggest a method* (AI, labelled) or *Paste steps / a link*. A recipe site's own photo shows on the card as a credited link.

**Architecture:** A new `import-url` edge function fetches the page and returns plain text (it never calls the LLM). The app sends that text through the existing `parseRecipe`. All extraction lives in `supabase/functions/import-url/extract.js` (plain JS, tested in Vitest on invented fixtures). Prompts stay in `app/src/lib/llm.js`.

**Spec:** `docs/superpowers/specs/2026-11-09-recipe-library-design.md` (Import a link, Missing steps). Decisions: ROADMAP.md, "Phase 2 import choices" and "Known photos of the dish". Issue: #10.

## Owner decisions (2026-11-09)

- Every import goes through the LLM, JSON-LD included (US units → metric). One request from the daily limit.
- `import-url` is member-only and doesn't count against the daily limit.
- *Suggest a method* uses `openai/gpt-oss-120b` (already allowed by the proxy).
- Instagram via the public embed page stays, with pasting the caption as the fallback.
- The source site's photo is kept as a link (`image_url`), never copied, never on the public page. Instagram images are skipped (signed links expire).

## Finding during the build

Instagram's embed page holds the caption only for a plain request. With a browser user agent it returns an empty app shell. So `import-url` sends an honest, non-browser user agent. If that changes, captions stop arriving (`no_caption`) and the app asks for the caption to be pasted.

## Tasks

- [x] **1. `import-url` function.** `classifyUrl` (Instagram post/reel → `/embed/captioned/`, other http(s) → web), `isPrivateHost` (checked on every redirect hop), `instagramCaption`, `recipeFromJsonLd` (handles `@graph`, arrays, `HowToSection`, escaped HTML, ISO durations), `pageText`, `extractWebPage` (JSON-LD image, else `og:image`). Limits: 10 s, 2 MB, 4 redirects. `[functions.import-url] verify_jwt = false`.
- [x] **2. Migration `image_url`** (http(s) only, ≤ 2,000 characters) with pgTAP checks.
- [x] **3. App.** `storage.importEndpoint()`; `lib/importer.js` (`linkOnly`, `linksIn`, `importLink` with the paste fallback in every error); `llm.js` `STEPS_TASK`/`parseSteps` and `METHOD_TASK`/`suggestMethod`; `state.parseRecipe` imports a lone link; `importSteps`, `suggestMethod`.
- [x] **4. UI.** `MissingSteps.vue` in the preview (`RecipeEditor`) and on the recipe page (saves at once). It offers "Get the method from <site>" when the caption has a link, *Suggest a method* and *Paste steps or a link*. The AI badge shows in both places. The source photo on the recipe page has a "Photo: <site>" credit, is loaded with `referrerpolicy="no-referrer"` and is hidden if it fails to load.
- [x] **5. Privacy page:** link fetching, source photos and photo search.
- [x] **5b. Find a photo (Pexels), added at the owner's request.** Migration `image_source` / `image_credit` / `image_credit_url` (existing photos become `site`). `photo-search` edge function (members only, `PEXELS_API_KEY`), `lib/photos.js`, `PhotoPicker.vue` (search by title, editable, 9 results, "Photos provided by Pexels") in the editor and on the recipe page (saved at once), `PhotoCredit.vue` ("Photo: <photographer> on Pexels" or the site).
- [ ] **6. Deploy and check live (owner):**
  - `supabase db push` (the `image_url` migration)
  - `supabase functions deploy import-url --no-verify-jwt`
  - Pexels key: `supabase secrets set PEXELS_API_KEY=…`, then `supabase functions deploy photo-search --no-verify-jwt`
  - In Chrome via `npm run dev`: a recipe site with JSON-LD, one without, an Instagram reel, a post whose caption says "recipe on my website", and *Suggest a method*.

## Not covered by tests

Live fetches (sites blocking the server, Instagram blocking Supabase IPs), real LLM output quality, and the Deno function's request handling (`index.ts` has no Deno test runner here; the extractors it uses are tested).
