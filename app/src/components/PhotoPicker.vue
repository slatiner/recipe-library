<script setup>
// "Find a photo" for a card without one: searches Pexels (by the title to
// start with) and emits pick(photo) for the one chosen. A stock photo shows a
// similar dish, not this recipe, so it's never picked automatically.
import { onMounted, ref } from 'vue';
import { searchPhotos } from '../state.js';
import { PEXELS_URL } from '../lib/photos.js';

const props = defineProps({ query: { type: String, default: '' } });
const emit = defineEmits(['pick', 'close']);

const q = ref(props.query);
const photos = ref([]);
const searching = ref(false);
const searched = ref(false);
const error = ref('');

async function search() {
  if (searching.value || !q.value.trim()) return;
  searching.value = true;
  error.value = '';
  try {
    photos.value = await searchPhotos(q.value);
    searched.value = true;
  } catch (e) { error.value = e.message; }
  finally { searching.value = false; }
}
onMounted(search);
</script>

<template>
  <div class="photo-picker">
    <form class="picker-search" @submit.prevent="search">
      <input v-model="q" class="picker-query" aria-label="Search photos" placeholder="What to search for">
      <button type="submit" class="btn small" :disabled="searching || !q.trim()">{{ searching ? 'Searching…' : 'Search' }}</button>
      <button type="button" class="btn ghost small picker-close" @click="emit('close')">Cancel</button>
    </form>
    <p v-if="error" class="picker-error redeem-error">{{ error }}</p>
    <p v-else-if="searched && !photos.length" class="field-hint">No photos found. Try fewer or simpler words, like the main ingredient.</p>
    <div v-if="photos.length" class="picker-grid">
      <button v-for="p in photos" :key="p.url" type="button" class="picker-photo" :aria-label="`Use ${p.alt || 'this photo'} by ${p.photographer}`"
        @click="emit('pick', p)">
        <img :src="p.thumb" :alt="p.alt" loading="lazy" referrerpolicy="no-referrer">
      </button>
    </div>
    <p class="field-hint">A similar dish, not this recipe. Photos provided by <a :href="PEXELS_URL" target="_blank" rel="noopener noreferrer">Pexels</a>.</p>
  </div>
</template>
