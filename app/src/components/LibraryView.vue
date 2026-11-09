<script setup>
// The library: search, a Starred toggle, tag chips and a mosaic of recipes,
// newest first along the top row (lib/mosaic.js).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { recipes, toggleStar } from '../state.js';
import { filterRecipes, allTags } from '../lib/recipes.js';
import { go } from '../lib/route.js';
import { columnCount, dealColumns } from '../lib/mosaic.js';

const emit = defineEmits(['add']);
const query = ref('');
const tag = ref('');
const starredOnly = ref(false);
const error = ref('');

const tags = computed(() => allTags(recipes.value));
const shown = computed(() => filterRecipes(recipes.value, { query: query.value, tag: tag.value, starredOnly: starredOnly.value }));
const filtering = computed(() => !!(query.value.trim() || tag.value || starredOnly.value));

// Columns follow the library's width.
const grid = ref(null);
const columns = ref(1);
const dealt = computed(() => dealColumns(shown.value, columns.value));
let observer = null;
function measure() { if (grid.value) columns.value = columnCount(grid.value.clientWidth); }
onMounted(() => {
  measure();
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure);
    if (grid.value) observer.observe(grid.value);
  }
});
onBeforeUnmount(() => observer && observer.disconnect());

function clearFilters() { query.value = ''; tag.value = ''; starredOnly.value = false; }
const totalTime = (r) => { const t = (r.prepMinutes || 0) + (r.cookMinutes || 0); return t ? `${t} min` : ''; };

// The source site's photo (a link); a tile whose photo fails to load drops it.
const failed = ref(new Set());
const photo = (r) => (/^https?:\/\//i.test(r.imageUrl || '') && !failed.value.has(r.id) ? r.imageUrl : null);
function photoFailed(r) { failed.value = new Set(failed.value).add(r.id); }

async function star(r) {
  error.value = '';
  try { await toggleStar(r.id); } catch (e) { error.value = e.message; }
}
</script>

<template>
  <div class="library">
    <div class="library-bar">
      <input v-model="query" class="search" type="search" placeholder="Search recipes and ingredients" aria-label="Search">
      <button class="input-btn starred-toggle" :aria-pressed="starredOnly" :class="{ active: starredOnly }"
        @click="starredOnly = !starredOnly">★ Starred</button>
      <span style="flex:1;"></span>
      <button class="add-new-btn" @click="emit('add')">Add recipe</button>
    </div>
    <div v-if="tags.length" class="tag-row">
      <button v-for="t in tags" :key="t" class="tag-chip" :class="{ active: tag === t }" :aria-pressed="tag === t"
        @click="tag = tag === t ? '' : t">{{ t }}</button>
    </div>
    <p v-if="error" class="library-error redeem-error">{{ error }}</p>

    <div v-if="!recipes.length" class="empty">No recipes yet.</div>
    <div v-else-if="!shown.length" class="empty">
      No recipes match. <button class="link-btn" @click="clearFilters">Clear filters</button>
    </div>
    <!-- Always rendered, so its width can be measured. -->
    <div ref="grid" class="recipe-grid" :hidden="!shown.length">
      <div v-for="(col, c) in dealt" :key="c" class="recipe-col">
        <div v-for="r in col" :key="r.id" class="recipe-tile" role="link" tabindex="0"
          @click="go(`#/recipe/${r.id}`)" @keydown.enter="go(`#/recipe/${r.id}`)">
          <img v-if="photo(r)" class="tile-photo" :src="photo(r)" alt="" loading="lazy" referrerpolicy="no-referrer" @error="photoFailed(r)">
          <div class="tile-head">
            <h3 class="tile-title">{{ r.title }}</h3>
            <button class="star-btn" :aria-pressed="String(!!r.starred)" :aria-label="r.starred ? 'Unstar' : 'Star'"
              @click.stop="star(r)" @keydown.enter.stop>{{ r.starred ? '★' : '☆' }}</button>
          </div>
          <p v-if="r.summary" class="tile-summary">{{ r.summary }}</p>
          <div v-if="totalTime(r) || r.tags.length" class="tile-meta">
            <span v-if="totalTime(r)">{{ totalTime(r) }}</span>
            <span v-for="t in r.tags.slice(0, 3)" :key="t" class="tile-tag">{{ t }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
