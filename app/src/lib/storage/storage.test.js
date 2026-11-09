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
          const data = q.table === 'members' ? db.member : (tables[q.table] ?? []);
          return (resolve) => resolve({ data, error });
        }
        return (...args) => { q.calls.push([prop, ...args]); return chain; };
      },
    });
    return chain;
  };
  return {
    log,
    db,
    from: builder,
    rpc: async (name, args) => { log.push({ rpc: name, args }); return rpc[name] || { data: null, error: null }; },
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      signInWithOAuth: async (opts) => { log.push({ oauth: opts }); return { error: null }; },
      signOut: async (opts) => { log.push({ signOut: opts || true }); return { error: null }; },
    },
  };
}

const session = {
  access_token: 'tok',
  user: { id: 'u1', email: 'me@example.com', created_at: '2026-11-01T00:00:00Z', user_metadata: { full_name: 'Ada Lovelace', avatar_url: 'https://pic' } },
};

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

  it('exports the account, membership, invites created and access request', async () => {
    const { storage } = adapterWith({ session, tables: { invites: [], access_requests: [] } });
    await storage.init();
    const out = await storage.exportAccount();
    expect(Object.keys(out)).toEqual(['exportedAt', 'account', 'membership', 'invitesCreated', 'accessRequest']);
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
});
