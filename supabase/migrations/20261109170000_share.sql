-- Share links. The owner turns sharing on (share_recipe makes a random token,
-- kept until stop_sharing clears it). Anyone with the token, signed in or not,
-- reads the recipe through get_shared_recipe, which returns only the public
-- fields: never the owner, ids, source text, star, list, date cooked or
-- timestamps, and a photo only when it's a credited stock photo (a recipe
-- site's own photo is theirs, not ours to republish).

-- Security invoker: RLS limits the update to the caller's own recipes.
create function public.share_recipe(p_id uuid) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_token uuid;
begin
  update public.recipes
     set share_token = coalesce(share_token, gen_random_uuid())
   where id = p_id
  returning share_token into v_token;
  if v_token is null then
    raise exception 'Recipe not found' using errcode = 'P0002';
  end if;
  return v_token;
end;
$$;

create function public.stop_sharing(p_id uuid) returns void
language sql
set search_path = ''
as $$
  update public.recipes set share_token = null where id = p_id;
$$;

create function public.get_shared_recipe(p_token uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'title', r.title, 'summary', r.summary, 'servings', r.servings,
           'prep_minutes', r.prep_minutes, 'cook_minutes', r.cook_minutes,
           'ingredients', r.ingredients, 'steps', r.steps, 'steps_origin', r.steps_origin,
           'tags', r.tags, 'notes', r.notes,
           'source_kind', r.source_kind, 'source_url', r.source_url, 'source_author', r.source_author)
         || case when r.image_source = 'stock'
              then jsonb_build_object('image_url', r.image_url, 'image_credit', r.image_credit,
                                      'image_credit_url', r.image_credit_url)
              else '{}'::jsonb end
    from public.recipes r
   where r.share_token = p_token;
$$;

revoke execute on function public.share_recipe(uuid), public.stop_sharing(uuid), public.get_shared_recipe(uuid) from public, anon, authenticated;
grant execute on function public.share_recipe(uuid), public.stop_sharing(uuid) to authenticated;
grant execute on function public.get_shared_recipe(uuid) to anon, authenticated;
