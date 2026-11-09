<script setup>
// The account menu in the header: opens from the avatar. Holds the settings
// actions and Sign out.
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import Avatar from './Avatar.vue';

defineProps({
  canInvite: { type: Boolean, default: false },
  account: { type: String, default: '' },
  profile: { type: Object, default: null },
});
const emit = defineEmits(['invite', 'account', 'sign-out']);

const open = ref(false);
const root = ref(null);
function onDocClick(e) { if (open.value && root.value && !root.value.contains(e.target)) open.value = false; }
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));

function menu(event) { open.value = false; emit(event); }
// Escape closes the menu and puts focus back on the button that opened it.
function onKeydown(e) {
  if (e.key !== 'Escape' || !open.value) return;
  open.value = false;
  nextTick(() => root.value?.querySelector('.avatar-btn')?.focus());
}
</script>

<template>
  <div ref="root" class="popover-wrap account-menu" @keydown="onKeydown">
    <button class="avatar-btn" aria-label="Account menu" :aria-expanded="open" @click.stop="open = !open">
      <Avatar :email="account" :name="profile?.name || ''" :src="profile?.avatarUrl || ''" />
    </button>
    <div class="popover" :class="{ open }">
      <div class="menu-who">
        <b v-if="profile?.name">{{ profile.name }}</b>
        <span>{{ account }}</span>
      </div>
      <button v-if="canInvite" class="btn ghost small full" @click="menu('invite')">Invite someone</button>
      <button class="btn ghost small full" @click="menu('account')">Your data</button>
      <button class="btn ghost small full" @click="menu('sign-out')">Sign out</button>
    </div>
  </div>
</template>
