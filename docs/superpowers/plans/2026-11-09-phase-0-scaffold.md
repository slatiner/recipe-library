# Phase 0: Scaffold & Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An empty Recipe Library shell, ported from Content_Project, that a member can sign in to with Google, join with an invite code, and see an empty library; with the database, Groq proxy and workflows in place for Phase 1.

**Architecture:** Vue 3 + Vite app in `app/` (only `app/` is served), talking to its own Supabase project through one storage adapter. Membership, invites, access requests, account deletion and the assistant daily limit are ported as Supabase migrations with pgTAP tests. The `groq` edge function is ported unchanged apart from origins. No `recipes` table yet; that is Phase 1.

**Tech Stack:** Vue 3.5, Vite 8, Vitest 5 + @vue/test-utils + jsdom, @supabase/supabase-js 2, Supabase CLI 2.120 (local Docker for `supabase start`), Deno edge function, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-09-recipe-library-design.md`. Source to port from: `../Content_Project` (referred to as **CP** below; paths are relative to it).

## Global Constraints

- MIT, public repo. No paid dependencies; hosting is the only accepted cost.
- Plain JavaScript, ES modules, no Pinia; shared state in `app/src/state.js`.
- All backend reads/writes go through `app/src/lib/storage/`, never from components.
- Keys live in gitignored `secrets.json`; never in `app/`, commits, logs or issues. `secrets.example.json` holds placeholders only.
- Vite serves only `app/` and `node_modules`; deploy only `dist/`.
- English UI copy. Working name in the UI: **Recipe Library**. Repo/Pages path: `recipe-library` (Pages URL `https://slatiner.github.io/recipe-library/`).
- Every schema change ships with a pgTAP test in `supabase/tests/database/`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push; never stage `secrets.json`.
- Tasks 1–6 are local only. Task 7 touches GitHub, Google Cloud and Supabase and **must not start without the owner's go-ahead**.

## Review Focus

1. An invite link (`?invite=CODE`) opened while signed out must survive the Google round trip and pre-fill the code → test in Task 5.
2. A signed-in account that hasn't redeemed a code must see only the code field / request-access form, never the library or settings beyond Account → test in Task 5.
3. A non-member must not be able to read members/invites rows or claim assistant requests, even by calling the RPC directly → pgTAP in Task 2.
4. The 51st assistant request in a UTC day is refused → pgTAP in Task 2.
5. The dev server must not serve `secrets.json` from the repo root → verification step in Task 1.

---

### Task 1: Project skeleton

**Files:**
- Create: `package.json`, `vite.config.js`, `secrets.example.json`, `app/index.html`, `app/src/main.js`, `app/src/App.vue` (placeholder), `app/src/styles.css`, `app/src/config.js`, `app/public/favicon.svg`, `app/src/smoke.test.js`

