<script setup>
// The library: a Want to cook / Cooked toggle, search, a Starred toggle, tag chips and a mosaic of recipes,
// newest first along the top row (lib/mosaic.js). Shopping list switches to a
// pick mode: tap recipes, from either list, and copy their merged list.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { recipes, toggleStar, currentList, listFilters, showToast } from '../state.js';
import { filterRecipes, allTags } from '../lib/recipes.js';
import { go } from '../lib/route.js';
import { columnCount, dealColumns } from '../lib/mosaic.js';
import { shoppingList } from '../lib/shopping.js';
import { copyText } from '../lib/clipboard.js';
import CookedDialog from './CookedDialog.vue';
import CopyFallback from './CopyFallback.vue';

const error = ref('');

const LISTS = [{ id: 'wishlist', label: 'Want to cook' }, { id: 'cooked', label: 'Cooked' }];
// The current list's own filters (state.js keeps them while a recipe is open).
const f = computed(() => listFilters[currentList.value]);
const inList = computed(() => recipes.value.filter((r) => r.status === currentList.value));
// Most used first. A picked tag goes to the front, so it's never folded away
// behind More, and stays a chip even when no card has it any more (its last
// one moved or was deleted), so the filter can still be seen and cleared.
const tags = computed(() => {
  const list = allTags(inList.value);
  return f.value.tag ? [f.value.tag, ...list.filter((t) => t !== f.value.tag)] : list;
});

// The tags fold to one line; » appears only when they don't fit.
const tagList = ref(null);
const tagsOpen = ref(false);
const tagsOverflow = ref(false);
function measureTags() {
  if (tagList.value && !tagsOpen.value) tagsOverflow.value = tagList.value.scrollHeight > tagList.value.clientHeight + 1;
}
watch(tags, () => nextTick(measureTags));
const shown = computed(() => filterRecipes(inList.value, f.value));

// Columns follow the library's width.
const grid = ref(null);
const columns = ref(1);
const dealt = computed(() => dealColumns(shown.value, columns.value));
let observer = null;
function measure() {
  if (grid.value) columns.value = columnCount(grid.value.clientWidth);
  measureTags();
}
onMounted(() => {
  measure();
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure);
    if (grid.value) observer.observe(grid.value);
  }
});
onBeforeUnmount(() => observer && observer.disconnect());

function clearFilters() { Object.assign(f.value, { query: '', tag: '', starredOnly: false }); }
const totalTime = (r) => { const t = (r.prepMinutes || 0) + (r.cookMinutes || 0); return t ? `${t} min` : ''; };

