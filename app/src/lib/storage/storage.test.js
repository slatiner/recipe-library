import { describe, it, expect } from 'vitest';
import { createSupabaseStorage } from './supabaseStorage.js';

// A fake supabase-js client. Query builders record their calls and resolve
// to { data, error } when awaited.
// member is the caller's members row (null = hasn't redeemed an invite); rpc
// maps a function name to its { data, error }; tables maps a table to its data.
function fakeClient({ session = null, error = null, member = { is_admin: false, joined_at: '2026-11-09T00:00:00Z' }, rpc = {}, tables = {} } = {}) {
  const log = [];
  const db = { member }; // tests change db.member to simulate the database
  const builder = (table) => {
    const q = { table, calls: [] };
    const chain = new Proxy(q, {
      get(target, prop) {
        if (prop === 'then') {
          log.push(q);
          // .single() after an insert or update echoes the written row back, as the database would.
          const written = q.calls.find((c) => c[0] === 'insert' || c[0] === 'update');
          const data = q.table === 'members' ? db.member
            : q.calls.some((c) => c[0] === 'single') ? { id: 'r-new', created_at: 'c', updated_at: 'u', ...(written && written[1]) }
            : (tables[q.table] ?? []);
          const err = client.failNext || error;
          client.failNext = null;
          return (resolve) => resolve({ data, error: err });
        }
        return (...args) => { q.calls.push([prop, ...args]); return chain; };
      },
    });
    return chain;
  };
  const client = {
    log,
    db,
    failNext: null,
    from: builder,
    rpc: async (name, args) => { log.push({ rpc: name, args }); return rpc[name] || { data: null, error: null }; },
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      signInWithOAuth: async (opts) => { log.push({ oauth: opts }); return { error: null }; },
      signOut: async (opts) => { log.push({ signOut: opts || true }); return { error: null }; },
    },
  };
  return client;
}

const session = {
  access_token: 'tok',
  user: { id: 'u1', email: 'me@example.com', created_at: '2026-11-01T00:00:00Z', user_metadata: { full_name: 'Ada Lovelace', avatar_url: 'https://pic' } },
};

const row = {
  id: 'r1', owner: 'u1', title: 'Tomato soup', summary: 'Quick.', servings: 4, prep_minutes: 10, cook_minutes: 30,
  ingredients: [{ group: null, amount: 800, unit: 'g', item: 'tomatoes', note: null }], steps: [{ text: 'Cook.' }],
  steps_origin: 'source', tags: ['soup'], notes: null, source_kind: 'text', source_url: null, source_author: null, image_url: 'https://example.com/a.jpg', image_source: 'site', image_credit: null, image_credit_url: null, status: 'cooked', cooked_on: '2026-11-01',
  source_text: 'raw', starred: false, share_token: null, created_at: '2026-11-09T10:00:00Z', updated_at: '2026-11-09T11:00:00Z',
};
const recipe = {
  id: 'r1', title: 'Tomato soup', summary: 'Quick.', servings: 4, prepMinutes: 10, cookMinutes: 30,
  ingredients: [{ group: null, amount: 800, unit: 'g', item: 'tomatoes', note: null }], steps: [{ text: 'Cook.' }],
  stepsOrigin: 'source', tags: ['soup'], notes: null, sourceKind: 'text', sourceUrl: null, sourceAuthor: null,
  sourceText: 'raw', imageUrl: 'https://example.com/a.jpg', imageSource: 'site', imageCredit: null, imageCreditUrl: null, status: 'cooked', cookedOn: '2026-11-01', shareToken: null, starred: false, createdAt: '2026-11-09T10:00:00Z', updatedAt: '2026-11-09T11:00:00Z',
};
// What toRow sends: everything but id, owner, share_token and the timestamps.
const { id: _i, owner: _o, share_token: _s, created_at: _c, updated_at: _u, ...toRowFields } = row;

function adapterWith(clientOpts) {
  const status = [];
  const client = fakeClient(clientOpts);
  const storage = createSupabaseStorage((...s) => status.push(s), { url: 'https://ref.supabase.co', key: 'pk', client });
  return { storage, client, status };
}

