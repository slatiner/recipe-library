# Roadmap

The durable plan: read this first in any session. Live task status will live in
GitHub Issues (one milestone and one `phase-N-*` label per phase) once the
GitHub repo exists. The design is in
`docs/superpowers/specs/2026-11-09-recipe-library-design.md`.

## Constraints

- Fully open source (MIT). No paid dependencies; hosting is the only accepted
  cost.
- Invite-based multi-user from the start, ported from Content_Project.
- English only. Ingredients are stored in metric (v1); a metric/US display
  setting comes later.

## Status

| Phase | Name | Status |
|---|---|---|
| 0 | Scaffold & port | ✅ Done |
| 1 | Recipe card core | ✅ Done |
| 2 | Import from links | 🔲 Not started |
| 3 | Share & shopping | 🔲 Not started |
| 4 | Dish photos | 🔲 Not started |
| 5 | Video sources (experimental) | 🔲 Not started |
| 6 | Polish | 🔲 Not started |

## Phases

### 0. Scaffold & port
New repo, Vue 3 + Vite + Vitest ported from Content_Project. Separate Supabase
project: Google sign-in, members/invites, account deletion, `groq` edge
function with the daily limit. GitHub Pages deploy, keep-alive and backup
workflows. CLAUDE.md, this file, GitHub milestones and labels. The app is an
empty library shell you can sign in to.

### 1. Recipe card core
Add sheet with an optional **Title** field and a **Paste the recipe** textarea.
The LLM turns the text into a card in metric (title, servings, times,
ingredients, steps, tags, notes). If the title is empty and the text has a clear
one, the LLM fills it; otherwise the user is asked for it. Editable preview,
save. Library grid, card view, star, search, tag filter, edit, delete. A
privacy page (what's stored, Groq processing) before inviting anyone.

### 2. Import from links
`import-url` edge function. Recipe websites via schema.org JSON-LD (LLM
fallback). Instagram posts/reels via the public embed caption, with a
paste-the-caption fallback. Cards without steps are flagged and offer **Suggest
a method** (AI, labelled, editable) or **Paste steps / website link**.
A recipe site's own photo (JSON-LD `image` or `og:image`) is kept on the card
as a credited link.

### 3. Share & shopping
Public share link per card (read-only, no sign-in). Select recipes → merged
shopping list copied as plain text for WhatsApp or Reminders.

### 4. Dish photos
Upload a photo of the dish to a card (camera or library on a phone). Resized
in the browser to about 1200 px WebP before upload, stored in a private
Supabase Storage bucket per owner (`image_path` on the recipe), replace and
remove. The photo shows on the card, the library grid and the public share
page. If still wanted after using Phase 2's source photos: an opt-in "Pick a
photo" from Pexels by title, photographer credited.

### 5. Video sources (experimental)
YouTube: description via the official Data API (free key), then a best-effort
transcript. Reels with a spoken-only recipe: audio transcription with Groq
Whisper. Both flagged as fragile.

### 6. Polish
Metric/US setting with conversion on display. Serving scaler. iOS Shortcut in
the share sheet that opens the app with the link filled in. Photo/screenshot
import (vision model).

## Decisions

### Separate from Content_Project (2026-11-09)
Own repo and own Supabase free project. Isolation over reuse; the cost is a
second project that pauses after 7 idle days, covered by its own keep-alive
workflow.

### Instagram import is unofficial (2026-11-09)
Meta has no free, terms-compliant API for other people's post captions (oEmbed
needs app review and returns little). The public `/embed/captioned/` page
returned the full caption in a plain request (spike on reel `DfK2yVrPyDK`).
This is against Meta's automated-access terms and may break or be blocked from
server IPs, so pasting the caption is always the fallback. Posts often omit the
method ("full recipe on my website"), hence *Suggest a method*.

### YouTube and spoken recipes are experimental (2026-11-09)
The official captions API only serves the caller's own videos; unofficial
transcript endpoints are often blocked from server IPs. The description (via
the official Data API) often holds the recipe and comes first.

### AI-suggested methods are opt-in and labelled (2026-11-09)
A generated method is a plausible version, not the creator's: temperatures and
times are guesses. It is only produced on request, stored as
`steps_origin = ai_suggested` and shown with a badge.

### Dish photos are uploads first (2026-11-09)
Supabase Storage on the free plan (about 1 GB of files and 5 GB of egress a
month; check supabase.com/pricing) holds several thousand photos at ~150 KB
each, so no new service is needed. Photos are inserted as Phase 4, after
sharing; video and polish move to 5 and 6.

### Known photos of the dish (2026-11-09)
Options evaluated for showing a photo when a recipe is added:
- **The source's own photo** (JSON-LD `image` or `og:image` from a recipe
  site, fetched by `import-url` in Phase 2): free, and it is the actual dish.
  It is the creator's copyrighted photo: keep it as a link (not a copy) shown
  in the owner's library with a credit, and leave it off public share pages
  unless the owner uploads their own. Instagram thumbnails are signed CDN links
  that expire, so they are skipped.
- **Stock photo search by title** (Pexels or Unsplash, free keys, through an
  edge function so the key stays server side): shows a similar dish, not this
  recipe, so only as an opt-in "Pick a photo" with the photographer credited.
  Pexels: 200 requests/hour, 20,000/month. Unsplash: 50/hour until a manual
  production review, must hotlink and report downloads.
- **AI-generated image**: rejected. No free, reliable image model in the
  stack, and a generated picture misrepresents the dish.
Decided: the source photo in Phase 2 (small: `import-url` already reads the
page), stock search as an opt-in in Phase 4 if still wanted after using it.

### Phase 2 import choices (2026-11-09)
- Every import goes through the LLM, JSON-LD included: it converts US units
  and fills gaps. One request from the daily limit per import.
- `import-url` is member-only but doesn't count against the daily limit; the
  LLM call that follows does.
- *Suggest a method* uses `openai/gpt-oss-120b`: same Groq free-tier limits as
  the 20b model (30/min, 1,000/day per key, per third-party listings), better
  at writing a method from scratch.
