# Working on this repo

## Where project state actually lives

This project is worked on across multiple, unrelated Claude Code sessions. **Do
not rely on conversation history or memory for roadmap/status — it will not be
there in a fresh session.** Always check these instead:

- **`ROADMAP.md`** — the phases, their order, and *why* they're ordered that way.
  Read this first.
- **`docs/superpowers/specs/`** — the design spec; **`docs/superpowers/plans/`**
  — one implementation plan per phase.
- **GitHub Issues** (`gh issue list`) — the live task list, once the GitHub repo
  exists. Each issue belongs to one phase via a `phase-N-*` label and milestone:
  `gh issue list --label phase-1-cards --state open`.

When you finish a piece of work, close the corresponding issue rather than just
saying it's done in chat: the next session needs the state to be true in
GitHub, not just in this transcript.

## Project constraints (see ROADMAP.md for the reasoning)

- Fully open source, MIT licensed.
- No paid dependencies in the core stack; hosting cost is the only accepted
  exception. Any new dependency needs a genuinely free tier or must be
  self-hostable at no cost.
- Separate from Content_Project (`../Content_Project`): own repo, own Supabase
  project. Port code from there, don't import from it.

## Secrets

This repo is public. API keys and tokens live in **`secrets.json`** at the repo
root, which is gitignored (as are `.env` and `.env.*`). `secrets.example.json`
documents the shape and is the only secrets-related file that gets committed.

- Never commit, print, log, or paste a key into code, commit messages, issues, or
  docs. When a command needs a key, read it from `secrets.json` in the shell.
- Add any new secret to `secrets.json` and a placeholder to `secrets.example.json`.
- The Groq key lives only in Supabase's secret store (`GROQ_API_KEY`), used by
  `supabase/functions/groq`. Never put it in `app/`.
- The Vite dev server is restricted to `app/` and `node_modules`
  (`vite.config.js`), so `secrets.json` is never served. Keep it that way, and
  deploy only `dist/`.

## House style

- Vue 3 + Vite with ES modules, in plain JavaScript, without Pinia (shared state
  is in `app/src/state.js`). Keep npm dependencies few and free (MIT or similar).
- All backend reads and writes go through the storage adapter
  (`app/src/lib/storage/`), never straight from components.
- Schema changes are Supabase CLI migrations in `supabase/migrations/`, each
  with pgTAP tests in `supabase/tests/database/`.

## Local development

- `npm run dev` → http://localhost:5173.
- `supabase start` runs the local stack on **shifted ports** (API 54421, DB
  54422, Studio 54423) so it can run next to Content_Project's (5432x).
- `npm test` (Vitest, fake storage adapter) and `npm run test:db` (pgTAP, needs
  `supabase start`).

## How the owner likes to work

Learned over many sessions on Content_Project. Follow these by default.

**Pace and questions**
- Don't over-research small requests; go straight to the file.
- For a non-trivial feature, describe the approach first and call out the real
  decision points, so the owner can steer. Once they've answered, build it
  without asking more questions.
- Lead with the outcome, keep replies short, and be plain about what you could
  not check.
- When a choice has a hidden cost or a terms catch (a paid account, a free tier
  with regional limits, data used for training, scraping terms), say so before
  building on it. Give a recommendation and the main tradeoff; the owner decides.

**Testing**
- The owner tests UI changes themselves in Chrome via `npm run dev`. Don't drive
  the browser or take screenshots to verify; it burns tokens.
- Cheap checks are welcome: `npm run build`, `npm test`, `npm run test:db`. Add a
  test with each change. Say what was and wasn't covered. Real Google sign-in,
  live imports and real LLM output can't be simulated.
- When the owner reports a bug, ask for the exact message they see before
  guessing.

**Git and issues**
- Never push unless asked. Local commits at the end of a finished piece of work
  are fine; say that they're unpushed.
- Check `git status` before committing and make sure `secrets.json` is never
  staged.
- Leave an issue open with a comment ("implemented in <sha>, awaiting
  verification") until the owner has tried the change, then close it. Keep
  `ROADMAP.md`'s status table in step.

**Tokens**
- The owner watches token use. Avoid wide filesystem searches, re-reading large
  files in full, and repeated probing of rate-limited or scraping-sensitive
  sites (Instagram).
- Suggest starting a fresh session at a phase boundary instead of letting a long
  one auto-compact.
