<script setup>
// The signed-in user's picture from Google, or their initials when there is
// none or it doesn't load. The email shows on hover.
import { computed, ref, watch } from 'vue';

const props = defineProps({
  email: { type: String, default: '' },
  name: { type: String, default: '' },
  src: { type: String, default: '' },
});

const failed = ref(false);
watch(() => props.src, () => { failed.value = false; });

const initials = computed(() => {
  const words = props.name.trim().split(/\s+/).filter(Boolean);
  if (words.length) return (words[0][0] + (words.length > 1 ? words.at(-1)[0] : '')).toUpperCase();
  return (props.email[0] || '?').toUpperCase();
});
const label = computed(() => (props.name ? `${props.name} (${props.email})` : props.email));
</script>

<template>
  <span class="avatar" :title="label" role="img" :aria-label="`Signed in as ${label}`">
    <img v-if="src && !failed" :src="src" alt="" referrerpolicy="no-referrer" @error="failed = true">
    <span v-else class="avatar-initials">{{ initials }}</span>
  </span>
</template>
