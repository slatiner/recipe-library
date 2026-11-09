// Component tests: mount the real app with a fake storage adapter, then click
// through it. Real Google sign-in and the database can't be simulated here.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { today } from './lib/recipes.js';

let state, App, adapter;
let accessRequests = [];
// Recipes the fake library starts with, and calls to fail: { save, star, delete } → message.
let seed = [];
let failures = {};
// What llmEndpoint() returns: null (signed out) or the proxy.
let endpoint = null;

function sampleRecipe(over = {}) {
  return {
    id: 'r1', title: 'Tomato soup', summary: 'A quick soup.', servings: 4, prepMinutes: 10, cookMinutes: 30,
    ingredients: [{ group: null, amount: 200, unit: 'g', item: 'flour', note: null }], steps: [{ text: 'Cook.' }],
    stepsOrigin: 'source', tags: ['soup'], notes: null, sourceKind: 'text', sourceUrl: null, sourceAuthor: null,
    sourceText: 'raw', status: 'wishlist', cookedOn: null, starred: false, createdAt: '2026-11-09T10:00:00Z', updatedAt: '2026-11-09T10:00:00Z', ...over,
  };
}

// connState is what init() reports: 'ok' (member), 'needsInvite' or 'signedOut'.
function fakeAdapter(connState = 'ok', { isAdmin = false } = {}) {
  const calls = [];
  const account = 'me@example.com';
  const profile = { name: 'Ada Lovelace', avatarUrl: '', isAdmin };
  return {
    kind: 'supabase',
    calls,
    saved: [],
    async init() {
      const signedIn = connState === 'ok' || connState === 'needsInvite';
      state.setConnection(connState, connState === 'ok' ? 'Connected' : 'Not connected', signedIn ? account : '', signedIn ? profile : null);
      return connState === 'ok' ? structuredClone(seed) : null;
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
    async llmEndpoint() { return endpoint; },
    async importEndpoint() { return endpoint && { url: 'https://fn/import-url', headers: {} }; },
    async photoEndpoint() { return endpoint && { url: 'https://fn/photo-search', headers: {} }; },
    async saveRecipe(recipe) {
      calls.push(['saveRecipe', recipe.id || null]);
      if (failures.save) throw new Error(failures.save);
      this.saved.push(structuredClone(recipe));
      return { ...structuredClone(recipe), id: recipe.id || `r-new-${calls.length}`, updatedAt: 'now', createdAt: recipe.createdAt || 'now' };
    },
    async deleteRecipe(id) {
      calls.push(['deleteRecipe', id]);
      if (failures.delete) throw new Error(failures.delete);
    },
    async setStarred(id, starred) {
      calls.push(['setStarred', id, starred]);
      if (failures.star) throw new Error(failures.star);
    },
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
  seed = [];
  failures = {};
  endpoint = null;
  window.location.hash = '';
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

  it('signing out before redeeming forgets the invite, so the next account on the device doesn\'t get it', async () => {
    window.history.replaceState(null, '', '/?invite=AAAA-BBBB-CCCC');
    let w = await mountApp('signedOut');
    w.unmount();
    w = await mountApp('needsInvite');
    await w.findAll('button').find((b) => b.text() === 'Sign out').trigger('click');
    await flushPromises();
    w.unmount();
    w = await mountApp('signedOut');
    expect(w.text()).not.toContain("You've been invited");
  });

  it('a member who opens an invite link doesn\'t keep the code', async () => {
    window.history.replaceState(null, '', '/?invite=AAAA-BBBB-CCCC');
    await mountApp('ok');
    expect(localStorage.getItem('pendingInvite')).toBe(null);
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

describe('recipe state', () => {
  it('saving a new recipe puts it first in the library', async () => {
    seed = [sampleRecipe()];
    await mountApp();
    const { id, ...fresh } = sampleRecipe({ title: 'Bread' });
    const saved = await state.saveRecipe(fresh);
    expect(saved.id).toMatch(/^r-new/);
    expect(state.recipes.value.map((r) => r.title)).toEqual(['Bread', 'Tomato soup']);
  });

  it('saving an existing recipe replaces it in place', async () => {
    seed = [sampleRecipe(), sampleRecipe({ id: 'r2', title: 'Bread' })];
    await mountApp();
    await state.saveRecipe(sampleRecipe({ id: 'r2', title: 'Rye bread' }));
    expect(state.recipes.value.map((r) => r.title)).toEqual(['Tomato soup', 'Rye bread']);
  });

  it('a failed save throws and leaves the library as it was', async () => {
    seed = [sampleRecipe()];
    await mountApp();
    failures.save = 'Could not save the recipe: offline';
    await expect(state.saveRecipe(sampleRecipe({ title: 'Changed' }))).rejects.toThrow('offline');
    expect(state.recipes.value[0].title).toBe('Tomato soup');
  });

  it('deleting removes the recipe', async () => {
    seed = [sampleRecipe()];
    await mountApp();
    await state.deleteRecipe('r1');
    expect(state.recipes.value).toEqual([]);
  });

  it('toggling the star shows at once and is undone if the save fails', async () => {
    seed = [sampleRecipe()];
    await mountApp();
    await state.toggleStar('r1');
    expect(adapter.calls.at(-1)).toEqual(['setStarred', 'r1', true]);
    expect(state.recipes.value[0].starred).toBe(true);
    failures.star = 'Could not update the star: offline';
    await expect(state.toggleStar('r1')).rejects.toThrow('offline');
    expect(state.recipes.value[0].starred).toBe(true);
  });
});

// A canned Groq answer for the add dialog.
function groqAnswers(...cards) {
  const replies = cards.map((c) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
    isRecipe: true, title: 'Tomato Soup', summary: null, servings: 4, prepMinutes: 10, cookMinutes: 30,
    ingredients: [{ group: null, amount: 200, unit: 'g', item: 'flour', note: null }], steps: ['Cook.'], tags: ['soup'], notes: null, ...c,
  }) } }] }), { status: 200 }));
  globalThis.fetch = vi.fn(async () => replies.shift());
  endpoint = { url: 'https://proxy/groq', headers: {} };
}

