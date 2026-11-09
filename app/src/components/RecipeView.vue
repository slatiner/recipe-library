<script setup>
// One recipe on its own page (#/recipe/<id>): read it, star it, edit it in
// place or delete it.
import { computed, ref } from 'vue';
import { recipes, saveRecipe, deleteRecipe, toggleStar } from '../state.js';
import { formatAmount } from '../lib/recipes.js';
import { go } from '../lib/route.js';
import Modal from './Modal.vue';
import RecipeEditor from './RecipeEditor.vue';

const props = defineProps({ id: { type: String, required: true } });
const recipe = computed(() => recipes.value.find((r) => r.id === props.id) || null);

// Ingredients in their sections, in the order they first appear.
const sections = computed(() => {
  const out = [];
  for (const i of recipe.value.ingredients) {
    const last = out.at(-1);
    if (last && last.group === i.group) last.items.push(i);
    else out.push({ group: i.group, items: [i] });
  }
  return out;
});
const times = computed(() => {
  const r = recipe.value;
  return [r.servings && `Serves ${r.servings}`, r.prepMinutes && `Prep ${r.prepMinutes} min`, r.cookMinutes && `Cook ${r.cookMinutes} min`].filter(Boolean);
});

const editing = ref(false);
const saving = ref(false);
const error = ref('');
const confirmOpen = ref(false);

async function save(updated) {
  saving.value = true;
  error.value = '';
  try {
    await saveRecipe(updated);
    editing.value = false;
  } catch (e) { error.value = e.message; }
  finally { saving.value = false; }
}

async function star() {
  error.value = '';
  try { await toggleStar(props.id); } catch (e) { error.value = e.message; }
}

async function remove() {
  error.value = '';
  try {
    await deleteRecipe(props.id);
    confirmOpen.value = false;
    go('#/');
  } catch (e) { error.value = e.message; confirmOpen.value = false; }
}
</script>

<template>
  <div v-if="!recipe" class="recipe-missing empty">
    Recipe not found. <a href="#/">Back to the library</a>
  </div>
  <article v-else class="recipe-page">
    <a class="back-link" href="#/">← Library</a>
    <RecipeEditor v-if="editing" :model-value="recipe" :saving="saving" :error="error"
      @save="save" @cancel="editing = false; error = ''" />
    <template v-else>
      <div class="recipe-head">
        <h2>{{ recipe.title }}</h2>
        <button class="star-btn" :aria-pressed="String(!!recipe.starred)" :aria-label="recipe.starred ? 'Unstar' : 'Star'"
          @click="star">{{ recipe.starred ? '★' : '☆' }}</button>
      </div>
      <p v-if="recipe.summary" class="recipe-summary">{{ recipe.summary }}</p>
      <p v-if="times.length" class="recipe-times">{{ times.join(' · ') }}</p>
      <div class="recipe-actions">
        <button class="btn ghost small" @click="editing = true">Edit</button>
        <button class="btn danger small" @click="confirmOpen = true">Delete</button>
      </div>
      <p v-if="error" class="redeem-error">{{ error }}</p>

      <section v-if="recipe.ingredients.length" class="ingredients">
        <h3>Ingredients</h3>
        <template v-for="(s, n) in sections" :key="n">
          <h4 v-if="s.group">{{ s.group }}</h4>
          <ul>
            <li v-for="(i, k) in s.items" :key="k">
              <b v-if="formatAmount(i)" class="amt">{{ formatAmount(i) }}</b> {{ i.item }}
              <span v-if="i.note" class="ing-note">{{ i.note }}</span>
            </li>
          </ul>
        </template>
      </section>

      <section class="method">
        <h3>Method</h3>
        <ol v-if="recipe.steps.length" class="steps">
          <li v-for="(s, n) in recipe.steps" :key="n">{{ s.text }}</li>
        </ol>
        <p v-else class="steps-missing">No method yet. Use Edit to add the steps.</p>
      </section>

      <section v-if="recipe.notes" class="notes">
        <h3>Notes</h3>
        <p>{{ recipe.notes }}</p>
      </section>
      <div v-if="recipe.tags.length" class="tile-meta">
        <span v-for="t in recipe.tags" :key="t" class="tile-tag">{{ t }}</span>
      </div>
      <p v-if="recipe.sourceAuthor || recipe.sourceUrl" class="recipe-source">
        From <a v-if="recipe.sourceUrl" :href="recipe.sourceUrl" target="_blank" rel="noopener noreferrer">{{ recipe.sourceAuthor || recipe.sourceUrl }}</a>
        <span v-else>{{ recipe.sourceAuthor }}</span>
      </p>
    </template>

    <Modal v-model:open="confirmOpen">
      <div class="delete-confirm">
        <h2>Delete recipe</h2>
        <p>Delete {{ recipe.title }}? This can't be undone.</p>
        <div class="form-actions">
          <button class="btn ghost" @click="confirmOpen = false">Cancel</button>
          <button class="btn danger" @click="remove">Delete</button>
        </div>
      </div>
    </Modal>
  </article>
</template>
