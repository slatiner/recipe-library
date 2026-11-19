<script setup>
// The source video or post, played in YouTube's or Instagram's own player.
// The player only loads on a click, so opening a recipe doesn't contact either
// platform (beyond the YouTube thumbnail).
import { computed, ref } from 'vue';
import { embedOf } from '../lib/embeds.js';

const props = defineProps({ url: { type: String, default: '' } });
const embed = computed(() => embedOf(props.url));
const open = ref(false);
const posterFailed = ref(false);
</script>

<template>
  <figure v-if="embed" class="source-embed" :class="`embed-${embed.kind}`">
    <iframe v-if="open" :src="embed.src" :title="embed.kind === 'youtube' ? 'YouTube video' : 'Instagram post'"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin" />
    <button v-else-if="embed.kind === 'youtube'" type="button" class="embed-poster" aria-label="Play the video" @click="open = true">
      <img v-if="!posterFailed" :src="embed.poster" alt="" loading="lazy" referrerpolicy="no-referrer" @error="posterFailed = true">
      <span class="embed-play" aria-hidden="true">▶</span>
    </button>
    <button v-else type="button" class="btn ghost small" @click="open = true">Show the Instagram post</button>
    <figcaption v-if="!open">Loads from {{ embed.kind === 'youtube' ? 'YouTube' : 'Instagram' }} when you open it.</figcaption>
  </figure>
</template>
