// App state shared by the components (Vue's built-in reactivity; no Pinia).
import { reactive, ref, toRaw, watch } from 'vue';
import { createSupabaseStorage } from './lib/storage/index.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import * as llm from './lib/llm.js';
import { importLink, linkOnly } from './lib/importer.js';
import * as photos from './lib/photos.js';

export const recipes = ref([]);
export const connection = reactive({ state: 'checking', text: 'Loading…', account: '', profile: null });

// profile: { name, avatarUrl, isAdmin } from the sign-in provider, when there is one.
export function setConnection(state, text, account = '', profile = null) {
  connection.state = state; connection.text = text; connection.account = account; connection.profile = profile;
}

let storage = createSupabaseStorage(setConnection, { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY });
// Tests swap in a fake adapter.
export function useStorage(adapter) { storage = adapter; }

function loaded(list) { if (list) recipes.value = list; }
export const initStorage = async () => loaded(await storage.init());
export const connectStorage = async () => loaded(await storage.connect());
export const reconnectStorage = async () => loaded(await storage.reconnect());
export async function signOut() {
  await storage.signOut();
  recipes.value = [];
}

// Invites. redeemInvite throws a message to show next to the code field.
export const redeemInvite = async (code) => loaded(await storage.redeemInvite(code));
export const requestAccess = (message) => storage.requestAccess(message);
export const createInvite = () => storage.createInvite();
export const listInvites = () => storage.listInvites();
export const listAccessRequests = () => storage.listAccessRequests();
export const dismissAccessRequest = (userId) => storage.dismissAccessRequest(userId);

// Pasted text, or a link to a recipe page or an Instagram post, to an unsaved
// card: { recipe, needsTitle }. Throws a message to show under the paste box;
// for a link it ends in "paste … instead".
export async function parseRecipe({ title, text }) {
  const link = linkOnly(text);
  if (!link) return llm.parseRecipe(await storage.llmEndpoint(), { title, text });
  const page = await importLink(await storage.importEndpoint(), link);
  const out = await llm.parseRecipe(await storage.llmEndpoint(), { title, text: page.text });
  Object.assign(out.recipe, {
    sourceKind: page.kind, sourceUrl: page.url, sourceAuthor: page.author || null,
    imageUrl: page.imageUrl || null, imageSource: page.imageUrl ? 'site' : null,
  });
  return out;
}

// Steps for a card without a method, from pasted steps or a link to the
// recipe's page: [{ text }].
export async function importSteps(text) {
  const link = linkOnly(text);
  const source = link ? (await importLink(await storage.importEndpoint(), link)).text : text;
  return llm.parseSteps(await storage.llmEndpoint(), source);
}

// Pexels photos for a dish: [{ thumb, url, alt, photographer, photographerUrl }].
export async function searchPhotos(query) {
  return photos.searchPhotos(await storage.photoEndpoint(), query);
}

// A suggested method (AI, labelled by the caller): [{ text }].
export async function suggestMethod(recipe) {
  return llm.suggestMethod(await storage.llmEndpoint(), recipe);
}

// The list on screen ('cooked' | 'wishlist'), remembered on this device, and
// each list's own filters, kept while a recipe is open.
const LIST_KEY = 'recipes.list';
function savedList() {
  try { return localStorage.getItem(LIST_KEY) === 'cooked' ? 'cooked' : 'wishlist'; } catch { return 'wishlist'; }
}
export const currentList = ref(savedList());
watch(currentList, (list) => { try { localStorage.setItem(LIST_KEY, list); } catch { /* not stored */ } });
const noFilters = () => ({ query: '', tag: '', starredOnly: false });
export const listFilters = reactive({ cooked: noFilters(), wishlist: noFilters() });

// Recipes. Each throws the adapter's message, for the view to show.
export async function saveRecipe(recipe) {
  const saved = await storage.saveRecipe(recipe);
  const i = recipes.value.findIndex((r) => r.id === saved.id);
  if (i >= 0) recipes.value.splice(i, 1, saved);
  else recipes.value.unshift(saved);
  return saved;
}
export async function deleteRecipe(id) {
  await storage.deleteRecipe(id);
  recipes.value = recipes.value.filter((r) => r.id !== id);
}
// A wish moves to Cooked in place; cookedOn is 'YYYY-MM-DD' or null. A failed
// save leaves it a wish.
export async function markCooked(id, cookedOn) {
  const r = recipes.value.find((x) => x.id === id);
  return saveRecipe({ ...structuredClone(toRaw(r)), status: 'cooked', cookedOn: cookedOn || null });
}
// The star changes at once and goes back if the save fails.
export async function toggleStar(id) {
  const r = recipes.value.find((x) => x.id === id);
  if (!r) return;
  r.starred = !r.starred;
  try { await storage.setStarred(id, r.starred); }
  catch (e) { r.starred = !r.starred; throw e; }
}

// A short message at the bottom of the screen ("Link copied").
export const toast = ref('');
let toastTimer = null;
export function showToast(text) {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ''; }, 2500);
}

// Share links. The link opens the public page, #/r/<token>.
export const shareUrl = (token) => `${window.location.origin}${window.location.pathname}#/r/${token}`;
export async function shareRecipe(id) {
  const token = await storage.shareRecipe(id);
  const r = recipes.value.find((x) => x.id === id);
  if (r) r.shareToken = token;
  return token;
}
export async function stopSharing(id) {
  await storage.stopSharing(id);
  const r = recipes.value.find((x) => x.id === id);
  if (r) r.shareToken = null;
}
export const getSharedRecipe = (token) => storage.getSharedRecipe(token);

// Your data.
export const exportAccount = () => storage.exportAccount();
export async function deleteAccount() {
  await storage.deleteAccount();
  recipes.value = [];
}
