import { describe, it, expect } from 'vitest';
import { UNITS, MAX_PASTE, emptyRecipe, normalizeIngredient, formatAmount, filterRecipes, allTags } from './recipes.js';

const ing = (o) => ({ group: null, amount: null, unit: null, item: 'x', note: null, ...o });

describe('normalizeIngredient', () => {
  it('keeps a metric ingredient as it is', () => {
    expect(normalizeIngredient(ing({ amount: 200, unit: 'g', item: 'flour' }))).toEqual(ing({ amount: 200, unit: 'g', item: 'flour' }));
  });

  it('a unit outside the metric list is dropped and kept in the note', () => {
    expect(normalizeIngredient(ing({ amount: 1, unit: 'cup', item: 'flour', note: 'sifted' })))
      .toEqual(ing({ amount: 1, unit: null, item: 'flour', note: '1 cup, sifted' }));
  });

  it('a non-numeric amount becomes null', () => {
    expect(normalizeIngredient(ing({ amount: 'a pinch' })).amount).toBe(null);
  });

  it('trims text and turns empty strings into null, except the item', () => {
    expect(normalizeIngredient({ group: ' ', amount: 2, unit: 'pc', item: ' eggs ', note: '' }))
      .toEqual({ group: null, amount: 2, unit: 'pc', item: 'eggs', note: null });
  });
});

describe('formatAmount', () => {
  it('formats amount and unit', () => {
    expect(formatAmount(ing({ amount: 200, unit: 'g' }))).toBe('200 g');
    expect(formatAmount(ing({ amount: 0.333333, unit: 'tsp' }))).toBe('0.33 tsp');
    expect(formatAmount(ing({ amount: 2, unit: null }))).toBe('2');
    expect(formatAmount(ing({ amount: null, unit: null }))).toBe('');
  });

  it('a counted item shows the number alone', () => {
    expect(formatAmount(ing({ amount: 3, unit: 'pc' }))).toBe('3');
  });
});

describe('filterRecipes and allTags', () => {
  const list = [
    { id: '1', title: 'Crème brûlée', summary: '', ingredients: [ing({ item: 'cream' })], tags: ['dessert', 'french'], starred: true },
    { id: '2', title: 'Tomato soup', summary: 'Quick', ingredients: [ing({ item: 'Tomatoes' })], tags: ['soup'], starred: false },
  ];
  const ids = (l) => l.map((r) => r.id);

  it('matches the title without accents or case', () => {
    expect(ids(filterRecipes(list, { query: 'CREME' }))).toEqual(['1']);
  });
  it('matches an ingredient', () => {
    expect(ids(filterRecipes(list, { query: 'tomato' }))).toEqual(['2']);
  });
  it('filters by tag and by star', () => {
    expect(ids(filterRecipes(list, { tag: 'soup' }))).toEqual(['2']);
    expect(ids(filterRecipes(list, { starredOnly: true }))).toEqual(['1']);
  });
  it('no filters keeps everything', () => {
    expect(ids(filterRecipes(list, {}))).toEqual(['1', '2']);
  });
  it('lists tags sorted and unique', () => {
    expect(allTags([...list, { ...list[1], id: '3', tags: ['Soup'] }])).toEqual(['dessert', 'french', 'soup']);
  });
});

describe('emptyRecipe', () => {
  it('is a blank pasted-text card', () => {
    expect(emptyRecipe()).toMatchObject({ title: '', ingredients: [], steps: [], tags: [], stepsOrigin: 'source', sourceKind: 'text', starred: false });
    expect(emptyRecipe().id).toBeUndefined();
    expect(UNITS).toEqual(['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'pc']);
    expect(MAX_PASTE).toBe(12000);
  });
});