async function openAdd(w, { title = '', text = 'tomato soup recipe' } = {}) {
  await w.findAll('button').find((b) => b.text() === 'Add recipe').trigger('click');
  await flushPromises();
  if (title) await w.find('.add-recipe input.add-title').setValue(title);
  await w.find('.add-recipe textarea.paste').setValue(text);
  await w.findAll('.add-recipe button').find((b) => b.text() === 'Make the card').trigger('click');
  await flushPromises();
}

describe('adding a recipe', () => {
  it('Add recipe sits in the header, before the account menu', async () => {
    const w = await mountApp();
    const header = w.find('header.top');
    expect(header.find('.header-right .add-new-btn').text()).toBe('Add recipe');
    expect(header.html().indexOf('add-new-btn')).toBeLessThan(header.html().indexOf('avatar-btn'));
    expect(w.find('.library-bar .add-new-btn').exists()).toBe(false);
  });

  it('opening the sheet puts the cursor in the paste box', async () => {
    const w = await mountApp();
    await w.findAll('button').find((b) => b.text() === 'Add recipe').trigger('click');
    await flushPromises();
    expect(document.activeElement).toBe(w.find('.add-recipe textarea.paste').element);
  });

  it('paste, make the card: the editor shows the parsed card', async () => {
    groqAnswers({});
    const w = await mountApp();
    await openAdd(w);
    expect(w.find('.recipe-editor input.title').element.value).toBe('Tomato Soup');
    const row = w.find('.recipe-editor .ing-row');
    expect(row.find('input.amount').element.value).toBe('200');
    expect(row.find('select.unit').element.value).toBe('g');
    expect(row.find('input.item').element.value).toBe('flour');
  });

  it('no title found: asks for one, and Save waits for it', async () => {
    groqAnswers({ title: null });
    const w = await mountApp();
    await openAdd(w);
    expect(w.find('.recipe-editor').text()).toContain('Give it a title to save it.');
    const save = () => w.findAll('.recipe-editor button').find((b) => b.text() === 'Save');
    expect(save().attributes('disabled')).toBeDefined();
    await w.find('.recipe-editor input.title').setValue('Soup');
    expect(save().attributes('disabled')).toBeUndefined();
  });

  it('text that is not a recipe: the message shows and the text stays', async () => {
    groqAnswers({ isRecipe: false });
    const w = await mountApp();
    await openAdd(w, { text: 'buy milk' });
    expect(w.find('.add-recipe .add-error').text()).toBe("That doesn't look like a recipe. Paste the ingredients and the method.");
    expect(w.find('.add-recipe textarea.paste').element.value).toBe('buy milk');
  });

  it('closing the sheet by accident keeps the pasted text; saving clears it', async () => {
    groqAnswers({});
    const w = await mountApp();
    await w.findAll('button').find((b) => b.text() === 'Add recipe').trigger('click');
    await w.find('.add-recipe textarea.paste').setValue('long recipe');
    await w.find('.overlay.open').trigger('keydown', { key: 'Escape' });
    await w.findAll('button').find((b) => b.text() === 'Add recipe').trigger('click');
    await flushPromises();
    expect(w.find('.add-recipe textarea.paste').element.value).toBe('long recipe');
    await w.findAll('.add-recipe button').find((b) => b.text() === 'Make the card').trigger('click');
    await flushPromises();
    await w.findAll('.recipe-editor button').find((b) => b.text() === 'Save').trigger('click');
    await flushPromises();
    window.location.hash = '#/';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();
    await w.findAll('button').find((b) => b.text() === 'Add recipe').trigger('click');
    await flushPromises();
    expect(w.find('.add-recipe textarea.paste').element.value).toBe('');
  });

  it('a paste over 12,000 characters is refused without asking the assistant', async () => {
    groqAnswers({});
    const w = await mountApp();
    await openAdd(w, { text: 'x'.repeat(12001) });
    expect(w.find('.add-recipe .add-error').text()).toBe("That's over 12,000 characters. Paste just the ingredients and method.");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('a failed save keeps the editor open with the edits', async () => {
    groqAnswers({});
    const w = await mountApp();
    await openAdd(w);
    await w.find('.recipe-editor input.title').setValue('My soup');
    failures.save = 'Could not save the recipe: offline';
    await w.findAll('.recipe-editor button').find((b) => b.text() === 'Save').trigger('click');
    await flushPromises();
    expect(w.find('.recipe-editor .editor-error').text()).toBe('Could not save the recipe: offline');
    expect(w.find('.recipe-editor input.title').element.value).toBe('My soup');
  });

  it('saving adds the card to the library and opens it', async () => {
    groqAnswers({});
    const w = await mountApp();
    await openAdd(w, { title: "Nan's soup" });
    await w.findAll('.recipe-editor button').find((b) => b.text() === 'Save').trigger('click');
    await flushPromises();
    expect(state.recipes.value.map((r) => r.title)).toEqual(["Nan's soup"]);
    expect(w.find('.add-recipe').element.closest('.overlay').classList.contains('open')).toBe(false);
    expect(window.location.hash).toBe(`#/recipe/${state.recipes.value[0].id}`);
  });

  it('editing the steps marks them as the user\'s', async () => {
    groqAnswers({});
    const w = await mountApp();
    await openAdd(w);
    await w.find('.recipe-editor textarea.steps').setValue('Cook.\nServe hot.');
    await w.findAll('.recipe-editor button').find((b) => b.text() === 'Save').trigger('click');
    await flushPromises();
    expect(state.recipes.value[0].steps).toEqual([{ text: 'Cook.' }, { text: 'Serve hot.' }]);
    expect(state.recipes.value[0].stepsOrigin).toBe('user');
  });
});

// Canned answers by address: the importer's page (or an error), then the
// assistant's JSON answers in order. Records what each was sent.
function backend({ page = null, pageError = null, answers = [], photos = [], photoError = null } = {}) {
  const sent = [];
  const queue = [...answers];
  globalThis.fetch = vi.fn(async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url, body });
    if (url.endsWith('/photo-search')) {
      return photoError ? new Response(JSON.stringify({ error: photoError }), { status: 429 }) : new Response(JSON.stringify({ photos }), { status: 200 });
    }
    if (url.endsWith('/import-url')) {
      return pageError ? new Response(JSON.stringify({ error: pageError }), { status: 422 }) : new Response(JSON.stringify(page), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(queue.shift()) } }] }), { status: 200 });
  });
  endpoint = { url: 'https://proxy/groq', headers: {} };
  return sent;
}
const parsed = (o = {}) => ({
  isRecipe: true, title: 'Squash Gnudi', summary: null, servings: 4, prepMinutes: null, cookMinutes: null,
  ingredients: [{ group: null, amount: 245, unit: 'g', item: 'ricotta', note: '1 cup' }], steps: [], tags: ['italian'], notes: null, ...o,
});
const igPage = {
  kind: 'instagram', url: 'https://www.instagram.com/reel/ABC/', title: null, author: '@cook', imageUrl: null,
  text: 'Squash gnudi\n1 cup ricotta\nFull recipe: https://cook.example/gnudi',
};
const saveButton = (w) => w.findAll('.recipe-editor button').find((b) => b.text() === 'Save');

