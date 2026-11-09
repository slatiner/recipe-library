<script setup>
// One recipe on its own page (#/recipe/<id>), as a card: read it, star it,
// edit it in place or delete it; the X goes back to the library.
import { computed, ref } from 'vue';
import { recipes, saveRecipe, deleteRecipe, toggleStar } from '../state.js';
import { formatAmount, formatCookedOn } from '../lib/recipes.js';
import { go } from '../lib/route.js';
import Modal from './Modal.vue';
import RecipeEditor from './RecipeEditor.vue';
import MissingSteps from './MissingSteps.vue';
import PhotoPicker from './PhotoPicker.vue';
import PhotoCredit from './PhotoCredit.vue';
import CookedDialog from './CookedDialog.vue';
import { stockPhoto } from '../lib/photos.js';

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

// Only web addresses become links; anything else (javascript:...) is shown as text.
const sourceLink = computed(() => (/^https?:\/\//i.test(recipe.value.sourceUrl || '') ? recipe.value.sourceUrl : null));

// The source site's photo, linked rather than copied; hidden if it stops loading.
const imageLink = computed(() => (/^https?:\/\//i.test(recipe.value.imageUrl || '') ? recipe.value.imageUrl : null));
const imageFailed = ref(false);
// A card without a photo can pick a stock one; it's saved straight away.
const picking = ref(false);
async function pickPhoto(p) {
  await save({ ...JSON.parse(JSON.stringify(recipe.value)), ...stockPhoto(p) });
  if (!error.value) { picking.value = false; imageFailed.value = false; }
}

const editing = ref(false);
const saving = ref(false);
const error = ref('');
const confirmOpen = ref(false);
const cookedOpen = ref(false);

async function save(updated) {
  saving.value = true;
  error.value = '';
  try {
    await saveRecipe(updated);
    editing.value = false;
  } catch (e) { error.value = e.message; }
  finally { saving.value = false; }
}

// Steps from Steps missing are saved straight away.
async function addSteps(steps, origin) {
  await save({ ...JSON.parse(JSON.stringify(recipe.value)), steps, stepsOrigin: origin });
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
    <button v-if="!editing" type="button" class="close-btn" aria-label="Close" @click="go('#/')">×</button>
    <RecipeEditor v-if="editing" :model-value="recipe" :saving="saving" :error="error"
      @save="save" @cancel="editing = false; error = ''" />
    <template v-else>
      <figure v-if="imageLink && !imageFailed" class="recipe-photo">
        <img :src="imageLink" :alt="recipe.title" loading="lazy" referrerpolicy="no-referrer" @error="imageFailed = true">
        <figcaption><PhotoCredit :recipe="recipe" /></figcaption>
      </figure>
      <PhotoPicker v-else-if="picking" :query="recipe.title" @pick="pickPhoto" @close="picking = false" />
      <button v-else-if="!imageLink" type="button" class="btn ghost small find-photo" @click="picking = true">Find a photo</button>
      <div class="recipe-head">
        <h2>{{ recipe.title }}</h2>
        <button class="star-btn" :aria-pressed="String(!!recipe.starred)" :aria-label="recipe.starred ? 'Unstar' : 'Star'"
          @click="star">{{ recipe.starred ? '★' : '☆' }}</button>
      </div>
      <p v-if="recipe.status === 'cooked' && recipe.cookedOn" class="cooked-on">{{ formatCookedOn(recipe.cookedOn) }}</p>
      <p v-if="recipe.summary" class="recipe-summary">{{ recipe.summary }}</p>
      <p v-if="times.length" class="recipe-times">{{ times.join(' · ') }}</p>

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
        <p v-if="recipe.steps.length && recipe.stepsOrigin === 'ai_suggested'" class="ai-badge">AI suggested, may differ from the creator's</p>
        <ol v-if="recipe.steps.length" class="steps">
          <li v-for="(s, n) in recipe.steps" :key="n">{{ s.text }}</li>
        </ol>
        <MissingSteps v-else :recipe="recipe" @steps="addSteps" />
      </section>

      <section v-if="recipe.notes" class="notes">
        <h3>Notes</h3>
        <p>{{ recipe.notes }}</p>
      </section>
      <div v-if="recipe.tags.length" class="tile-meta">
        <span v-for="t in recipe.tags" :key="t" class="tile-tag">{{ t }}</span>
      </div>
      <p v-if="recipe.sourceAuthor || recipe.sourceUrl" class="recipe-source">
        From <a v-if="sourceLink" :href="sourceLink" target="_blank" rel="noopener noreferrer">{{ recipe.sourceAuthor || sourceLink }}</a>
        <span v-else>{{ recipe.sourceAuthor || recipe.sourceUrl }}</span>
      </p>
      <p v-if="error" class="redeem-error">{{ error }}</p>
      <div class="recipe-actions">
        <button v-if="recipe.status === 'wishlist'" class="btn small" @click="cookedOpen = true">Cooked it</button>
        <button class="btn ghost small" @click="editing = true">Edit</button>
        <button class="btn danger small" @click="confirmOpen = true">Delete</button>
      </div>
    </template>

    <CookedDialog v-model:open="cookedOpen" :recipe="recipe" />
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
