<script setup>
// Your data: download everything stored for the account, or delete the
// account. Deletion is immediate and can't be undone.
import { ref, watch } from 'vue';
import { exportAccount, deleteAccount } from '../state.js';
import Modal from './Modal.vue';

const open = defineModel('open', { type: Boolean, default: false });
const status = ref('');
const busy = ref(false);
const confirming = ref(false);
const confirmText = ref('');

watch(open, (isOpen) => {
  if (!isOpen) return;
  status.value = '';
  confirming.value = false;
  confirmText.value = '';
});

async function download() {
  busy.value = true;
  status.value = '';
  try {
    const data = await exportAccount();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-recipe-data-${data.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    status.value = 'Downloaded.';
  } catch (e) { status.value = e.message; }
  finally { busy.value = false; }
}

async function remove() {
  if (confirmText.value.trim().toLowerCase() !== 'delete') return;
  busy.value = true;
  status.value = '';
  try {
    await deleteAccount();
    open.value = false;
  } catch (e) { status.value = e.message; }
  finally { busy.value = false; }
}
</script>

<template>
  <Modal v-model:open="open">
    <h2>Your data</h2>
    <div class="field">
      <label>Download</label>
      <p class="form-sub">One JSON file with your account details, your recipes and the invites you created.</p>
      <button class="btn small" :disabled="busy" @click="download">Download my data</button>
    </div>
    <div class="field account-delete" style="margin-top:16px;border-top:1px solid var(--line);padding-top:16px;">
      <label>Delete account</label>
      <p class="form-sub">Removes your account and your recipes right away. This can't be undone, so download your data first.</p>
      <button v-if="!confirming" class="btn small ghost" :disabled="busy" @click="confirming = true">Delete my account…</button>
      <form v-else @submit.prevent="remove">
        <input v-model="confirmText" class="mono" placeholder="Type delete to confirm" aria-label="Type delete to confirm" autocomplete="off">
        <button class="btn small danger" type="submit" style="margin-top:8px;" :disabled="busy || confirmText.trim().toLowerCase() !== 'delete'">Delete everything</button>
      </form>
    </div>
    <div class="status">{{ status }}</div>
    <div class="form-actions">
      <button class="btn ghost" @click="open = false">Close</button>
    </div>
  </Modal>
</template>
