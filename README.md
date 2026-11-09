# Recipe Library

A personal recipe library: paste a recipe from anywhere (copied text, an
Instagram post, a recipe website) and get a clean recipe card you can save,
star, share by link and turn into a shopping list. Invite-only, built with
Vue 3 + Vite and Supabase. MIT licensed.

Status and plans: [ROADMAP.md](ROADMAP.md).

## Development

```sh
npm install
npm run dev          # http://localhost:5173
supabase start       # local database (ports 54421–54424)
npm test             # component and adapter tests
npm run test:db      # database rules (needs supabase start)
```

Keys go in `secrets.json` (gitignored); see `secrets.example.json` for the shape.
