<script setup>
// Add a recipe: an optional title and the pasted text go to the assistant,
// which makes the card; the user edits it and saves. Errors, and closing the
// sheet before saving, keep what was typed, so nothing has to be pasted twice.
import { ref, watch } from 'vue';
import { parseRecipe, saveRecipe } from '../state.js';
import { MAX_PASTE } from '../lib/recipes.js';
import { go } from '../lib/route.js';
import Modal from './Modal.vue';
import RecipeEditor from './RecipeEditor.vue';

const open = defineModel('open', { type: Boolean, default: false });
const title = ref('');
const text = ref('');
const card = ref(null);
const reading = ref(false);
const error = ref('');
const saving = ref(false);
const saveError = ref('');

watch(open, (isOpen) => {
  if (!isOpen) return;
  error.value = '';
  saveError.value = '';
});

async function makeCard() {
  if (!text.value.trim() || reading.value) return;
  error.value = '';
  if (text.value.length > MAX_PASTE) {
    error.value = "That's over 12,000 characters. Paste just the ingredients and method.";
    return;
  }
  reading.value = true;
  try {
    card.value = (await parseRecipe({ title: title.value, text: text.value })).recipe;
  } catch (e) { error.value = e.message; }
  finally { reading.value = false; }
}

async function save(recipe) {
  saving.value = true;
  saveError.value = '';
  try {
    const saved = await saveRecipe(recipe);
    title.value = '';
    text.value = '';
    card.value = null;
    open.value = false;
    go(`#/recipe/${saved.id}`);
  } catch (e) { saveError.value = e.message; }
  finally { saving.value = false; }
}
</script>

<template>
  <Modal v-model:open="open" drawer>
    <div class="add-recipe">
      <h2>Add a recipe</h2>
      <form v-if="!card" @submit.prevent="makeCard">
        <div class="field">
          <label>Title (optional)</label>
          <input v-model="title" class="add-title" maxlength="200">
        </div>
        <div class="field">
          <label>Paste the recipe</label>
          <textarea v-model="text" class="paste" rows="14" placeholder="Ingredients and method, from a website, a post or your notes"></textarea>
        </div>
        <p v-if="error" class="add-error redeem-error">{{ error }}</p>
        <div class="form-actions">
          <button type="button" class="btn ghost" @click="open = false">Cancel</button>
          <button type="submit" class="btn" :disabled="reading || !text.trim()">{{ reading ? 'Reading…' : 'Make the card' }}</button>
        </div>
      </form>
      <RecipeEditor v-else :model-value="card" :saving="saving" :error="saveError" cancel-label="Back"
        @save="save" @cancel="card = null" />
    </div>
  </Modal>
</template>
