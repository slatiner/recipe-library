// Supabase version of the storage adapter (see ./index.js). Signs in with
// Google. Row-level security limits every query to the signed-in user's rows.
// A new account has to redeem an invite code before it can read or write
// anything.
import { createClient } from '@supabase/supabase-js';

// A recipe in the app is camelCase; the table is snake_case. The database sets
// id, owner, share_token and the timestamps, so they are never sent.
function fromRow(r) {
  return {
    id: r.id, title: r.title, summary: r.summary, servings: r.servings,
    prepMinutes: r.prep_minutes, cookMinutes: r.cook_minutes,
    ingredients: r.ingredients, steps: r.steps, stepsOrigin: r.steps_origin,
    tags: r.tags, notes: r.notes,
    sourceKind: r.source_kind, sourceUrl: r.source_url, sourceAuthor: r.source_author, sourceText: r.source_text,
    starred: r.starred, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toRow(r) {
  return {
    title: r.title, summary: r.summary, servings: r.servings,
    prep_minutes: r.prepMinutes, cook_minutes: r.cookMinutes,
    ingredients: r.ingredients, steps: r.steps, steps_origin: r.stepsOrigin,
    tags: r.tags, notes: r.notes,
    source_kind: r.sourceKind, source_url: r.sourceUrl, source_author: r.sourceAuthor, source_text: r.sourceText,
    starred: r.starred,
  };
}

export function createSupabaseStorage(setStatus, { url, key, client } = {}) {
  const sb = client || createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } });
  let user = null;
  let isAdmin = false;

  function fail(what, error) {
    throw new Error(`${what}: ${(error && error.message) || error}`);
  }

  async function loadAll() {
    const { data, error } = await sb.from('recipes').select('*').order('created_at', { ascending: false });
    if (error) fail('Could not load your recipes', error);
    return data.map(fromRow);
  }

  // Google's name and picture come with the default sign-in scopes.
  function profile() {
    const m = (user && user.user_metadata) || {};
    return { name: m.full_name || m.name || '', avatarUrl: m.avatar_url || m.picture || '', isAdmin };
  }

  async function startSession(session) {
    user = session.user;
    try {
      const { data: member, error } = await sb.from('members').select('is_admin').eq('user_id', user.id).maybeSingle();
      if (error) fail('Could not check your account', error);
      if (!member) {
        isAdmin = false;
        setStatus('needsInvite', 'Enter your invite code to finish signing up.', user.email, profile());
        return null;
      }
      isAdmin = member.is_admin;
      const recipes = await loadAll();
      setStatus('ok', `Signed in as ${user.email}`, user.email, profile());
      return recipes;
    } catch (e) {
      setStatus('warn', `${e.message}. Check your connection, then click Retry.`, user.email, profile());
      return null;
    }
  }

  return {
    kind: 'supabase',

    async init() {
      const { data, error } = await sb.auth.getSession();
      if (error) { setStatus('warn', `Sign-in failed: ${error.message}. Try signing in again.`); return null; }
      if (!data.session) { setStatus('signedOut', 'Sign in to see your recipes.'); return null; }
      return startSession(data.session);
    },

    // Sign in with Google. The browser leaves the page and comes back signed in.
    async connect() {
      const redirectTo = window.location.origin + window.location.pathname;
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
      if (error) setStatus('signedOut', `Could not start Google sign-in: ${error.message}`);
      return null;
    },

    // Retry loading after an error.
    reconnect() { return this.init(); },

    async signOut() {
      await sb.auth.signOut();
      user = null;
      isAdmin = false;
      setStatus('signedOut', 'Signed out.');
    },

    // Redeem an invite code; on success loads the library. Throws the
    // database's message ("already used", "expired"...) on failure.
    async redeemInvite(code) {
      const { error } = await sb.rpc('redeem_invite', { p_code: code });
      if (error) throw new Error(error.message);
      const { data } = await sb.auth.getSession();
      return startSession(data.session);
    },

    // Ask the admins for a code (signed in, not yet a member). Throws the
    // database's message on failure.
    async requestAccess(message) {
      const { error } = await sb.rpc('request_access', { p_message: message });
      if (error) throw new Error(error.message);
    },

    // Admins only: pending requests, newest first, as { userId, email, name, message, createdAt }.
    async listAccessRequests() {
      const { data, error } = await sb.from('access_requests').select('user_id, email, name, message, created_at')
        .order('created_at', { ascending: false });
      if (error) fail('Could not load requests', error);
      return data.map((r) => ({ userId: r.user_id, email: r.email, name: r.name, message: r.message, createdAt: r.created_at }));
    },

    async dismissAccessRequest(userId) {
      const { error } = await sb.from('access_requests').delete().eq('user_id', userId);
      if (error) fail('Could not dismiss the request', error);
    },

    // Admins only: a new single-use code, as { code, expiresAt }.
    async createInvite() {
      const { data, error } = await sb.rpc('create_invite');
      if (error) fail('Could not create an invite', error);
      return { code: data.code, expiresAt: data.expires_at };
    },

    // Admins only: recent invites, newest first, as { code, createdAt, expiresAt, usedAt }.
    async listInvites() {
      const { data, error } = await sb.from('invites').select('code, created_at, expires_at, used_at')
        .order('created_at', { ascending: false }).limit(20);
      if (error) fail('Could not load invites', error);
      return data.map((r) => ({ code: r.code, createdAt: r.created_at, expiresAt: r.expires_at, usedAt: r.used_at }));
    },

    // ---- Recipes ----

    // Inserts a recipe without an id, otherwise updates it. Returns the stored card.
    async saveRecipe(recipe) {
      const q = recipe.id
        ? sb.from('recipes').update(toRow(recipe)).eq('id', recipe.id)
        : sb.from('recipes').insert(toRow(recipe));
      const { data, error } = await q.select().single();
      if (error) fail('Could not save the recipe', error);
      return fromRow(data);
    },

    async deleteRecipe(id) {
      const { error } = await sb.from('recipes').delete().eq('id', id);
      if (error) fail('Could not delete the recipe', error);
    },

    async setStarred(id, starred) {
      const { error } = await sb.from('recipes').update({ starred }).eq('id', id);
      if (error) fail('Could not update the star', error);
    },

    // ---- Your data ----

    // Everything stored for this account, as one object for a JSON download.
    // Invites only those this account created; recipes oldest first.
    async exportAccount() {
      const [member, invites, request, recipes] = await Promise.all([
        sb.from('members').select('is_admin, joined_at').eq('user_id', user.id).maybeSingle(),
        sb.from('invites').select('code, created_at, expires_at, used_at').eq('created_by', user.id).order('created_at'),
        sb.from('access_requests').select('message, created_at').eq('user_id', user.id).limit(1),
        sb.from('recipes').select('*').order('created_at'),
      ]);
      const failed = [member, invites, request, recipes].find((r) => r.error);
      if (failed) fail('Could not export your data', failed.error);
      const m = user.user_metadata || {};
      return {
        exportedAt: new Date().toISOString(),
        account: { email: user.email, name: m.full_name || m.name || '', avatarUrl: m.avatar_url || m.picture || '', createdAt: user.created_at },
        membership: member.data && { isAdmin: member.data.is_admin, joinedAt: member.data.joined_at },
        invitesCreated: invites.data.map((r) => ({ code: r.code, createdAt: r.created_at, expiresAt: r.expires_at, usedAt: r.used_at })),
        accessRequest: request.data[0] ? { message: request.data[0].message, createdAt: request.data[0].created_at } : null,
        recipes: recipes.data.map((r) => { const { id, ...rest } = fromRow(r); return rest; }),
      };
    },

    // Deletes the account and all its data right away, then signs out. Throws the
    // database's message (e.g. the last admin) on failure.
    async deleteAccount() {
      const { error } = await sb.rpc('delete_my_account');
      if (error) throw new Error(error.message);
      await sb.auth.signOut({ scope: 'local' });
      user = null;
      isAdmin = false;
      setStatus('signedOut', 'Your account and its data have been deleted.');
    },

    // The assistant's Groq proxy (supabase/functions/groq), called with the
    // signed-in user's token. null when signed out.
    async llmEndpoint() {
      const { data } = await sb.auth.getSession();
      const token = data && data.session && data.session.access_token;
      if (!token) return null;
      return { url: `${url}/functions/v1/groq`, headers: { Authorization: `Bearer ${token}`, apikey: key } };
    },
  };
}
