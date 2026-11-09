// App state shared by the components (Vue's built-in reactivity; no Pinia).
import { reactive, ref } from 'vue';
import { createSupabaseStorage } from './lib/storage/index.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

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

// Your data.
export const exportAccount = () => storage.exportAccount();
export async function deleteAccount() {
  await storage.deleteAccount();
  recipes.value = [];
}
