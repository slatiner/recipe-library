<script setup>
// The read-only part of a recipe card, shared by the owner's page and the
// public share page: times, ingredients by section, the method (with the AI
// badge), notes, tags and the source. The no-steps slot fills an empty method.
import { computed } from 'vue';
import { formatAmount } from '../lib/recipes.js';

const props = defineProps({ recipe: { type: Object, required: true } });

// Ingredients in their sections, in the order they first appear.
const sections = computed(() => {
  const out = [];
  for (const i of props.recipe.ingredients) {
    const last = out.at(-1);
    if (last && last.group === i.group) last.items.push(i);
    else out.push({ group: i.group, items: [i] });
  }
  return out;
});
const times = computed(() => {
  const r = props.recipe;
  return [r.servings && `Serves ${r.servings}`, r.prepMinutes && `Prep ${r.prepMinutes} min`, r.cookMinutes && `Cook ${r.cookMinutes} min`].filter(Boolean);
});

// Only web addresses become links; anything else (javascript:...) is shown as text.
const sourceLink = computed(() => (/^https?:\/\//i.test(props.recipe.sourceUrl || '') ? props.recipe.sourceUrl : null));
</script>

<template>
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

  <section v-if="recipe.steps.length || $slots['no-steps']" class="method">
    <h3>Method</h3>
    <p v-if="recipe.steps.length && recipe.stepsOrigin === 'ai_suggested'" class="ai-badge">AI suggested, may differ from the creator's</p>
    <ol v-if="recipe.steps.length" class="steps">
      <li v-for="(s, n) in recipe.steps" :key="n">{{ s.text }}</li>
    </ol>
    <slot v-else name="no-steps" />
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
</template>
