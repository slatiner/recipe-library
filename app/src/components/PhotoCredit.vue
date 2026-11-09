<script setup>
// Who a card's photo is from: the photographer on Pexels for a stock photo,
// else the recipe site it came from.
import { computed } from 'vue';
import { hostOf } from '../lib/importer.js';
import { PEXELS_URL } from '../lib/photos.js';

const props = defineProps({ recipe: { type: Object, required: true } });
const httpOnly = (v) => (/^https?:\/\//i.test(v || '') ? v : null);
const creditLink = computed(() => httpOnly(props.recipe.imageCreditUrl));
const siteLink = computed(() => httpOnly(props.recipe.sourceUrl));
</script>

<template>
  <span v-if="recipe.imageSource === 'stock'" class="photo-credit">
    Photo: <a v-if="creditLink" :href="creditLink" target="_blank" rel="noopener noreferrer">{{ recipe.imageCredit || 'Pexels' }}</a><span v-else>{{ recipe.imageCredit || 'Pexels' }}</span>
    on <a :href="PEXELS_URL" target="_blank" rel="noopener noreferrer">Pexels</a>
  </span>
  <span v-else class="photo-credit">
    Photo: <a v-if="siteLink" :href="siteLink" target="_blank" rel="noopener noreferrer">{{ hostOf(siteLink) }}</a><span v-else>{{ hostOf(recipe.imageUrl) }}</span>
  </span>
</template>
