// Component tests: mount the real app with a fake storage adapter, then click
// through it. Real Google sign-in and the database can't be simulated here.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

let state, App, adapter;
let accessRequests = [];

// connState is what init() reports: 'ok' (member), 'needsInvite' or 'signedOut'.
function fakeAdapter(connState = 'ok', { isAdmin = false } = {}) {
  const calls = [];
  const account = 'me@example.com';
  const profile = { name: 'Ada Lovelace', avatarUrl: '', isAdmin };
  return {
    kind: 'supabase',
    calls,
    async init() {
      const signedIn = connState === 'ok' || connState === 'needsInvite';
      state.setConnection(connState, connState === 'ok' ? 'Connected' : 'Not connected', signedIn ? account : '', signedIn ? profile : null);
      return connState === 'ok' ? [] : null;
    },
    async connect() { calls.push(['connect']); return null; },
    async reconnect() { state.setConnection('ok', 'Connected', account, profile); return []; },
    async signOut() { calls.push(['signOut']); state.setConnection('signedOut', 'Signed out.'); },
    // 'GOOD-CODE' joins; anything else is rejected like the database does.
    async redeemInvite(code) {
      calls.push(['redeem', code]);
      if (code !== 'GOOD-CODE') throw new Error("That invite code isn't valid. Check it and try again.");
      state.setConnection('ok', 'Connected', account, profile);
      return [];
    },
    async requestAccess(message) { calls.push(['requestAccess', message]); },
    async createInvite() { calls.push(['createInvite']); return { code: 'ABCD-1234-EF56', expiresAt: '2099-10-30T00:00:00Z' }; },
    async listInvites() { return [{ code: 'ABCD-1234-EF56', createdAt: '2026-11-09T00:00:00Z', expiresAt: '2099-10-30T00:00:00Z', usedAt: null }]; },
    async listAccessRequests() { return structuredClone(accessRequests); },
    async dismissAccessRequest(userId) { calls.push(['dismiss', userId]); },
    async exportAccount() {
      calls.push(['exportAccount']);
      return { exportedAt: '2026-11-09T10:00:00.000Z', account: { email: account }, membership: null, invitesCreated: [], accessRequest: null };
    },
    async deleteAccount() { calls.push(['deleteAccount']); state.setConnection('signedOut', 'Your account and its data have been deleted.'); },
    async llmEndpoint() { return null; },
  };
}

