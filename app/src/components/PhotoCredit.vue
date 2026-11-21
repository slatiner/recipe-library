<script setup>
// Who a card's photo is from: for a stock photo the creator and licence, on
// the site it lives on (Flickr, Wikimedia Commons…); else the recipe site.
import { computed } from 'vue';
import { hostOf } from '../lib/importer.js';
import { creditSite } from '../lib/photos.js';

const props = defineProps({ recipe: { type: Object, required: true } });
const httpOnly = (v) => (/^https?:\/\//i.test(v || '') ? v : null);
const creditLink = computed(() => httpOnly(props.recipe.imageCreditUrl));
const siteLink = computed(() => httpOnly(props.recipe.sourceUrl));
const stockSite = computed(() => creditSite(props.recipe.imageCreditUrl));
</script>

<template>
  <span v-if="recipe.imageSource === 'stock'" class="photo-credit">
    Photo: <a v-if="creditLink" :href="creditLink" target="_blank" rel="noopener noreferrer">{{ recipe.imageCredit || 'Unknown' }}</a><span v-else>{{ recipe.imageCredit || 'Unknown' }}</span>
    on <a :href="stockSite.url" target="_blank" rel="noopener noreferrer">{{ stockSite.name }}</a>
  </span>
  <span v-else class="photo-credit">
    Photo: <a v-if="siteLink" :href="siteLink" target="_blank" rel="noopener noreferrer">{{ hostOf(siteLink) }}</a><span v-else>{{ hostOf(recipe.imageUrl) }}</span>
  </span>
</template>
