<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { recipes, connection, initStorage, connectStorage, reconnectStorage, signOut, redeemInvite, requestAccess } from './state.js';
import SettingsMenu from './components/SettingsMenu.vue';
import InviteDialog from './components/InviteDialog.vue';
import AccountDialog from './components/AccountDialog.vue';
import GoogleButton from './components/GoogleButton.vue';
import { useScrollChrome } from './lib/scrollChrome.js';

const showMain = computed(() => connection.state === 'ok');
const showSignIn = computed(() => connection.state === 'signedOut');
const showRedeem = computed(() => connection.state === 'needsInvite');
const dot = computed(() => (connection.state === 'warn' ? 'warn' : ''));

const inviteOpen = ref(false);
const accountOpen = ref(false);
const headerEl = ref(null);
const { compact } = useScrollChrome(headerEl);

// An invite link (?invite=CODE) is kept across the Google sign-in round trip,
// which returns to the page without the query.
const PENDING = 'pendingInvite';
function pendingInvite() {
  const fromUrl = new URLSearchParams(window.location.search).get('invite');
  try {
    if (fromUrl) {
      localStorage.setItem(PENDING, fromUrl);
      history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
    return fromUrl || localStorage.getItem(PENDING) || '';
  } catch (e) { return fromUrl || ''; }
}
const inviteCode = ref(pendingInvite());
const redeemError = ref('');
const redeeming = ref(false);
async function redeem() {
  if (!inviteCode.value.trim() || redeeming.value) return;
  redeeming.value = true;
  redeemError.value = '';
  try {
    await redeemInvite(inviteCode.value.trim());
    try { localStorage.removeItem(PENDING); } catch (e) { /* storage unavailable */ }
  } catch (e) { redeemError.value = e.message; }
  finally { redeeming.value = false; }
}

// The code belongs to whoever opened the link: forget it once they're in, or
// when they sign out first, so the next account on the device doesn't get it.
function forgetInvite() {
  inviteCode.value = '';
  try { localStorage.removeItem(PENDING); } catch (e) { /* storage unavailable */ }
}
watch(() => connection.state, (now, before) => {
  if (now === 'ok' || (now === 'signedOut' && (before === 'needsInvite' || before === 'ok'))) forgetInvite();
});

// No code: ask the admins for one.
const requestMessage = ref('');
const requestSent = ref(false);
const requestError = ref('');
async function askForCode() {
  requestError.value = '';
  try {
    await requestAccess(requestMessage.value);
    requestSent.value = true;
  } catch (e) { requestError.value = e.message; }
}

onMounted(initStorage);
</script>

<template>
  <div class="wrap">
    <header ref="headerEl" class="top" :class="{ compact }">
      <h1 class="logo">
        <svg viewBox="0 0 300 64" role="img" aria-label="Recipe Library">
          <rect x="6" y="22" width="52" height="6" rx="3" fill="#a8503a"/>
          <path d="M10 31h44v14a11 11 0 0 1-11 11H21a11 11 0 0 1-11-11z" fill="#3f6b4f"/>
          <rect x="27" y="13" width="10" height="7" rx="2" fill="#a8503a"/>
          <text x="72" y="46" fill="currentColor">Recipe Library</text>
        </svg>
      </h1>
      <SettingsMenu v-if="showMain" :can-invite="!!connection.profile?.isAdmin"
        :account="connection.account" :profile="connection.profile"
        @invite="inviteOpen = true" @account="accountOpen = true" @sign-out="signOut" />
    </header>

    <div v-if="connection.state === 'warn' || connection.state === 'checking'" class="filebar">
      <span class="dot" :class="dot"></span>
      <span>{{ connection.text }}</span>
      <span style="flex:1;"></span>
      <template v-if="connection.state === 'warn'">
        <button class="btn ghost small" @click="reconnectStorage">Retry</button>
        <button v-if="connection.account" class="btn ghost small" @click="signOut">Sign out</button>
        <button v-else class="btn ghost small" @click="connectStorage">Sign in again</button>
      </template>
    </div>

    <div v-if="showSignIn" class="setup bare">
      <p v-if="inviteCode">You've been invited. Sign in with Google to accept, and your code will be filled in.</p>
      <p v-else>Your recipes are stored in your account. Sign in with Google to see them. New here? You'll need an invite code.</p>
      <GoogleButton @click="connectStorage" />
    </div>

    <template v-if="showRedeem">
      <form class="setup redeem" @submit.prevent="redeem">
        <p>Signed in as {{ connection.account }}. This app is invite-only for now: enter the code you were given.</p>
        <div class="redeem-row">
          <input v-model="inviteCode" class="mono" placeholder="XXXX-XXXX-XXXX" aria-label="Invite code" autocomplete="off">
          <button class="btn" type="submit" :disabled="redeeming || !inviteCode.trim()">Join</button>
        </div>
        <p v-if="redeemError" class="redeem-error">{{ redeemError }}</p>
        <button class="btn ghost small" type="button" @click="signOut">Sign out</button>
        <p class="setup-foot"><button class="link-btn" type="button" @click="accountOpen = true">Delete this account</button></p>
      </form>
      <form class="setup request-access" @submit.prevent="askForCode">
        <p v-if="requestSent">Request sent. The code will come to {{ connection.account }}.</p>
        <template v-else>
          <p>No code? Ask for one.</p>
          <div class="field">
            <textarea v-model="requestMessage" maxlength="500" aria-label="Message to the admins" placeholder="Who sent you here? (optional)"></textarea>
          </div>
          <button class="btn small" type="submit">Ask for a code</button>
          <p v-if="requestError" class="redeem-error">{{ requestError }}</p>
        </template>
      </form>
    </template>

    <div v-if="showMain">
      <div v-if="!recipes.length" class="empty">No recipes yet.</div>
    </div>
  </div>

  <InviteDialog v-model:open="inviteOpen" />
  <AccountDialog v-model:open="accountOpen" />
</template>