describe('importing a link', () => {
  it('a lone link is read by the importer, then parsed; the card keeps where it came from', async () => {
    const sent = backend({ page: { ...igPage, kind: 'web', url: 'https://cook.example/gnudi', author: 'Cook', imageUrl: 'https://cook.example/g.jpg' }, answers: [parsed({ steps: ['Mix.'] })] });
    const w = await mountApp();
    await openAdd(w, { text: ' https://cook.example/gnudi ' });
    expect(sent[0]).toEqual({ url: 'https://fn/import-url', body: { url: 'https://cook.example/gnudi' } });
    expect(sent[1].body.messages[1].content).toBe(igPage.text);
    expect(w.find('.recipe-editor input.title').element.value).toBe('Squash Gnudi');
    await saveButton(w).trigger('click');
    await flushPromises();
    const saved = state.recipes.value[0];
    expect(saved).toMatchObject({ sourceKind: 'web', sourceUrl: 'https://cook.example/gnudi', sourceAuthor: 'Cook', imageUrl: 'https://cook.example/g.jpg', sourceText: igPage.text });
  });

  it('the preview shows the source photo; Remove photo drops it from the saved card', async () => {
    backend({ page: { ...igPage, kind: 'web', url: 'https://cook.example/gnudi', imageUrl: 'https://cook.example/g.jpg' }, answers: [parsed({ steps: ['Mix.'] })] });
    const w = await mountApp();
    await openAdd(w, { text: 'https://cook.example/gnudi' });
    expect(w.find('.recipe-editor .editor-photo img').attributes('src')).toBe('https://cook.example/g.jpg');
    await w.find('.recipe-editor button.remove-photo').trigger('click');
    expect(w.find('.recipe-editor .editor-photo').exists()).toBe(false);
    await saveButton(w).trigger('click');
    await flushPromises();
    expect(state.recipes.value[0].imageUrl).toBeNull();
  });

  it('text with a link inside is pasted text, not an import', async () => {
    const sent = backend({ answers: [parsed({ steps: ['Mix.'] })] });
    const w = await mountApp();
    await openAdd(w, { text: 'Gnudi from https://cook.example/gnudi' });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://proxy/groq');
  });

  it('a post that cannot be read: the reason and the paste fallback, the link stays', async () => {
    backend({ pageError: { code: 'no_caption', message: 'The page had no caption.' } });
    const w = await mountApp();
    await openAdd(w, { text: 'https://www.instagram.com/reel/ABC/' });
    expect(w.find('.add-recipe .add-error').text()).toBe("Couldn't read that post (the page had no caption). Paste the caption instead.");
    expect(w.find('.add-recipe textarea.paste').element.value).toBe('https://www.instagram.com/reel/ABC/');
  });
});

