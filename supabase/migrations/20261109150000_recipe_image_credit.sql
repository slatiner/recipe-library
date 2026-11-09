-- Where a card's photo comes from, and its credit. 'site' is the recipe site's
-- own photo (a link, kept off the public page); 'stock' is one the owner picked
-- from Pexels, shown with the photographer's credit, public page included.
-- Phase 4 adds 'upload'.

alter table public.recipes
  add column image_source     text check (image_source in ('site', 'stock')),
  add column image_credit     text check (length(image_credit) <= 200),
  add column image_credit_url text check (image_credit_url ~* '^https?://' and length(image_credit_url) <= 2000);

-- Photos saved before this migration came from recipe sites.
update public.recipes set image_source = 'site' where image_url is not null;

-- A photo says where it came from; no photo, no source or credit.
alter table public.recipes add constraint recipes_image_fields check (
  (image_url is null and image_source is null and image_credit is null and image_credit_url is null)
  or (image_url is not null and image_source is not null)
);