**Interfaces:**
- Produces: `npm run dev | build | test | test:db`; `config.js` exports `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (placeholder strings until Task 7).

- [ ] **Step 1:** `package.json`: name `recipe-library`, `private`, MIT, `type: module`; scripts and dependency versions copied from CP `package.json` minus `import-json`.
- [ ] **Step 2:** `vite.config.js` from CP; `fs.deny` = `['secrets.json', '.env', '.env.*']`; update the comment (no data file).
- [ ] **Step 3:** `secrets.example.json` from CP with the `groq` and `supabase` blocks, `google.project_id` = `recipe-library`, `redirect_uris` = `["https://slatiner.github.io/recipe-library/"]`; drop `gemini`.
- [ ] **Step 4:** `app/index.html` (title "Recipe Library"), `main.js` and `styles.css` from CP. In `styles.css` keep base tokens, layout, header, buttons, dialogs, sign-in; delete card, filter-bar, medium and star rules. `config.js`: the two exports with `'https://your-project-ref.supabase.co'` / `'sb_publishable_placeholder'` and CP's comment; no `STORAGE` switch. A simple pot-shaped `favicon.svg` (any simple design).
- [ ] **Step 5:** Write `smoke.test.js`: mounts `App.vue` and expects text `Recipe Library`. `App.vue` is a placeholder `<h1>Recipe Library</h1>` for now.
- [ ] **Step 6:** `npm install && npm test && npm run build` → 1 passed, `dist/index.html` exists.
- [ ] **Step 7:** Review focus 5: `echo '{}' > secrets.json; npm run dev` in background, then `curl -s -o /dev/null -w '%{http_code}' 'http://localhost:5173/@fs/'"$PWD"'/secrets.json'` → `403`. Stop the server, delete the dummy file.
- [ ] **Step 8:** Commit "Project skeleton: Vue 3 + Vite + Vitest ported from Content_Project".

### Task 2: Database: members, invites, access requests, account deletion, assistant limit

**Files:**
- Create: `supabase/config.toml` (via `supabase init`, then set `project_id = "recipe-library"`, auth `site_url = "http://localhost:5173"`, `additional_redirect_urls = ["https://slatiner.github.io/recipe-library/"]`, Google provider enabled with `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)` / `..._SECRET`, matching CP's `config.toml`)
- Create: `supabase/migrations/20261109120000_base.sql`, `20261109120100_members.sql`, `20261109120200_assistant_limit.sql`
- Create: `supabase/tests/database/authz.test.sql`

**Interfaces:**
- Produces (SQL, callable by `authenticated` unless noted): `is_member() → boolean`, `is_admin() → boolean`, `create_invite() → invites`, `redeem_invite(p_code text) → void`, `request_access(p_message text) → void`, `delete_my_account() → void`, `claim_assistant_request() → integer` (raises `daily_limit` past 50), `cleanup_unredeemed_accounts() → integer` (no client access); tables `members(user_id, is_admin, joined_at)`, `invites`, `access_requests`, `assistant_usage`, `keepalive` (anon-readable, one row `id = 1`); trigger function `set_updated_at()` for Phase 1.

- [ ] **Step 1: Write the failing pgTAP test** `authz.test.sql`, ported from CP's suite (keep only cases for the objects above). Required assertions:
  - non-member: `select count(*) from members` = 0 rows beyond own; `claim_assistant_request()` throws `42501`; `create_invite()` throws `42501`
  - member (non-admin): sees only own `members` row; cannot read `invites`; `create_invite()` throws `42501`
  - admin: `create_invite()` returns a code matching `^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$`
  - `redeem_invite` with that code makes the caller a member; a second user redeeming the same code throws; an expired code throws
  - `request_access('hi')` by a non-member creates one row; admin can read and delete it; redeeming a code removes the caller's request
  - 50 calls to `claim_assistant_request()` succeed; the 51st throws with message containing `daily_limit`
  - `delete_my_account()` removes the caller from `auth.users` and `members`; invites they used keep the row with `used_by` null
  - anon: `select id from keepalive` returns `1`; anon cannot select `members`
- [ ] **Step 2:** `supabase start && npm run test:db` → fails (relations do not exist).
- [ ] **Step 3:** Write the migrations by consolidating CP's final versions:
  - `base.sql` = CP `tighten_table_grants` (default-privilege revokes), `set_updated_at()` from CP `create_entries`, CP `keepalive`.
  - `members.sql` = CP `invites` + `access_requests` (the later `redeem_invite` replaces the earlier) + `account_deletion` (incl. the pg_cron cleanup job). Leave out: the `entries` policy, `default_visibility`, friendships, share links. Seed the first admin not by `insert … from auth.users` but by a comment: the owner's row is added in Task 7.
  - `assistant_limit.sql` = CP `assistant_limit` as-is.
- [ ] **Step 4:** `supabase db reset && npm run test:db` → all pass.
- [ ] **Step 5:** Commit "Database: members, invites, access requests, account deletion, assistant limit".

### Task 3: Groq edge function

**Files:**
- Create: `supabase/functions/groq/index.ts` (copy of CP's)

**Interfaces:**
- Produces: `POST {SUPABASE_URL}/functions/v1/groq` with the user's JWT; body is an OpenAI-style chat request; 401 signed out, 403 non-member, 429 `{code: 'daily_limit'}`; models allowed: `openai/gpt-oss-20b`, `openai/gpt-oss-120b`.

- [ ] **Step 1:** Copy CP's function. Changes only: `MODELS` adds `'openai/gpt-oss-120b'` (spec open question; enabling costs nothing until used); header comment issue refs removed. `ORIGINS` stays `https://slatiner.github.io` + `http://localhost:5173`.
- [ ] **Step 2:** In `config.toml`, `[functions.groq] verify_jwt = false` (as CP).
- [ ] **Step 3:** `supabase functions serve groq --no-verify-jwt` in background; `curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:54321/functions/v1/groq` → `401`. Stop it.
- [ ] **Step 4:** Commit "Groq proxy edge function".