describe('steps missing', () => {
  it('the preview flags it; Suggest a method fills the steps with the AI badge and saves them as ai_suggested', async () => {
    const sent = backend({ page: igPage, answers: [parsed(), { steps: ['Roast the squash.', 'Shape and boil.'] }] });
    const w = await mountApp();
    await openAdd(w, { text: 'https://www.instagram.com/reel/ABC/' });
    expect(w.find('.missing-steps').text()).toContain('Steps missing.');
    expect(w.find('.recipe-editor .ai-badge').exists()).toBe(false);
    await w.find('.missing-steps button.suggest').trigger('click');
    await flushPromises();
    expect(sent[2].body.model).toBe('openai/gpt-oss-120b');
    expect(w.find('.recipe-editor textarea.steps').element.value).toBe('Roast the squash.\nShape and boil.');
    expect(w.find('.missing-steps').exists()).toBe(false);
    expect(w.find('.recipe-editor .ai-badge').text()).toBe("AI suggested, may differ from the creator's");
    await saveButton(w).trigger('click');
    await flushPromises();
    expect(state.recipes.value[0]).toMatchObject({ stepsOrigin: 'ai_suggested', sourceKind: 'instagram', sourceAuthor: '@cook', imageUrl: null });
  });

  it('a link in the caption offers to get the method from that site', async () => {
    const sent = backend({ page: igPage, answers: [parsed(), { steps: ['Boil.'] }] });
    const w = await mountApp();
    await openAdd(w, { text: 'https://www.instagram.com/reel/ABC/' });
    // The second import (the site) answers with the same canned page.
    const btn = w.find('.missing-steps button.from-link');
    expect(btn.text()).toBe('Get the method from cook.example');
    await btn.trigger('click');
    await flushPromises();
    expect(sent[2]).toEqual({ url: 'https://fn/import-url', body: { url: 'https://cook.example/gnudi' } });
    expect(sent[3].body.response_format.json_schema.name).toBe('recipe_steps');
    expect(w.find('.recipe-editor textarea.steps').element.value).toBe('Boil.');
  });

  it('on a saved card: pasted steps are saved at once as the source\'s', async () => {
    seed = [sampleRecipe({ steps: [] })];
    const sent = backend({ answers: [{ steps: ['Boil.', 'Serve.'] }] });
    const w = await mountApp();
    window.location.hash = '#/recipe/r1';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();
    await w.find('.missing-steps button.paste-open').trigger('click');
    await w.find('.missing-steps textarea.steps-paste').setValue('Boil it, then serve.');
    await w.find('.missing-steps button.add-steps').trigger('click');
    await flushPromises();
    expect(sent[0].body.messages[1].content).toBe('Boil it, then serve.');
    expect(adapter.calls).toContainEqual(['saveRecipe', 'r1']);
    expect(w.findAll('.recipe-page .steps li').map((li) => li.text())).toEqual(['Boil.', 'Serve.']);
    expect(w.find('.recipe-page .ai-badge').exists()).toBe(false);
  });

  it('a failure shows its message and keeps the panel', async () => {
    seed = [sampleRecipe({ steps: [] })];
    backend({ answers: [{ steps: [] }] });
    const w = await mountApp();
    window.location.hash = '#/recipe/r1';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();
    await w.find('.missing-steps button.suggest').trigger('click');
    await flushPromises();
    expect(w.find('.missing-steps .missing-error').text()).toBe("The assistant couldn't suggest a method. Try again.");
  });
});

const pexels = [
  { thumb: 'https://images.pexels.com/1-m.jpg', url: 'https://images.pexels.com/1-l.jpg', alt: 'Gnocchi', photographer: 'Jane Doe', photographerUrl: 'https://www.pexels.com/@jane' },
  { thumb: 'https://images.pexels.com/2-m.jpg', url: 'https://images.pexels.com/2-l.jpg', alt: '', photographer: 'Sam', photographerUrl: 'https://www.pexels.com/@sam' },
];

