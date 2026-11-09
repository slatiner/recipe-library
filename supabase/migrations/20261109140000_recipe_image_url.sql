-- The source site's own photo (Phase 2): a link to it, not a copy. Shown on
-- the owner's card with a credit; never on the public share page (Phase 3).
-- Only http(s) links, so the page can't be given a javascript: or data: URL.

alter table public.recipes
  add column image_url text check (image_url ~* '^https?://' and length(image_url) <= 2000);
