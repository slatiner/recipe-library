import { describe, it, expect } from 'vitest';
import { parseHash } from './route.js';

describe('parseHash', () => {
  it('the library is the default', () => {
    for (const h of ['', '#', '#/', '#/nowhere', '#/recipe/']) expect(parseHash(h)).toEqual({ name: 'library', id: null });
  });
  it('a recipe page carries its id', () => {
    expect(parseHash('#/recipe/abc-123')).toEqual({ name: 'recipe', id: 'abc-123' });
  });
});