describe('stock photos', () => {
  it('the preview of a card without a photo can find one; the pick is saved with its credit', async () => {
    const sent = backend({ answers: [parsed({ steps: ['Mix.'] })], photos: pexels });
    const w = await mountApp();
    await openAdd(w);
    await w.find('.recipe-editor button.find-photo').trigger('click');
    await flushPromises();
    expect(sent.at(-1)).toEqual({ url: 'https://fn/photo-search', body: { query: 'Squash Gnudi' } });
    expect(w.findAll('.picker-photo img').map((i) => i.attributes('src'))).toEqual(['https://images.pexels.com/1-m.jpg', 'https://images.pexels.com/2-m.jpg']);
    expect(w.find('.photo-picker').text()).toContain('Photos provided by Pexels');
    await w.findAll('.picker-photo')[0].trigger('click');
    expect(w.find('.editor-photo img').attributes('src')).toBe('https://images.pexels.com/1-l.jpg');
    expect(w.find('.editor-photo .photo-credit').text().replace(/\s+/g, ' ')).toBe('Photo: Jane Doe on Pexels');
    await saveButton(w).trigger('click');
    await flushPromises();
    expect(state.recipes.value[0]).toMatchObject({ imageUrl: 'https://images.pexels.com/1-l.jpg', imageSource: 'stock', imageCredit: 'Jane Doe', imageCreditUrl: 'https://www.pexels.com/@jane' });
  });

  it('Remove photo clears the credit too', async () => {
    backend({ answers: [parsed({ steps: ['Mix.'] })], photos: pexels });
    const w = await mountApp();
    await openAdd(w);
    await w.find('.recipe-editor button.find-photo').trigger('click');
    await flushPromises();
    await w.findAll('.picker-photo')[1].trigger('click');
    await w.find('.recipe-editor button.remove-photo').trigger('click');
    await saveButton(w).trigger('click');
    await flushPromises();
    expect(state.recipes.value[0]).toMatchObject({ imageUrl: null, imageSource: null, imageCredit: null, imageCreditUrl: null });
  });

  it('on a saved card the pick is saved at once and credited', async () => {
    seed = [sampleRecipe()];
    const sent = backend({ photos: pexels });
    const w = await mountApp();
    window.location.hash = '#/recipe/r1';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();
    await w.find('.recipe-page button.find-photo').trigger('click');
    await flushPromises();
    expect(sent[0].body).toEqual({ query: 'Tomato soup' });
    await w.find('.picker-query').setValue('tomato soup bowl');
    await w.find('.picker-search').trigger('submit');
    await flushPromises();
    expect(sent[1].body).toEqual({ query: 'tomato soup bowl' });
    await w.findAll('.picker-photo')[0].trigger('click');
    await flushPromises();
    expect(adapter.calls).toContainEqual(['saveRecipe', 'r1']);
    expect(w.find('.recipe-page .recipe-photo img').attributes('src')).toBe('https://images.pexels.com/1-l.jpg');
    expect(w.find('.recipe-page .photo-credit').text().replace(/\s+/g, ' ')).toBe('Photo: Jane Doe on Pexels');
    expect(w.find('.photo-picker').exists()).toBe(false);
  });

  it('a failed search shows the reason; no results suggest simpler words', async () => {
    seed = [sampleRecipe()];
    backend({ photoError: { code: 'busy', message: 'Too many photo searches this hour. Try again later.' } });
    const w = await mountApp();
    window.location.hash = '#/recipe/r1';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();
    await w.find('.recipe-page button.find-photo').trigger('click');
    await flushPromises();
    expect(w.find('.picker-error').text()).toBe('Too many photo searches this hour. Try again later.');
    backend({ photos: [] });
    await w.find('.picker-search').trigger('submit');
    await flushPromises();
    expect(w.find('.photo-picker').text()).toContain('No photos found.');
  });
});

