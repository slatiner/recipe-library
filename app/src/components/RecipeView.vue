<script setup>
// One recipe on its own page (#/recipe/<id>), as a card: read it, star it,
// share it by link, edit it in place or delete it; the X goes back to the library.
import { computed, ref } from 'vue';
import { recipes, saveRecipe, deleteRecipe, toggleStar, shareRecipe, stopSharing, shareUrl, showToast } from '../state.js';
import { formatCookedOn } from '../lib/recipes.js';
import { copyText } from '../lib/clipboard.js';
import { go } from '../lib/route.js';
import Modal from './Modal.vue';
import RecipeEditor from './RecipeEditor.vue';
import MissingSteps from './MissingSteps.vue';
import PhotoPicker from './PhotoPicker.vue';
import PhotoCredit from './PhotoCredit.vue';
import CookedDialog from './CookedDialog.vue';
import RecipeBody from './RecipeBody.vue';
import CopyFallback from './CopyFallback.vue';
import { stockPhoto } from '../lib/photos.js';

const props = defineProps({ id: { type: String, required: true } });
const recipe = computed(() => recipes.value.find((r) => r.id === props.id) || null);

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

// Share link turns sharing on and copies the link; if the clipboard refuses,
// the link shows to copy by hand.
const fallbackLink = ref('');
async function copyLink() {
  error.value = '';
  fallbackLink.value = '';
  // The copy starts before the link exists (see lib/clipboard.js).
  const link = recipe.value.shareToken ? Promise.resolve(shareUrl(recipe.value.shareToken)) : shareRecipe(props.id).then(shareUrl);
  const copied = copyText(link);
  let url;
  try { url = await link; } catch (e) { error.value = e.message; return; }
  if (await copied) showToast('Link copied');
  else fallbackLink.value = url;
}
async function unshare() {
  error.value = '';
  fallbackLink.value = '';
  try { await stopSharing(props.id); } catch (e) { error.value = e.message; }
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
      <RecipeBody :recipe="recipe">
        <template #no-steps><MissingSteps :recipe="recipe" @steps="addSteps" /></template>
      </RecipeBody>
      <div v-if="recipe.shareToken" class="share-row">
        <span>Shared by link</span>
        <button class="btn ghost small" @click="copyLink">Copy link</button>
        <button class="btn ghost small" @click="unshare">Stop sharing</button>
      </div>
      <CopyFallback v-if="fallbackLink" :text="fallbackLink" />
      <p v-if="error" class="redeem-error">{{ error }}</p>
      <div class="recipe-actions">
        <button v-if="recipe.status === 'wishlist'" class="btn small" @click="cookedOpen = true">Cooked it</button>
        <button v-if="!recipe.shareToken" class="btn ghost small" @click="copyLink">Share link</button>
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