### Task 4: Storage adapter and state

**Files:**
- Create: `app/src/lib/storage/index.js`, `app/src/lib/storage/supabaseStorage.js`, `app/src/state.js`
- Test: `app/src/lib/storage/storage.test.js`

**Interfaces:**
- Consumes: SQL functions from Task 2.
- Produces: `createSupabaseStorage(setStatus, { url, key, client })` returning `{ kind: 'supabase', init, connect, reconnect, signOut, redeemInvite(code), createInvite(), listInvites(), requestAccess(message), listAccessRequests(), dismissAccessRequest(userId), exportAccount(), deleteAccount(), llmEndpoint() }`. `init/connect/reconnect/redeemInvite` resolve to `recipes[]` (always `[]` in Phase 0) or `null`. `setStatus(state, text, account, profile)` with state in `'checking' | 'signedOut' | 'needsInvite' | 'ok' | 'warn'` and profile `{ name, avatarUrl, isAdmin }`.
- `state.js` exports: `recipes` (ref `[]`), `connection` (reactive `{state, text, account, profile}`), `setConnection`, `useStorage(adapter)`, `initStorage`, `connectStorage`, `reconnectStorage`, `signOut`, `redeemInvite`, `createInvite`, `listInvites`, `requestAccess`, `listAccessRequests`, `dismissAccessRequest`, `exportAccount`, `deleteAccount`.

- [ ] **Step 1: Write failing tests** in `storage.test.js`, ported from CP's supabase cases with a fake `client`:
  - `init()` with no session → status `signedOut`, returns `null`
  - session but `is_member` false → status `needsInvite`, returns `null`
  - member → status `ok`, profile `{ name, avatarUrl, isAdmin }` from the Google metadata and the `members` row, returns `[]`
  - `redeemInvite('BAD')` with the RPC error → throws `That invite code isn't valid. Check it and try again.`
  - `exportAccount()` returns `{ exportedAt, account, membership, accessRequests }`
  - `llmEndpoint()` → `{ url: '<SUPABASE_URL>/functions/v1/groq', headers: { Authorization: 'Bearer <token>', apikey: <key> } }`
- [ ] **Step 2:** `npm test` → new tests fail.
- [ ] **Step 3:** Port CP `supabaseStorage.js`, keeping only the listed methods; `loadAll()` returns `[]` (Phase 1 replaces it). Port CP `index.js` with the interface comment trimmed to these methods and `file` removed. Port `state.js` with only the listed exports (no entries, filters, ask, sharing).
- [ ] **Step 4:** `npm test` → pass.
- [ ] **Step 5:** Commit "Storage adapter and app state".

### Task 5: App shell: sign-in, invites, account

**Files:**
- Create: `app/src/App.vue` (replace placeholder), `app/src/components/{Modal,Avatar,GoogleButton,SettingsMenu,AccountDialog,InviteDialog}.vue`, `app/src/lib/scrollChrome.js`
- Delete: `app/src/smoke.test.js`
- Test: `app/src/app.test.js`

**Interfaces:**
- Consumes: `state.js` from Task 4.
- Produces: screens by `connection.state`: `signedOut` → sign-in; `needsInvite` → code field + request access; `ok` → header (logo text "Recipe Library", avatar, ⚙ menu) and an empty-library message `No recipes yet.`; Settings menu items: `Account` (export, delete account), `Invite someone` (admins only), `Sign out`.

