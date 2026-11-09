<script setup>
// Admins create invite codes here. Each code works once and expires
// after 14 days; the link fills the code in for the person signing up. People
// who asked for a code after signing in are listed too; a request goes away
// when they redeem a code or it's dismissed.
import { ref, watch } from 'vue';
import { createInvite, listInvites, listAccessRequests, dismissAccessRequest } from '../state.js';
import Modal from './Modal.vue';

const open = defineModel('open', { type: Boolean, default: false });
const invites = ref([]);
const requests = ref([]);
const latest = ref(null);
// The request the latest code was made for, so it can be emailed from here.
const latestFor = ref(null);
const status = ref('');
const busy = ref(false);

const linkFor = (code) => `${window.location.origin}${window.location.pathname}?invite=${code}`;
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
function stateOf(inv) {
  if (inv.usedAt) return `used ${day(inv.usedAt)}`;
  if (new Date(inv.expiresAt) < new Date()) return 'expired';
  return `unused, expires ${day(inv.expiresAt)}`;
}

async function refresh() {
  try { [invites.value, requests.value] = await Promise.all([listInvites(), listAccessRequests()]); }
  catch (e) { status.value = e.message; }
}

watch(open, (isOpen) => {
  if (!isOpen) return;
  latest.value = null;
  latestFor.value = null;
  status.value = '';
  refresh();
});

// req: an access request to answer, or null for a code to hand out yourself.
async function create(req = null) {
  busy.value = true;
  status.value = '';
  try {
    latest.value = await createInvite();
    latestFor.value = req;
    await refresh();
  } catch (e) { status.value = e.message; }
  finally { busy.value = false; }
}

// Opens your own mail app; the app sends no email itself.
const mailto = (req, code) => `mailto:${encodeURIComponent(req.email)}?subject=${encodeURIComponent('Your invite code')}`
  + `&body=${encodeURIComponent(`Here's your invite: ${linkFor(code)}\nSign in with Google, and the code (${code}) fills itself in. It works once and expires in 14 days.`)}`;

async function dismiss(req) {
  try {
    await dismissAccessRequest(req.userId);
    if (latestFor.value && latestFor.value.userId === req.userId) latestFor.value = null;
    await refresh();
  } catch (e) { status.value = e.message; }
}

async function copy() {
  try { await navigator.clipboard.writeText(linkFor(latest.value.code)); status.value = 'Link copied.'; }
  catch (e) { status.value = 'Clipboard blocked. Copy the link by hand.'; }
}
</script>

<template>
  <Modal v-model:open="open">
    <h2>Invite someone</h2>
    <p class="form-sub">Each code works once and expires after 14 days. They sign in with Google, then enter the code (the link fills it in).</p>
    <button class="btn small" :disabled="busy" @click="create()">Create invite code</button>
    <div v-if="latest" class="field invite-new" style="margin-top:16px;">
      <label>New code{{ latestFor ? ` for ${latestFor.name || latestFor.email}` : '' }}</label>
      <div class="mono invite-code">{{ latest.code }}</div>
      <input class="mono" :value="linkFor(latest.code)" readonly @focus="$event.target.select()">
      <div class="pop-actions" style="justify-content:flex-start;margin-top:8px;">
        <button class="btn small ghost" @click="copy">Copy link</button>
        <a v-if="latestFor" class="btn small ghost" :href="mailto(latestFor, latest.code)">Email it to {{ latestFor.email }}</a>
      </div>
    </div>
    <div class="status">{{ status }}</div>
    <div v-if="requests.length" class="field access-requests" style="margin-top:16px;border-top:1px solid var(--line);padding-top:16px;">
      <label>Asking for a code</label>
      <ul class="request-list">
        <li v-for="r in requests" :key="r.userId">
          <div><b>{{ r.name || r.email }}</b> <span v-if="r.name" class="req-email">{{ r.email }}</span> · {{ day(r.createdAt) }}</div>
          <p v-if="r.message" class="req-message">{{ r.message }}</p>
          <div class="req-actions">
            <button class="btn small" :disabled="busy" @click="create(r)">Create code</button>
            <button class="btn small ghost" @click="dismiss(r)">Dismiss</button>
          </div>
        </li>
      </ul>
    </div>
    <div v-if="invites.length" class="field" style="margin-top:16px;border-top:1px solid var(--line);padding-top:16px;">
      <label>Recent codes</label>
      <ul class="invite-list mono">
        <li v-for="inv in invites" :key="inv.code"><b>{{ inv.code }}</b> · {{ stateOf(inv) }}</li>
      </ul>
    </div>
    <div class="form-actions">
      <button class="btn ghost" @click="open = false">Close</button>
    </div>
  </Modal>
</template>
