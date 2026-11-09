<script setup>
// A card without a method (posts often say "full recipe on my website"):
// suggest one with the assistant (labelled as AI), paste the steps or a link to
// the recipe's page, or get them from a link in the caption. Emits
// steps([{ text }], origin), origin being 'ai_suggested' or 'source'.
import { computed, ref } from 'vue';
import { importSteps, suggestMethod } from '../state.js';
import { linksIn, hostOf } from '../lib/importer.js';

const props = defineProps({ recipe: { type: Object, required: true } });
const emit = defineEmits(['steps']);

const busy = ref('');
const error = ref('');
const pasteOpen = ref(false);
const pasted = ref('');
const captionLink = computed(() => linksIn(props.recipe.sourceText)[0] || null);

async function run(kind, work, origin) {
  if (busy.value) return;
  busy.value = kind;
  error.value = '';
  try {
    emit('steps', await work(), origin);
    pasted.value = '';
    pasteOpen.value = false;
  } catch (e) { error.value = e.message; }
  finally { busy.value = ''; }
}
const suggest = () => run('suggest', () => suggestMethod(props.recipe), 'ai_suggested');
const fromLink = () => run('link', () => importSteps(captionLink.value), 'source');
function fromPaste() {
  if (pasted.value.trim()) run('paste', () => importSteps(pasted.value), 'source');
}
</script>

<template>
  <div class="missing-steps">
    <p class="missing-title"><b>Steps missing.</b> The source didn't include the method.</p>
    <div class="missing-actions">
      <button v-if="captionLink" type="button" class="btn small from-link" :disabled="!!busy" @click="fromLink">
        {{ busy === 'link' ? 'Reading…' : `Get the method from ${hostOf(captionLink)}` }}
      </button>
      <button type="button" class="btn ghost small suggest" :disabled="!!busy || !recipe.ingredients.length" @click="suggest">
        {{ busy === 'suggest' ? 'Writing…' : 'Suggest a method' }}
      </button>
      <button type="button" class="btn ghost small paste-open" :disabled="!!busy" @click="pasteOpen = !pasteOpen">Paste steps or a link</button>
    </div>
    <p class="field-hint">A suggested method is written by AI and may differ from the creator's.</p>
    <div v-if="pasteOpen" class="field">
      <textarea v-model="pasted" class="steps-paste" rows="5" aria-label="Steps or a link to the recipe's page"
        placeholder="The method, or a link to the recipe's page"></textarea>
      <button type="button" class="btn small add-steps" :disabled="!!busy || !pasted.trim()" @click="fromPaste">
        {{ busy === 'paste' ? 'Reading…' : 'Add the steps' }}
      </button>
    </div>
    <p v-if="error" class="missing-error redeem-error">{{ error }}</p>
  </div>
</template>
