<script setup>
// Edits one card: the preview after parsing, and Edit on the recipe page.
// Works on its own copy; Save emits the cleaned card, Cancel drops the edits.
import { computed, reactive, ref } from 'vue';
import { UNITS, normalizeIngredient } from '../lib/recipes.js';

const props = defineProps({
  modelValue: { type: Object, required: true },
  saving: { type: Boolean, default: false },
  error: { type: String, default: '' },
  cancelLabel: { type: String, default: 'Cancel' },
});
const emit = defineEmits(['save', 'cancel']);

// A plain copy (structuredClone can't copy Vue's reactive proxies).
const draft = reactive(JSON.parse(JSON.stringify(props.modelValue)));
const rows = ref(draft.ingredients.map((i) => ({ ...i, amount: i.amount === null ? '' : String(i.amount) })));
const stepsText = ref(draft.steps.map((s) => s.text).join('\n'));
const tagsText = ref(draft.tags.join(', '));
const canSave = computed(() => !!draft.title.trim() && !props.saving);

const blankRow = () => ({ group: null, amount: '', unit: null, item: '', note: null });
function addRow() { rows.value.push(blankRow()); }
function removeRow(i) { rows.value.splice(i, 1); }
// Steps the user typed are theirs, not the source's.
function editSteps(e) {
  stepsText.value = e.target.value;
  draft.stepsOrigin = 'user';
}

const minutes = (v) => { const n = parseInt(v, 10); return n > 0 ? n : null; };
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function save() {
  if (!canSave.value) return;
  emit('save', {
    ...draft,
    title: draft.title.trim(),
    summary: text(draft.summary),
    notes: text(draft.notes),
    servings: minutes(draft.servings),
    prepMinutes: minutes(draft.prepMinutes),
    cookMinutes: minutes(draft.cookMinutes),
    ingredients: rows.value
      .map((r) => normalizeIngredient({ ...r, amount: String(r.amount).trim().replace(',', '.') }))
      .filter((i) => i.item),
    steps: stepsText.value.split('\n').map((t) => t.trim()).filter(Boolean).map((t) => ({ text: t })),
    tags: [...new Set(tagsText.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))],
  });
}
</script>

<template>
  <form class="recipe-editor" @submit.prevent="save">
    <div class="field">
      <label>Title</label>
      <input v-model="draft.title" class="title" maxlength="200">
      <p v-if="!draft.title.trim()" class="field-hint">Give it a title to save it.</p>
    </div>
    <div class="field">
      <label>Summary</label>
      <textarea v-model="draft.summary" rows="2"></textarea>
    </div>
    <div class="editor-numbers">
      <div class="field"><label>Servings</label><input v-model="draft.servings" type="number" min="1" inputmode="numeric"></div>
      <div class="field"><label>Prep (min)</label><input v-model="draft.prepMinutes" type="number" min="0" inputmode="numeric"></div>
      <div class="field"><label>Cook (min)</label><input v-model="draft.cookMinutes" type="number" min="0" inputmode="numeric"></div>
    </div>

    <div class="field">
      <label>Ingredients</label>
      <div v-for="(r, i) in rows" :key="i" class="ing-row">
        <input v-model="r.amount" class="amount" inputmode="decimal" aria-label="Amount" placeholder="Amount">
        <select v-model="r.unit" class="unit" aria-label="Unit">
          <option :value="null"></option>
          <option v-for="u in UNITS" :key="u" :value="u">{{ u }}</option>
        </select>
        <input v-model="r.item" class="item" aria-label="Ingredient" placeholder="Ingredient">
        <input v-model="r.note" class="note" aria-label="Note" placeholder="Note">
        <input v-model="r.group" class="group" aria-label="Section" placeholder="Section">
        <button type="button" class="link-btn" :aria-label="`Remove ${r.item || 'row'}`" @click="removeRow(i)">×</button>
      </div>
      <button type="button" class="btn ghost small" @click="addRow">Add ingredient</button>
    </div>

    <div class="field">
      <label>Method, one step per line</label>
      <textarea class="steps" rows="8" :value="stepsText" @input="editSteps"></textarea>
    </div>
    <div class="field">
      <label>Tags, separated by commas</label>
      <input v-model="tagsText" class="tags">
    </div>
    <div class="field">
      <label>Notes</label>
      <textarea v-model="draft.notes" rows="3"></textarea>
    </div>

    <p v-if="error" class="editor-error redeem-error">{{ error }}</p>
    <div class="form-actions">
      <button type="button" class="btn ghost" @click="emit('cancel')">{{ cancelLabel }}</button>
      <button type="submit" class="btn" :disabled="!canSave">{{ saving ? 'Saving…' : 'Save' }}</button>
    </div>
  </form>
</template>