describe('Supabase adapter', () => {
  it('without a session reports signedOut and loads nothing', async () => {
    const { storage, status } = adapterWith();
    expect(await storage.init()).toBe(null);
    expect(status.at(-1)[0]).toBe('signedOut');
  });

  it('a member is signed in with the Google profile and an empty library', async () => {
    const { storage, status } = adapterWith({ session, member: { is_admin: true } });
    expect(await storage.init()).toEqual([]);
    expect(status.at(-1)).toEqual(['ok', 'Signed in as me@example.com', 'me@example.com', { name: 'Ada Lovelace', avatarUrl: 'https://pic', isAdmin: true }]);
  });

  it('a load error is reported, not thrown', async () => {
    const { storage, status } = adapterWith({ session, error: { message: 'boom' } });
    expect(await storage.init()).toBe(null);
    expect(status.at(-1)[0]).toBe('warn');
    expect(status.at(-1)[1]).toContain('boom');
  });

  it('sign-in uses Google and returns to this page', async () => {
    const { storage, client } = adapterWith();
    await storage.connect();
    expect(client.log[0].oauth).toEqual({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname } });
  });

  it('an account without an invite is asked for one and loads nothing', async () => {
    const { storage, status } = adapterWith({ session, member: null });
    expect(await storage.init()).toBe(null);
    expect(status.at(-1)[0]).toBe('needsInvite');
  });

  it('redeeming an invite calls redeem_invite, then signs in', async () => {
    const { storage, client, status } = adapterWith({ session, member: null });
    await storage.init();
    client.log.length = 0;
    client.db.member = { is_admin: false }; // what redeem_invite does
    expect(await storage.redeemInvite('abcd-1234-ef56')).toEqual([]);
    expect(client.log[0]).toEqual({ rpc: 'redeem_invite', args: { p_code: 'abcd-1234-ef56' } });
    expect(status.at(-1)[0]).toBe('ok');
  });

  it('a rejected invite code throws the database message', async () => {
    const msg = "That invite code isn't valid. Check it and try again.";
    const { storage } = adapterWith({ session, member: null, rpc: { redeem_invite: { data: null, error: { message: msg } } } });
    await storage.init();
    await expect(storage.redeemInvite('BAD')).rejects.toThrow(msg);
  });

  it('exports the account, membership, invites created, access request and recipes', async () => {
    const { storage } = adapterWith({ session, tables: { invites: [], access_requests: [], recipes: [row] } });
    await storage.init();
    const out = await storage.exportAccount();
    expect(Object.keys(out)).toEqual(['exportedAt', 'account', 'membership', 'invitesCreated', 'accessRequest', 'recipes']);
    expect(out.recipes[0].title).toBe('Tomato soup');
    expect(out.recipes[0].id).toBeUndefined();
    expect(out.account).toEqual({ email: 'me@example.com', name: 'Ada Lovelace', avatarUrl: 'https://pic', createdAt: '2026-11-01T00:00:00Z' });
    expect(out.membership).toEqual({ isAdmin: false, joinedAt: '2026-11-09T00:00:00Z' });
    expect(out.accessRequest).toBe(null);
  });

  it('deleting the account calls delete_my_account and signs out', async () => {
    const { storage, client, status } = adapterWith({ session });
    await storage.init();
    await storage.deleteAccount();
    expect(client.log.some((l) => l.rpc === 'delete_my_account')).toBe(true);
    expect(status.at(-1)[0]).toBe('signedOut');
  });

  it('the assistant endpoint is the groq function with the user token', async () => {
    const { storage } = adapterWith({ session });
    expect(await storage.llmEndpoint()).toEqual({
      url: 'https://ref.supabase.co/functions/v1/groq',
      headers: { Authorization: 'Bearer tok', apikey: 'pk' },
    });
  });

  it('no assistant endpoint when signed out', async () => {
    const { storage } = adapterWith();
    expect(await storage.llmEndpoint()).toBe(null);
  });

  it('the link importer is the import-url function with the user token; none when signed out', async () => {
    expect(await adapterWith({ session }).storage.importEndpoint()).toEqual({
      url: 'https://ref.supabase.co/functions/v1/import-url',
      headers: { Authorization: 'Bearer tok', apikey: 'pk' },
    });
    expect(await adapterWith().storage.importEndpoint()).toBe(null);
    expect((await adapterWith({ session }).storage.photoEndpoint()).url).toBe('https://ref.supabase.co/functions/v1/photo-search');
  });

  describe('recipes', () => {
    const recipeQueries = (client) => client.log.filter((q) => q.table === 'recipes');

    it('init loads the recipes newest first, in camelCase', async () => {
      const { storage, client } = adapterWith({ session, tables: { recipes: [row] } });
      expect(await storage.init()).toEqual([recipe]);
      expect(recipeQueries(client)[0].calls).toContainEqual(['order', 'created_at', { ascending: false }]);
    });

    it('saving a new recipe inserts snake_case columns without an id and returns the stored card', async () => {
      const { storage, client } = adapterWith({ session });
      await storage.init();
      const { id, createdAt, updatedAt, ...fresh } = recipe;
      const saved = await storage.saveRecipe(fresh);
      const insert = recipeQueries(client).at(-1).calls.find((c) => c[0] === 'insert')[1];
      expect(insert).toEqual(toRowFields);
      expect(saved).toEqual({ ...fresh, id: 'r-new', createdAt: 'c', updatedAt: 'u' });
    });

    it('saving an existing recipe updates it by id and never sends id, owner or timestamps', async () => {
      const { storage, client } = adapterWith({ session });
      await storage.init();
      await storage.saveRecipe(recipe);
      const q = recipeQueries(client).at(-1);
      expect(q.calls.find((c) => c[0] === 'update')[1]).toEqual(toRowFields);
      expect(q.calls).toContainEqual(['eq', 'id', 'r1']);
    });

    it('deletes by id', async () => {
      const { storage, client } = adapterWith({ session });
      await storage.init();
      await storage.deleteRecipe('r1');
      expect(recipeQueries(client).at(-1).calls).toEqual([['delete'], ['eq', 'id', 'r1']]);
    });

    it('stars by id', async () => {
      const { storage, client } = adapterWith({ session });
      await storage.init();
      await storage.setStarred('r1', true);
      expect(recipeQueries(client).at(-1).calls).toEqual([['update', { starred: true }], ['eq', 'id', 'r1']]);
    });

    it('a failed save throws with the reason', async () => {
      const { storage, client } = adapterWith({ session });
      await storage.init();
      client.failNext = { message: 'offline' };
      await expect(storage.saveRecipe(recipe)).rejects.toThrow('Could not save the recipe: offline');
    });

    it('an edit never sends the share token', async () => {
      const { storage, client } = adapterWith({ session });
      await storage.init();
      await storage.saveRecipe({ ...recipe, shareToken: 't1' });
      expect(recipeQueries(client).at(-1).calls.find((c) => c[0] === 'update')[1]).not.toHaveProperty('share_token');
    });
  });

  describe('sharing', () => {
    it('shares through share_recipe and returns the token', async () => {
      const { storage, client } = adapterWith({ session, rpc: { share_recipe: { data: 't1', error: null } } });
      await storage.init();
      expect(await storage.shareRecipe('r1')).toBe('t1');
      expect(client.log.at(-1)).toEqual({ rpc: 'share_recipe', args: { p_id: 'r1' } });
    });

    it('stops sharing through stop_sharing', async () => {
      const { storage, client } = adapterWith({ session });
      await storage.init();
      await storage.stopSharing('r1');
      expect(client.log.at(-1)).toEqual({ rpc: 'stop_sharing', args: { p_id: 'r1' } });
    });

    it('a shared recipe is read without a session, in camelCase', async () => {
      const shared = {
        title: 'Tomato soup', summary: 'Quick.', servings: 4, prep_minutes: 10, cook_minutes: 30,
        ingredients: row.ingredients, steps: row.steps, steps_origin: 'ai_suggested', tags: ['soup'], notes: 'n',
        source_kind: 'web', source_url: 'https://site', source_author: 'Site',
        image_url: 'https://img', image_credit: 'Jane', image_credit_url: 'https://jane',
      };
      const { storage, client } = adapterWith({ rpc: { get_shared_recipe: { data: shared, error: null } } });
      expect(await storage.getSharedRecipe('t1')).toEqual({
        title: 'Tomato soup', summary: 'Quick.', servings: 4, prepMinutes: 10, cookMinutes: 30,
        ingredients: row.ingredients, steps: row.steps, stepsOrigin: 'ai_suggested', tags: ['soup'], notes: 'n',
        sourceKind: 'web', sourceUrl: 'https://site', sourceAuthor: 'Site',
        imageUrl: 'https://img', imageSource: 'stock', imageCredit: 'Jane', imageCreditUrl: 'https://jane',
      });
      expect(client.log.at(-1)).toEqual({ rpc: 'get_shared_recipe', args: { p_token: 't1' } });
    });

    it('a shared recipe without a photo has none', async () => {
      const { storage } = adapterWith({ rpc: { get_shared_recipe: { data: { title: 'x', ingredients: [], steps: [], tags: [] }, error: null } } });
      const r = await storage.getSharedRecipe('t1');
      expect([r.imageUrl, r.imageSource, r.imageCredit]).toEqual([null, null, null]);
    });

    it('an unknown or revoked token gives null', async () => {
      expect(await adapterWith().storage.getSharedRecipe('t1')).toBe(null);
    });

    it('a token that is not a uuid gives null', async () => {
      const { storage } = adapterWith({ rpc: { get_shared_recipe: { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } } } });
      expect(await storage.getSharedRecipe('nope')).toBe(null);
    });

    it('any other error fails', async () => {
      const { storage } = adapterWith({ rpc: { get_shared_recipe: { data: null, error: { code: '08006', message: 'offline' } } } });
      await expect(storage.getSharedRecipe('t1')).rejects.toThrow('Could not load the recipe: offline');
    });
  });
});
