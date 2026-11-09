import { describe, it, expect } from 'vitest';
import { columnCount, dealColumns } from './mosaic.js';

describe('mosaic', () => {
  it('fits as many 220px columns as the width allows, at least one', () => {
    expect(columnCount(0)).toBe(1);
    expect(columnCount(219)).toBe(1);
    expect(columnCount(456)).toBe(2);
    expect(columnCount(1000)).toBe(4);
  });
  it('deals cards left to right, so the first ones form the top row', () => {
    expect(dealColumns([1, 2, 3, 4, 5], 3)).toEqual([[1, 4], [2, 5], [3]]);
    expect(dealColumns([1, 2], 4)).toEqual([[1], [2], [], []]);
    expect(dealColumns([1, 2], 0)).toEqual([[1, 2]]);
  });
});
