<script setup>
// A recipe shared by link (#/r/<token>): read-only, no sign-in needed. Shows
// only what get_shared_recipe returns, and a photo only when it's a credited
// stock photo.
import { onMounted, ref } from 'vue';
import { getSharedRecipe } from '../state.js';
import RecipeBody from './RecipeBody.vue';
import PhotoCredit from './PhotoCredit.vue';

const props = defineProps({ token: { type: String, required: true } });
const recipe = ref(null);
const loading = ref(true);
const error = ref('');
const imageFailed = ref(false);
const httpOnly = (v) => (/^https?:\/\//i.test(v || '') ? v : null);

onMounted(async () => {
  try { recipe.value = await getSharedRecipe(props.token); }
  catch (e) { error.value = e.message; }
  finally { loading.value = false; }
});
</script>

<template>
  <article class="shared-recipe recipe-page">
    <p v-if="loading" class="empty">Loading…</p>
    <p v-else-if="error" class="empty">{{ error }}. Check your connection and reload.</p>
    <p v-else-if="!recipe" class="empty">This link doesn't work any more. Ask for a new one.</p>
    <template v-else>
      <figure v-if="httpOnly(recipe.imageUrl) && !imageFailed" class="recipe-photo">
        <img :src="recipe.imageUrl" :alt="recipe.title" loading="lazy" referrerpolicy="no-referrer" @error="imageFailed = true">
        <figcaption><PhotoCredit :recipe="recipe" /></figcaption>
      </figure>
      <div class="recipe-head"><h2>{{ recipe.title }}</h2></div>
      <p v-if="recipe.summary" class="recipe-summary">{{ recipe.summary }}</p>
      <RecipeBody :recipe="recipe" />
    </template>
    <footer class="site-foot">Recipe Library · <a href="privacy.html">Privacy</a></footer>
  </article>
</template>