async function mountApp(connState = 'ok', opts) {
  vi.resetModules();
  state = await import('./state.js');
  App = (await import('./App.vue')).default;
  adapter = fakeAdapter(connState, opts);
  state.useStorage(adapter);
  const wrapper = mount(App, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}

const menuLabels = (w) => w.findAll('.account-menu .popover button').map((b) => b.text());

beforeEach(() => {
  document.body.innerHTML = '';
  accessRequests = [];
  try { localStorage.clear(); } catch (e) { /* jsdom without storage */ }
});

describe('signing in', () => {
  it('signed out: shows only the sign-in button, which starts Google sign-in', async () => {
    const w = await mountApp('signedOut');
    expect(w.text()).not.toContain('No recipes yet.');
    expect(w.find('.avatar-btn').exists()).toBe(false);
    await w.findAll('button').find((b) => b.text() === 'Sign in with Google').trigger('click');
    expect(adapter.calls).toEqual([['connect']]);
  });

  it('the header shows the app name', async () => {
    const w = await mountApp();
    expect(w.find('header.top h1.logo').text()).toContain('Recipe Library');
  });

  it('a member sees the empty library; the menu has Your data and Sign out, not Invite', async () => {
    const w = await mountApp();
    expect(w.text()).toContain('No recipes yet.');
    await w.find('.avatar-btn').trigger('click');
    expect(w.find('.account-menu .menu-who').text()).toContain('me@example.com');
    expect(menuLabels(w)).toEqual(['Your data', 'Sign out']);
  });

  it('Sign out returns to the sign-in screen', async () => {
    const w = await mountApp();
    await w.find('.avatar-btn').trigger('click');
    await w.findAll('.account-menu .popover button').find((b) => b.text() === 'Sign out').trigger('click');
    await flushPromises();
    expect(adapter.calls.at(-1)).toEqual(['signOut']);
    expect(w.text()).toContain('Sign in with Google');
    expect(w.text()).not.toContain('No recipes yet.');
  });

  it('Escape closes the account menu', async () => {
    const w = await mountApp();
    await w.find('.avatar-btn').trigger('click');
    expect(w.find('.account-menu .popover').classes()).toContain('open');
    await w.find('.account-menu').trigger('keydown', { key: 'Escape' });
    expect(w.find('.account-menu .popover').classes()).not.toContain('open');
  });
});

describe('invites', () => {
  it('without an invite: only the code field and the request form, no library or menu', async () => {
    const w = await mountApp('needsInvite');
    expect(w.find('.redeem').text()).toContain('me@example.com');
    expect(w.find('.request-access').exists()).toBe(true);
    expect(w.text()).not.toContain('No recipes yet.');
    expect(w.find('.avatar-btn').exists()).toBe(false);
    expect(w.findAll('button').map((b) => b.text())).not.toContain('Invite someone');
  });

  it('a bad code shows the error; a good one opens the library', async () => {
    const w = await mountApp('needsInvite');
    await w.find('.redeem input').setValue('nope');
    await w.find('.redeem').trigger('submit');
    await flushPromises();
    expect(w.find('.redeem-error').text()).toBe("That invite code isn't valid. Check it and try again.");
    await w.find('.redeem input').setValue('GOOD-CODE');
    await w.find('.redeem').trigger('submit');
    await flushPromises();
    expect(adapter.calls.at(-1)).toEqual(['redeem', 'GOOD-CODE']);
    expect(w.find('.redeem').exists()).toBe(false);
    expect(w.text()).toContain('No recipes yet.');
  });

  it('asking for a code sends the message and says so', async () => {
    const w = await mountApp('needsInvite');
    await w.find('.request-access textarea').setValue('Hi, Ada sent me');
    await w.find('.request-access').trigger('submit');
    await flushPromises();
    expect(adapter.calls.at(-1)).toEqual(['requestAccess', 'Hi, Ada sent me']);
    expect(w.find('.request-access').text()).toContain('Request sent');
  });

  it('an invite link survives the sign-in round trip and fills in the code', async () => {
    window.history.replaceState(null, '', '/?invite=AAAA-BBBB-CCCC');
    let w = await mountApp('signedOut');
    expect(w.text()).toContain("You've been invited");
    expect(window.location.search).toBe('');
    w.unmount();
    w = await mountApp('needsInvite');
    expect(w.find('.redeem input').element.value).toBe('AAAA-BBBB-CCCC');
  });

  it('only admins see Invite someone; it creates a code', async () => {
    const w = await mountApp('ok', { isAdmin: true });
    await w.find('.avatar-btn').trigger('click');
    expect(menuLabels(w)).toEqual(['Invite someone', 'Your data', 'Sign out']);
    await w.findAll('.account-menu .popover button').find((b) => b.text() === 'Invite someone').trigger('click');
    await flushPromises();
    await w.findAll('button').find((b) => b.text() === 'Create invite code').trigger('click');
    await flushPromises();
    expect(adapter.calls.at(-1)).toEqual(['createInvite']);
    expect(w.find('.invite-code').text()).toBe('ABCD-1234-EF56');
  });
});

describe('your data', () => {
  it('deleting the account needs "delete" typed, then signs out', async () => {
    const w = await mountApp();
    await w.find('.avatar-btn').trigger('click');
    await w.findAll('.account-menu .popover button').find((b) => b.text() === 'Your data').trigger('click');
    await flushPromises();
    await w.findAll('button').find((b) => b.text() === 'Delete my account…').trigger('click');
    const del = w.findAll('button').find((b) => b.text() === 'Delete everything');
    expect(del.attributes('disabled')).toBeDefined();
    await w.find('.account-delete input').setValue('delete');
    await w.find('.account-delete form').trigger('submit');
    await flushPromises();
    expect(adapter.calls.at(-1)).toEqual(['deleteAccount']);
    expect(w.text()).toContain('Sign in with Google');
  });
});
