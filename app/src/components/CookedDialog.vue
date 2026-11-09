<script setup>
// Moves a wish to Cooked, asking for the date it was cooked (today filled in,
// can be cleared). A failed save keeps the dialog open with the message.
import { ref, watch } from 'vue';
import { markCooked } from '../state.js';
import { today } from '../lib/recipes.js';
import Modal from './Modal.vue';

const open = defineModel('open', { type: Boolean, default: false });
const props = defineProps({ recipe: { type: Object, default: null } });
const date = ref('');
const saving = ref(false);
const error = ref('');

watch(open, (isOpen) => { if (isOpen) { date.value = today(); error.value = ''; } }, { immediate: true });

async function move() {
  saving.value = true;
  error.value = '';
  try {
    await markCooked(props.recipe.id, date.value || null);
    open.value = false;
  } catch (e) { error.value = e.message; }
  finally { saving.value = false; }
}
</script>

<template>
  <Modal v-model:open="open">
    <form v-if="recipe" class="cooked-dialog" @submit.prevent="move">
      <h2>Cooked {{ recipe.title }}</h2>
      <div class="field">
        <label for="cooked-date">Date cooked (optional)</label>
        <input id="cooked-date" v-model="date" type="date" :max="today()">
      </div>
      <p v-if="error" class="redeem-error">{{ error }}</p>
      <div class="form-actions">
        <button type="button" class="btn ghost" @click="open = false">Cancel</button>
        <button type="submit" class="btn" :disabled="saving">Move to Cooked</button>
      </div>
    </form>
  </Modal>
</template>
