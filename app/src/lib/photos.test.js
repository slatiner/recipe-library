import { describe, it, expect } from 'vitest';
import { creditSite } from './photos.js';

describe('creditSite', () => {
  it('names where a stock photo lives, Openverse when unknown', () => {
    expect(creditSite('https://www.flickr.com/photos/jane/1')).toEqual({ name: 'Flickr', url: 'https://www.flickr.com' });
    expect(creditSite('https://commons.wikimedia.org/wiki/File:x.jpg')).toEqual({ name: 'Wikimedia Commons', url: 'https://commons.wikimedia.org' });
    expect(creditSite('https://notflickr.com/x')).toEqual({ name: 'Openverse', url: 'https://openverse.org' });
    expect(creditSite(null)).toEqual({ name: 'Openverse', url: 'https://openverse.org' });
  });
});
