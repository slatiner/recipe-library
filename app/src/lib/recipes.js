// Recipe helpers shared by the views and the parser: the card's shape, the
// metric units, amounts for display, and the library's search.

// The only units stored (v1 is metric). 'pc' counts things: 2 eggs.
export const UNITS = ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'pc'];

// Longest paste sent to the LLM; a whole copied web page is longer.
export const MAX_PASTE = 12000;

export function emptyRecipe() {
  return {
    title: '', summary: null, servings: null, prepMinutes: null, cookMinutes: null,
    ingredients: [], steps: [], stepsOrigin: 'source', tags: [], notes: null,
    sourceKind: 'text', sourceUrl: null, sourceAuthor: null, sourceText: '', imageUrl: null, imageSource: null, imageCredit: null, imageCreditUrl: null,
    status: 'wishlist', cookedOn: null, starred: false,
  };
}

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// One ingredient as stored. A unit outside UNITS isn't stored; it goes into the
// note ("1 cup") so the original measure isn't lost.
export function normalizeIngredient(i) {
  const n = Number(i.amount);
  const amount = i.amount !== null && i.amount !== '' && Number.isFinite(n) ? n : null;
  let unit = text(i.unit);
  let note = text(i.note);
  if (unit && !UNITS.includes(unit)) {
    const was = [amount, unit].filter((x) => x !== null).join(' ');
    note = note ? `${was}, ${note}` : was;
    unit = null;
  }
  return { group: text(i.group), amount, unit, item: typeof i.item === 'string' ? i.item.trim() : '', note };
}

// "200 g", "0.33 tsp", "3" (counted), or "" when there's no amount.
export function formatAmount(i) {
  if (i.amount === null || i.amount === undefined) return '';
  const n = String(Math.round(i.amount * 100) / 100);
  return i.unit && i.unit !== 'pc' ? `${n} ${i.unit}` : n;
}

// Lower case without accents, so "creme" finds "Crème brûlée".
const fold = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filterRecipes(list, { query = '', tag = '', starredOnly = false } = {}) {
  const q = fold(query.trim());
  return list.filter((r) => {
    if (starredOnly && !r.starred) return false;
    if (tag && !r.tags.some((t) => fold(t) === fold(tag))) return false;
    if (!q) return true;
    const hay = [r.title, r.summary, ...r.ingredients.map((i) => i.item), ...r.tags].map(fold).join('\n');
    return hay.includes(q);
  });
}

// Every tag once, in lower case: the most used first, then alphabetical.
export function allTags(list) {
  const uses = new Map();
  for (const r of list) for (const t of new Set(r.tags.map((x) => x.toLowerCase()))) uses.set(t, (uses.get(t) || 0) + 1);
  return [...uses.keys()].sort((a, b) => uses.get(b) - uses.get(a) || a.localeCompare(b));
}

// Today as 'YYYY-MM-DD' in the browser's time zone (toISOString would give UTC).
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "Cooked 1 Nov 2026". The date is read as local, so it doesn't shift a day.
export function formatCookedOn(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `Cooked ${new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