describe('cooked and want to cook', () => {
  const both = () => [
    sampleRecipe({ id: 'w1', title: 'Pea soup', tags: ['soup'] }),
    sampleRecipe({ id: 'c1', title: 'Banana bread', tags: ['baking'], status: 'cooked', cookedOn: '2026-11-01' }),
  ];
  const tiles = (w) => w.findAll('.recipe-tile .tile-title').map((t) => t.text());
  const showList = (w, label) => w.findAll('.list-toggle button').find((b) => b.text() === label).trigger('click');

  it('opens on Want to cook; Cooked shows only cooked recipes', async () => {
    seed = both();
    const w = await mountApp();
    expect(tiles(w)).toEqual(['Pea soup']);
    await showList(w, 'Cooked');
    expect(tiles(w)).toEqual(['Banana bread']);
    expect(w.findAll('.list-toggle button').map((b) => b.attributes('aria-pressed'))).toEqual(['false', 'true']);
  });

  it('each list keeps its own filters', async () => {
    seed = both();
    const w = await mountApp();
    await showList(w, 'Cooked');
    await w.findAll('.tag-chip').find((b) => b.text() === 'baking').trigger('click');
    await showList(w, 'Want to cook');
    expect(tiles(w)).toEqual(['Pea soup']);
    expect(w.findAll('.tag-chip.active')).toHaveLength(0);
    await showList(w, 'Cooked');
    expect(w.find('.tag-chip.active').text()).toBe('baking');
  });

  it('tag chips come from the list on screen', async () => {
    seed = both();
    const w = await mountApp();
    expect(w.findAll('.tag-chip').map((b) => b.text())).toEqual(['soup']);
  });

  it('an empty list says so', async () => {
    seed = [sampleRecipe()];
    const w = await mountApp();
    await showList(w, 'Cooked');
    expect(w.text()).toContain('Nothing here yet.');
  });

  it('adding a recipe while on Cooked saves it as cooked', async () => {
    groqAnswers({});
    const w = await mountApp();
    await showList(w, 'Cooked');
    await openAdd(w);
    await w.findAll('.recipe-editor button').find((b) => b.text() === 'Save').trigger('click');
    await flushPromises();
    expect(adapter.saved.at(-1).status).toBe('cooked');
  });

  it('adding a recipe while on Want to cook saves it as a wish', async () => {
    groqAnswers({});
    const w = await mountApp();
    await openAdd(w);
    await w.findAll('.recipe-editor button').find((b) => b.text() === 'Save').trigger('click');
    await flushPromises();
    expect(adapter.saved.at(-1)).toMatchObject({ status: 'wishlist', cookedOn: null });
  });

  const dialog = (w) => w.find('.cooked-dialog');
  const moveButton = (w) => dialog(w).findAll('button').find((b) => b.text() === 'Move to Cooked');
  async function openPage(w, id) {
    window.location.hash = `#/recipe/${id}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();
  }

  it('✓ on a wish asks for the date, today filled in, and moves it to Cooked', async () => {
    seed = both();
    const w = await mountApp();
    await w.find('.recipe-tile .cooked-btn').trigger('click');
    expect(dialog(w).find('input[type=date]').element.value).toBe(today());
    await moveButton(w).trigger('click');
    await flushPromises();
    expect(adapter.saved.at(-1)).toMatchObject({ id: 'w1', status: 'cooked', cookedOn: today() });
    expect(tiles(w)).toEqual([]);
    await showList(w, 'Cooked');
    expect(tiles(w)).toEqual(['Pea soup', 'Banana bread']);
  });

  it('the date can be left out', async () => {
    seed = both();
    const w = await mountApp();
    await w.find('.recipe-tile .cooked-btn').trigger('click');
    await dialog(w).find('input[type=date]').setValue('');
    await moveButton(w).trigger('click');
    await flushPromises();
    expect(adapter.saved.at(-1)).toMatchObject({ status: 'cooked', cookedOn: null });
  });

  it('a failed move shows the message and keeps the wish', async () => {
    seed = both();
    failures.save = 'Could not save the recipe: offline';
    const w = await mountApp();
    await w.find('.recipe-tile .cooked-btn').trigger('click');
    await moveButton(w).trigger('click');
    await flushPromises();
    expect(dialog(w).text()).toContain('Could not save the recipe: offline');
    expect(tiles(w)).toEqual(['Pea soup']);
  });

  it('a tag picked before its last wish moves stays shown, so it can be cleared', async () => {
    seed = [...both(), sampleRecipe({ id: 'w2', title: 'Toast', tags: ['breakfast'] })];
    const w = await mountApp();
    await w.findAll('.tag-chip').find((b) => b.text() === 'soup').trigger('click');
    await w.find('.recipe-tile .cooked-btn').trigger('click');
    await moveButton(w).trigger('click');
    await flushPromises();
    await w.find('.tag-chip.active').trigger('click');
    expect(tiles(w)).toEqual(['Toast']);
  });

  it('cooked tiles have no ✓', async () => {
    seed = both();
    const w = await mountApp();
    await showList(w, 'Cooked');
    expect(w.find('.recipe-tile .cooked-btn').exists()).toBe(false);
  });

  it('a wish\'s page has Cooked it; a cooked page shows the date', async () => {
    seed = both();
    const w = await mountApp();
    await openPage(w, 'w1');
    await w.findAll('.recipe-page button').find((b) => b.text() === 'Cooked it').trigger('click');
    await moveButton(w).trigger('click');
    await flushPromises();
    expect(w.find('.recipe-page .cooked-on').text()).toBe(`Cooked ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`);
    await openPage(w, 'c1');
    expect(w.find('.recipe-page .cooked-on').text()).toBe('Cooked 1 Nov 2026');
    expect(w.findAll('.recipe-page button').some((b) => b.text() === 'Cooked it')).toBe(false);
  });

  it('Edit changes or clears the date; a wish has no date field', async () => {
    seed = both();
    const w = await mountApp();
    await openPage(w, 'c1');
    const edit = () => w.findAll('.recipe-page button').find((b) => b.text() === 'Edit').trigger('click');
    const saveEdit = async () => { await w.findAll('.recipe-editor button').find((b) => b.text() === 'Save').trigger('click'); await flushPromises(); };
    await edit();
    await w.find('.recipe-editor input.cooked-on').setValue('2026-10-20');
    await saveEdit();
    expect(adapter.saved.at(-1).cookedOn).toBe('2026-10-20');
    await edit();
    await w.find('.recipe-editor input.cooked-on').setValue('');
    await saveEdit();
    expect(adapter.saved.at(-1).cookedOn).toBe(null);
    expect(w.find('.recipe-page .cooked-on').exists()).toBe(false);
    await openPage(w, 'w1');
    await edit();
    expect(w.find('.recipe-editor input.cooked-on').exists()).toBe(false);
  });
});

describe('the library', () => {
  const three = () => [
    sampleRecipe(),
    sampleRecipe({ id: 'r2', title: 'Banana bread', tags: ['baking'], starred: true,
      ingredients: [{ group: null, amount: 3, unit: 'pc', item: 'bananas', note: null }] }),
    sampleRecipe({ id: 'r3', title: 'Pea soup', tags: ['soup', 'quick'] }),
  ];
  const tiles = (w) => w.findAll('.recipe-tile .tile-title').map((t) => t.text());

  it('a tile shows the source photo when there is one', async () => {
    seed = [sampleRecipe({ imageUrl: 'https://cook.example/g.jpg' }), sampleRecipe({ id: 'r2', imageUrl: null }), sampleRecipe({ id: 'r3', imageUrl: 'data:x' })];
    const w = await mountApp();
    expect(w.findAll('.recipe-tile .tile-photo').map((i) => i.attributes('src'))).toEqual(['https://cook.example/g.jpg']);
  });

  it('lists every recipe', async () => {
    seed = three();
    const w = await mountApp();
    expect(tiles(w)).toEqual(['Tomato soup', 'Banana bread', 'Pea soup']);
  });

  it('search narrows the tiles, by title or ingredient', async () => {
    seed = three();
    const w = await mountApp();
    await w.find('.library-bar input.search').setValue('banana');
    expect(tiles(w)).toEqual(['Banana bread']);
    await w.find('.library-bar input.search').setValue('nothing like this');
    expect(w.text()).toContain('No recipes match.');
    await w.findAll('button').find((b) => b.text() === 'Clear filters').trigger('click');
    expect(tiles(w)).toHaveLength(3);
  });

  it('a tag chip filters, and clicking it again clears it', async () => {
    seed = three();
    const w = await mountApp();
    const chip = () => w.findAll('.tag-chip').find((b) => b.text() === 'soup');
    await chip().trigger('click');
    expect(tiles(w)).toEqual(['Tomato soup', 'Pea soup']);
    await chip().trigger('click');
    expect(tiles(w)).toHaveLength(3);
  });

  it('tags are ordered by use, and a picked tag moves to the front', async () => {
    seed = three();
    const w = await mountApp();
    const chips = () => w.findAll('.tag-chip').map((b) => b.text());
    expect(chips()).toEqual(['soup', 'baking', 'quick']);
    await w.findAll('.tag-chip').find((b) => b.text() === 'quick').trigger('click');
    expect(chips()).toEqual(['quick', 'soup', 'baking']);
  });

  it('» shows every tag when they don\'t fit on one line, and « folds them again', async () => {
    // jsdom has no layout: pretend the tags are taller than their one line.
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return this.classList.contains('tag-list') ? 60 : 0; } });
    try {
      seed = three();
      const w = await mountApp();
      await flushPromises();
      await w.find('.tag-row .tag-more').trigger('click');
      expect(w.find('.tag-row').classes()).toContain('open');
      expect(w.find('.tag-more').text()).toBe('«');
      expect(w.find('.tag-more').attributes('aria-label')).toBe('Fewer tags');
      await w.find('.tag-more').trigger('click');
      expect(w.find('.tag-row').classes()).not.toContain('open');
    } finally {
      if (height) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', height);
      else delete HTMLElement.prototype.scrollHeight;
    }
  });

  it('no » when the tags fit', async () => {
    seed = three();
    const w = await mountApp();
    await flushPromises();
    expect(w.find('.tag-more').exists()).toBe(false);
  });

  it('Starred shows only starred recipes', async () => {
    seed = three();
    const w = await mountApp();
    await w.find('.library-bar .starred-toggle').trigger('click');
    expect(tiles(w)).toEqual(['Banana bread']);
  });

  it('the star on a tile saves, and a failed save puts it back with the message', async () => {
    seed = three();
    const w = await mountApp();
    await w.findAll('.recipe-tile .star-btn')[0].trigger('click');
    await flushPromises();
    expect(adapter.calls.at(-1)).toEqual(['setStarred', 'r1', true]);
    expect(w.findAll('.recipe-tile .star-btn')[0].attributes('aria-pressed')).toBe('true');
    failures.star = 'Could not update the star: offline';
    await w.findAll('.recipe-tile .star-btn')[0].trigger('click');
    await flushPromises();
    expect(w.findAll('.recipe-tile .star-btn')[0].attributes('aria-pressed')).toBe('true');
    expect(w.find('.library-error').text()).toBe('Could not update the star: offline');
  });
});

describe('a recipe page', () => {
  async function openRecipe(id = 'r1') {
    seed = [sampleRecipe({ ingredients: [
      { group: null, amount: 200, unit: 'g', item: 'flour', note: '1.5 cups' },
      { group: 'Sauce', amount: null, unit: null, item: 'salt', note: 'to taste' },
    ], steps: [{ text: 'Mix.' }, { text: 'Bake.' }] })];
    const w = await mountApp();
    window.location.hash = `#/recipe/${id}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();
    return w;
  }

  it('clicking a tile opens the recipe page', async () => {
    seed = [sampleRecipe()];
    const w = await mountApp();
    await w.find('.recipe-tile').trigger('click');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();
    expect(window.location.hash).toBe('#/recipe/r1');
    expect(w.find('.recipe-page h2').text()).toBe('Tomato soup');
  });

  it('shows ingredients under their sections, and numbered steps', async () => {
    const w = await openRecipe();
    const items = w.findAll('.recipe-page .ingredients li').map((li) => li.text().replace(/\s+/g, ' '));
    expect(items).toEqual(['200 g flour 1.5 cups', 'salt to taste']);
    expect(w.find('.recipe-page .ingredients').text()).toContain('Sauce');
    expect(w.findAll('.recipe-page ol.steps li').map((li) => li.text())).toEqual(['Mix.', 'Bake.']);
  });

  it('edit and save updates the page and the library', async () => {
    const w = await openRecipe();
    await w.findAll('.recipe-page button').find((b) => b.text() === 'Edit').trigger('click');
    await w.find('.recipe-editor input.title').setValue('Better soup');
    await w.findAll('.recipe-editor button').find((b) => b.text() === 'Save').trigger('click');
    await flushPromises();
    expect(w.find('.recipe-editor').exists()).toBe(false);
    expect(w.find('.recipe-page h2').text()).toBe('Better soup');
    expect(state.recipes.value[0].title).toBe('Better soup');
  });

  it('delete asks first, then goes back to the library without it', async () => {
    const w = await openRecipe();
    await w.findAll('.recipe-page button').find((b) => b.text() === 'Delete').trigger('click');
    expect(w.find('.delete-confirm').text()).toContain("Delete Tomato soup? This can't be undone.");
    await w.findAll('.delete-confirm button').find((b) => b.text() === 'Delete').trigger('click');
    await flushPromises();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();
    expect(adapter.calls.at(-1)).toEqual(['deleteRecipe', 'r1']);
    expect(window.location.hash).toBe('#/');
    expect(state.recipes.value).toEqual([]);
    expect(w.text()).toContain('No recipes yet.');
  });

  it('a source link is shown only for http(s) addresses', async () => {
    seed = [sampleRecipe({ sourceUrl: 'javascript:alert(1)', sourceAuthor: 'someone' }), sampleRecipe({ id: 'r2', sourceUrl: 'https://example.com/soup' })];
    const w = await mountApp();
    for (const [id, href] of [['r1', undefined], ['r2', 'https://example.com/soup']]) {
      window.location.hash = `#/recipe/${id}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      await flushPromises();
      expect(w.find('.recipe-source a').exists() ? w.find('.recipe-source a').attributes('href') : undefined).toBe(href);
    }
  });

  it('the source photo shows with a credit; a non-http one is not shown', async () => {
    seed = [sampleRecipe({ imageUrl: 'https://cook.example/g.jpg', sourceUrl: 'https://www.cook.example/gnudi' }), sampleRecipe({ id: 'r2', imageUrl: 'javascript:x' })];
    const w = await mountApp();
    window.location.hash = '#/recipe/r1';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();
    expect(w.find('.recipe-photo img').attributes('src')).toBe('https://cook.example/g.jpg');
    expect(w.find('.recipe-photo img').attributes('referrerpolicy')).toBe('no-referrer');
    expect(w.find('.recipe-photo figcaption').text()).toBe('Photo: cook.example');
    window.location.hash = '#/recipe/r2';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();
    expect(w.find('.recipe-photo').exists()).toBe(false);
  });

  it('an AI-suggested method carries the badge', async () => {
    seed = [sampleRecipe({ stepsOrigin: 'ai_suggested' })];
    const w = await mountApp();
    window.location.hash = '#/recipe/r1';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();
    expect(w.find('.recipe-page .ai-badge').text()).toBe("AI suggested, may differ from the creator's");
  });

  it('the X closes the card back to the library; Edit and Delete sit at the bottom', async () => {
    const w = await openRecipe();
    const page = w.find('.recipe-page');
    expect(page.find('.back-link').exists()).toBe(false);
    const order = [...page.element.children].map((el) => el.className);
    expect(order.indexOf('recipe-actions')).toBeGreaterThan(order.indexOf('method'));
    await page.find('button.close-btn').trigger('click');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await flushPromises();
    expect(window.location.hash).toBe('#/');
    expect(w.find('.recipe-page').exists()).toBe(false);
  });

  it('an unknown id says so, with a way back', async () => {
    const w = await openRecipe('nope');
    expect(w.text()).toContain('Recipe not found.');
    expect(w.find('.recipe-missing a').attributes('href')).toBe('#/');
  });
});

describe('privacy', () => {
  it('the sign-in screen links to the privacy page', async () => {
    const w = await mountApp('signedOut');
    expect(w.find('.setup a[href="privacy.html"]').exists()).toBe(true);
  });

  it('the library has a privacy link in the footer', async () => {
    const w = await mountApp();
    expect(w.find('footer.site-foot a[href="privacy.html"]').exists()).toBe(true);
  });
});
