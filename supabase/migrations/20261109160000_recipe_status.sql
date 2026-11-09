-- Two lists: recipes you've cooked and ones you want to cook. A wish moves to
-- 'cooked' in place, keeping its id, photo and source. cooked_on is the last
-- time it was cooked (optional); a wish has none.

-- Recipes saved before this migration become wishes (most were imported to try).
alter table public.recipes
  add column status    text not null default 'wishlist' check (status in ('cooked', 'wishlist')),
  add column cooked_on date;

alter table public.recipes add constraint recipes_cooked_on_status check (cooked_on is null or status = 'cooked');