- [ ] **Step 1: Write failing tests** in `app.test.js` using CP's `fakeAdapter` pattern (trimmed to the Task 4 methods):
  - signed out: only the Google button shows; clicking it calls `connect`
  - review focus 2: `needsInvite` shows the code field and request form, no `No recipes yet.`, no `Invite someone`
  - bad code shows `That invite code isn't valid. Check it and try again.`; `GOOD-CODE` shows `No recipes yet.`
  - review focus 1: load with `?invite=AAAA-BBBB-CCCC` while signed out → the query is removed from the URL; remount as `needsInvite` → the code field holds `AAAA-BBBB-CCCC`
  - member: `No recipes yet.`; ⚙ menu has Account and Sign out; `Invite someone` only when `profile.isAdmin`; Sign out calls `signOut` and returns to sign-in
  - Escape closes the ⚙ menu
- [ ] **Step 2:** `npm test` → fail.
- [ ] **Step 3:** Port the components from CP (`components/` + `lib/scrollChrome.js`) unchanged except copy: "media library" → "recipe library"; AccountDialog drops visibility/sharing rows. App.vue: CP's sign-in / redeem / request-access / header markup and the `pendingInvite()` logic; drop filters, cards, entry dialog, shared view, file mode, diagnostics, backup.
- [ ] **Step 4:** `npm test && npm run build` → pass.
- [ ] **Step 5:** Commit "App shell: sign-in, invites, account".

### Task 6: Workflows and project docs

**Files:**
- Create: `.github/workflows/pages.yml`, `keepalive.yml`, `backup.yml` (copies of CP's); `CLAUDE.md`; `README.md`
- Modify: `ROADMAP.md` (Phase 0 → 🟡 In progress)

- [ ] **Step 1:** Copy the three workflows. In `backup.yml` rename the artifact/key references from content-library to recipe-library. Same secret names (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_URL`, `AGE_RECIPIENT`).
- [ ] **Step 2:** `CLAUDE.md`: CP's sections "Where project state lives", "Project constraints", "Secrets", "House style", "How the owner likes to work", adapted (no data file, no file mode, phase labels `phase-N-*`); drop "Adding entries to the library". `README.md`: one paragraph, dev setup (`npm install`, `npm run dev`, `supabase start`, `npm test`, `npm run test:db`).
- [ ] **Step 3:** `npx --yes yaml-lint .github/workflows/*.yml` (or `python3 -c "import yaml,sys;[yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.yml`) → no errors.
- [ ] **Step 4:** Commit "Workflows, CLAUDE.md and README".

### Task 7: External setup (owner go-ahead required)

Each step is outward-facing; confirm with the owner before each group, and let the owner do anything needing their login.

- [ ] **Step 1 (GitHub):** `gh repo create slatiner/recipe-library --public --source .` (LICENSE already in the repo); enable Pages from Actions. Create milestones and labels `phase-0-scaffold` … `phase-5-polish`; one issue per Phase 0 task plus one per later phase as placeholders. Push only when the owner says "push".
- [ ] **Step 2 (Supabase, owner):** create a free project `recipe-library` (same region as CP); put URL, publishable and secret keys in `secrets.json`; set `config.js` values (publishable key is public); `supabase link`, `supabase db push`; `supabase secrets set GROQ_API_KEY=…` (from `secrets.json`, read in the shell); `supabase functions deploy groq --no-verify-jwt`.
- [ ] **Step 3 (Google, owner):** new OAuth client (or extra redirect on CP's) with redirect `https://<ref>.supabase.co/auth/v1/callback`; enable Google in Supabase Auth; site URL `https://slatiner.github.io/recipe-library/`, extra redirect `http://localhost:5173`.
- [ ] **Step 4:** Owner signs in once; add the owner as admin with `insert into members (user_id, is_admin) select id, true from auth.users where email = 'nslatiner@gmail.com';` via `supabase db query` or the SQL editor.
- [ ] **Step 5:** Repo secrets for the workflows (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_URL`, `AGE_RECIPIENT` with a new age key kept as `recipe-library-backup.key`, gitignored). Run keep-alive once via `workflow_dispatch` → green.
- [ ] **Step 6:** Owner checks in Chrome: sign in on `npm run dev`, sees `No recipes yet.`, creates an invite. Then ROADMAP Phase 0 → ✅, close issues.
