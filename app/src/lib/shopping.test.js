import { describe, it, expect } from 'vitest';
import { shoppingList } from './shopping.js';

const ing = (amount, unit, item) => ({ group: null, amount, unit, item, note: null });
const card = (title, ingredients) => ({ title, ingredients });
const items = (text) => text.split('\n').slice(2);

describe('shoppingList', () => {
  it('the header lists the titles in the order given, then a blank line', () => {
    const text = shoppingList([card('Soup', []), card('Bread', [])]);
    expect(text.split('\n').slice(0, 2)).toEqual(['Shopping list: Soup, Bread', '']);
  });

  it('sums the same item and unit, keeping the first spelling', () => {
    expect(items(shoppingList([card('A', [ing(200, 'g', 'flour')]), card('B', [ing(100, 'g', 'Flour')])]))).toEqual(['300 g flour']);
  });

  it('ignores accents and case when merging', () => {
    expect(items(shoppingList([card('A', [ing(100, 'ml', 'crème fraîche'), ing(50, 'ml', 'Creme fraiche ')])]))).toEqual(['150 ml crème fraîche']);
  });

  it('keeps g and kg apart', () => {
    expect(items(shoppingList([card('A', [ing(200, 'g', 'flour')]), card('B', [ing(1, 'kg', 'flour')])]))).toEqual(['200 g flour', '1 kg flour']);
  });

  it('lists an item without an amount once', () => {
    expect(items(shoppingList([card('A', [ing(null, null, 'salt')]), card('B', [ing(null, null, 'Salt')])]))).toEqual(['salt']);
  });

  it('an item with and without an amount keeps the amount', () => {
    expect(items(shoppingList([card('A', [ing(null, 'g', 'butter')]), card('B', [ing(50, 'g', 'butter')])]))).toEqual(['50 g butter']);
  });

  it('a counted item shows the number alone', () => {
    expect(items(shoppingList([card('A', [ing(3, 'pc', 'bananas')])]))).toEqual(['3 bananas']);
  });

  it('rounds sums', () => {
    expect(items(shoppingList([card('A', [ing(0.1, 'tsp', 'cumin')]), card('B', [ing(0.2, 'tsp', 'cumin')])]))).toEqual(['0.3 tsp cumin']);
  });

  it('sorts by item', () => {
    expect(items(shoppingList([card('A', [ing(2, 'pc', 'onions'), ing(1, 'pc', 'apple'), ing(null, null, 'Basil')])]))).toEqual(['1 apple', 'Basil', '2 onions']);
  });

  it('skips blank items', () => {
    expect(items(shoppingList([card('A', [ing(2, 'pc', ' ')])]))).toEqual([]);
  });
});