// The source site's photo (a link); a tile whose photo fails to load drops it.
const failed = ref(new Set());
const photo = (r) => (/^https?:\/\//i.test(r.imageUrl || '') && !failed.value.has(r.id) ? r.imageUrl : null);
function photoFailed(r) { failed.value = new Set(failed.value).add(r.id); }

// ✓ on a wish opens the date dialog.
const cooking = ref(null);
const cookedOpen = ref(false);
function cooked(r) { cooking.value = r; cookedOpen.value = true; }

// Pick mode. The selection is ids; what's selected is read from recipes, so a
// deleted recipe drops out.
const picking = ref(false);
const picked = ref(new Set());
const selected = computed(() => recipes.value.filter((r) => picked.value.has(r.id)));
const fallbackList = ref('');
function open(r) {
  if (!picking.value) { go(`#/recipe/${r.id}`); return; }
  const next = new Set(picked.value);
  if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
  picked.value = next;
}
function stopPicking() {
  picking.value = false;
  picked.value = new Set();
  fallbackList.value = '';
}
async function copyList() {
  const text = shoppingList(selected.value);
  fallbackList.value = '';
  if (await copyText(text)) showToast('List copied');
  else fallbackList.value = text;
}

async function star(r) {
  error.value = '';
  try { await toggleStar(r.id); } catch (e) { error.value = e.message; }
}
</script>

<template>
  <div class="library">
    <div class="library-bar">
      <input v-model="f.query" class="search" type="search" placeholder="Search recipes and ingredients" aria-label="Search">
      <button class="input-btn starred-toggle" :aria-pressed="f.starredOnly" :class="{ active: f.starredOnly }"
        @click="f.starredOnly = !f.starredOnly">★ Starred</button>
      <button class="input-btn shopping-toggle" :aria-pressed="String(picking)" :class="{ active: picking }"
        @click="picking ? stopPicking() : (picking = true)">Shopping list</button>
      <!-- Pushed right; on a phone it takes the first line. -->
      <div class="list-toggle" role="group" aria-label="List">
        <button v-for="l in LISTS" :key="l.id" :class="{ active: currentList === l.id }"
          :aria-pressed="String(currentList === l.id)" @click="currentList = l.id">{{ l.label }}</button>
      </div>
    </div>
    <div v-if="tags.length" class="tag-row" :class="{ open: tagsOpen }">
      <div ref="tagList" class="tag-list">
        <button v-for="t in tags" :key="t" class="tag-chip" :class="{ active: f.tag === t }" :aria-pressed="f.tag === t"
          @click="f.tag = f.tag === t ? '' : t">{{ t }}</button>
      </div>
      <button v-if="tagsOverflow || tagsOpen" class="link-btn tag-more" :aria-expanded="String(tagsOpen)"
        :aria-label="tagsOpen ? 'Fewer tags' : 'More tags'" :title="tagsOpen ? 'Fewer tags' : 'More tags'"
        @click="tagsOpen = !tagsOpen; nextTick(measureTags)">{{ tagsOpen ? '«' : '»' }}</button>
    </div>
    <p v-if="error" class="library-error redeem-error">{{ error }}</p>
    <div v-if="picking" class="pick-bar">
      <span>{{ selected.length }} selected</span>
      <button class="btn small" :disabled="!selected.length" @click="copyList">Copy list</button>
      <button class="btn ghost small" @click="stopPicking">Cancel</button>
      <CopyFallback v-if="fallbackList" :text="fallbackList" />
    </div>

    <div v-if="!recipes.length" class="empty">No recipes yet.</div>
    <div v-else-if="!inList.length" class="empty">Nothing here yet.</div>
    <div v-else-if="!shown.length" class="empty">
      No recipes match. <button class="link-btn" @click="clearFilters">Clear filters</button>
    </div>
    <!-- Always rendered, so its width can be measured. -->
    <div ref="grid" class="recipe-grid" :hidden="!shown.length">
      <div v-for="(col, c) in dealt" :key="c" class="recipe-col">
        <div v-for="r in col" :key="r.id" class="recipe-tile" :class="{ selected: picking && picked.has(r.id) }"
          :role="picking ? 'button' : 'link'" :aria-pressed="picking ? String(picked.has(r.id)) : undefined" tabindex="0"
          @click="open(r)" @keydown.enter="open(r)">
          <img v-if="photo(r)" class="tile-photo" :src="photo(r)" alt="" loading="lazy" referrerpolicy="no-referrer" @error="photoFailed(r)">
          <div class="tile-head">
            <h3 class="tile-title">{{ r.title }}</h3>
            <button v-if="!picking" class="star-btn" :aria-pressed="String(!!r.starred)" :aria-label="r.starred ? 'Unstar' : 'Star'"
              @click.stop="star(r)" @keydown.enter.stop>{{ r.starred ? '★' : '☆' }}</button>
            <button v-if="!picking && r.status === 'wishlist'" class="cooked-btn" aria-label="Cooked it" title="Cooked it"
              @click.stop="cooked(r)" @keydown.enter.stop>✓</button>
          </div>
          <p v-if="r.summary" class="tile-summary">{{ r.summary }}</p>
          <div v-if="totalTime(r) || r.tags.length" class="tile-meta">
            <span v-if="totalTime(r)">{{ totalTime(r) }}</span>
            <span v-for="t in r.tags.slice(0, 3)" :key="t" class="tile-tag">{{ t }}</span>
          </div>
        </div>
      </div>
    </div>
    <CookedDialog v-model:open="cookedOpen" :recipe="cooking" />
  </div>
</template>
