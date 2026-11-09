<script setup>
// Add a recipe: an optional title and the pasted text (or a link, which
// import-url reads first) go to the assistant, which makes the card; the user edits it and saves. Errors, and closing the
// sheet before saving, keep what was typed, so nothing has to be pasted twice.
import { computed, nextTick, ref, watch } from 'vue';
import { parseRecipe, saveRecipe, currentList } from '../state.js';
import { MAX_PASTE } from '../lib/recipes.js';
import { go } from '../lib/route.js';
import { linkOnly } from '../lib/importer.js';
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
const isLink = computed(() => !!linkOnly(text.value));
const paste = ref(null);

watch(open, (isOpen) => {
  if (!isOpen) return;
  error.value = '';
  saveError.value = '';
  // Straight to the paste box (not when a card is still being reviewed).
  nextTick(() => { if (!card.value && paste.value) paste.value.focus({ preventScroll: true }); });
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
    // Saved to the list on screen, so a dish already made goes straight to Cooked.
    card.value = { ...(await parseRecipe({ title: title.value, text: text.value })).recipe, status: currentList.value };
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
          <label>Paste the recipe or a link</label>
          <textarea ref="paste" v-model="text" class="paste" rows="14" placeholder="Ingredients and method from anywhere, or a link to a recipe page or an Instagram post"></textarea>
        </div>
        <p v-if="error" class="add-error redeem-error">{{ error }}</p>
        <div class="form-actions">
          <button type="button" class="btn ghost" @click="open = false">Cancel</button>
          <button type="submit" class="btn" :disabled="reading || !text.trim()">{{ reading ? (isLink ? 'Reading the link…' : 'Reading…') : 'Make the card' }}</button>
        </div>
      </form>
      <RecipeEditor v-else :model-value="card" :saving="saving" :error="saveError" cancel-label="Back"
        @save="save" @cancel="card = null" />
    </div>
  </Modal>
</template>
