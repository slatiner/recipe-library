# Recipe Library: design

Date: 2026-11-09. Status: draft for owner review.

## Intent

A personal recipe library, built like Content_Project (the media library). The
owner pastes a recipe from anywhere (copied text, an Instagram post, a recipe
website, later YouTube) and the app turns it into a clean recipe card that can be
saved, starred, shared by public link and turned into a shopping list.

**Owner said:** separate from Content_Project; invite-based multi-user like
Content_Project; Instagram and YouTube matter; shopping list = copy text for
WhatsApp or Reminders; share = public link; English only; the LLM converts to
metric in v1, a metric/US setting comes later; optional title field next to the
paste box.

**Assumed (correct me):** same constraints as Content_Project (MIT, open source,
no paid dependencies beyond hosting); phone-first UI; no images on cards in v1.

**Success for v1 (Phases 0–3):** paste an Instagram link or text → a correct,
editable card in under ~10 s; find it again by search, tag or star; send a
public link; copy a merged shopping list for several recipes.

## Constraints

- MIT, public repo. No paid dependencies; hosting is the only accepted cost.
- Same stack and house style as Content_Project: Vue 3 + Vite, plain JS, no
  Pinia, Vitest + Vue Test Utils, Supabase (free tier), GitHub Pages.
- Secrets in gitignored `secrets.json`; LLM and fetch keys only in Supabase's
  secret store, never in the browser.
- The Groq free quota (1,000 requests/day, 8,000 tokens/min for
  `gpt-oss-20b`, per Content_Project's 2026-10-08 check) is shared by all users.

## What is ported from Content_Project

| Take as-is (rename only) | Port the pattern, rewrite content | Leave behind |
|---|---|---|
| Vite/Vitest config (`app/` only served), `.gitignore`, secrets convention | `lib/storage/` adapter → recipes | `lookup.js` (Wikidata, MusicBrainz, Open Library…) |
| Supabase auth: Google sign-in, `members`/`invites`, `is_member()`, account deletion | `state.js` | `MediumIcon`, wishlist, visibility levels |
| `groq` edge function (member-only, daily limit) | `llm.js` (recipe schema + prompts) | File-folder storage mode, `import-json`/`backfill-ids` scripts |
| `Modal`, `Avatar`, `Stars`, `GoogleButton`, `SettingsMenu`, `AccountDialog`, `InviteDialog`, `BackupDialog`, `scrollChrome`, base `styles.css` | `EntryCard`/`EntryDialog` → `RecipeCard`/`RecipeDialog`; `FilterBar`; `SharedItem` → public recipe page | Media-specific migrations |
| Workflows: Pages deploy, keep-alive, encrypted backup; pgTAP test layout; CLAUDE.md working rules | | |

## Architecture

```
Browser (Vue app on GitHub Pages)
  ├─ storage adapter ──► Supabase Postgres (recipes, members, invites) with RLS
  ├─ llm.js ───────────► edge fn `groq`        ──► Groq (parse, suggest method)
  └─ import ───────────► edge fn `import-url`  ──► recipe site / instagram embed  (Phase 2)
Public share page ─────► RPC get_shared_recipe(token) (no sign-in)               (Phase 3)
```

Components have one job each: the storage adapter is the only thing that talks
to tables; `llm.js` is the only thing that builds prompts; `import-url` only
fetches and extracts raw text or structured data, it never calls the LLM.

## Data model

One table, per user (no shared catalogue).

`recipes`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| owner | uuid → auth.users | RLS: owner and member only |
| title | text not null | |
| summary | text | one or two lines from the source |
| servings | int null | |
| prep_minutes, cook_minutes | int null | |
| ingredients | jsonb | `[{group, amount, unit, item, note}]`; `amount` numeric or null ("pinch"), `unit` metric (`g`, `kg`, `ml`, `l`, `tsp`, `tbsp`, `pc`) or null |
| steps | jsonb | `[{text}]` |
| steps_origin | text | `source` \| `ai_suggested` \| `user` |
| tags | text[] | |
| notes | text | tips from the source |
| source_kind | text | `text` \| `instagram` \| `web` \| `youtube` |
| source_url | text null | |
| source_author | text null | e.g. Instagram handle |
| source_text | text | the raw pasted/fetched text, kept so a card can be re-parsed |
| starred | bool default false | |
| share_token | uuid null unique | set = public link on (Phase 3) |
| created_at, updated_at | timestamptz | |

Schema changes go in as Supabase CLI migrations, each with pgTAP tests (one
user can't read or write another's recipes; non-members can't do anything;
the share RPC returns only shared rows and no `owner`/`source_text`).

## Flows

**Add from text (Phase 1).** The add sheet has an optional **Title** field and a
**Paste the recipe** textarea. The LLM returns the card fields in metric.
Title rule: if the user typed a title, it is kept as-is and passed to the LLM as
context; if the title is empty and the text contains a clear dish title, the LLM
fills it; otherwise the title stays empty and the preview asks the user for one
(saving needs a title). The user edits the preview, then saves.

**Import a link (Phase 2).** The same sheet accepts a URL in the paste box.
`import-url` fetches it server-side:
- recipe website: schema.org `Recipe` JSON-LD → mapped directly (LLM used only
  to convert units and fill gaps); no JSON-LD → page text to the LLM.
- Instagram post/reel: the public `/embed/captioned/` page → caption text → the
  LLM. Spike on 2026-11-09: a plain request returned the full caption (HTTP 200,
  no login wall). Unofficial and against Meta's automated-access terms; may break
  or be blocked from Supabase IPs. Fallback: "Couldn't read that post. Paste the
  caption instead."

**Missing steps (Phase 2).** Many posts list ingredients and say "full recipe on
my website". The card is flagged *Steps missing* and offers:
- **Suggest a method**: a second LLM call from title + ingredients + notes;
  saved with `steps_origin = ai_suggested` and shown with an "AI suggested, may
  differ from the creator's" badge. Never automatic.
- **Paste steps / website link**: text is parsed into steps; a link goes
  through `import-url`.

**Share (Phase 3).** "Share link" sets `share_token` and copies
`…/#/r/<token>`; "Stop sharing" clears it. The public page renders via a
security-definer RPC, read-only, no sign-in.

**Shopping list (Phase 3).** Select recipes → "Generate shopping list" → merge
ingredients by normalised item + unit (sums amounts; keeps unmergeable lines
separate) → plain text copied to the clipboard, one item per line, recipe names
as a header. Nothing is stored.

## Error handling

- LLM: strict JSON schema, `reasoning_effort: medium`, one retry on
  `json_validate_failed` (Content_Project's findings). Daily-limit 429 gets a
  specific message.
- Import: every failure ends in the paste fallback with the reason (blocked,
  not a recipe, timeout), never a dead end.
- Save errors keep the preview open with the user's edits intact.

## Testing

- Vitest component tests with a fake storage adapter and fake network (as in
  Content_Project's `app.test.js`).
- Unit tests for the JSON-LD mapper, the Instagram caption extractor (on a
  saved fixture page), the title rule and the shopping-list merge.
- pgTAP for RLS and the share RPC.
- Not covered automatically: live Instagram/website fetches, real LLM output
  quality, Google sign-in. The owner checks those in Chrome.

## Open questions

- `gpt-oss-120b` for *Suggest a method*: check its free-tier limits on Groq
  before choosing it over `gpt-oss-20b`.
- App name and logo (working name: Recipe Library).
