import { describe, it, expect } from 'vitest';
import { searchUrl, toPhotos, licenceLabel } from './photos.js';

describe('photo-search', () => {
  it('searches Openverse photographs for the title, nine at a time', () => {
    expect(searchUrl('  Gochujang   mince gnocchi ')).toBe('https://api.openverse.org/v1/images/?q=Gochujang+mince+gnocchi&page_size=9&category=photograph');
    expect(searchUrl('  ')).toBeNull();
    expect(searchUrl('x'.repeat(300))).toContain(`q=${'x'.repeat(100)}&`);
  });

  it('names the licence', () => {
    expect(licenceLabel('by-sa', '2.0')).toBe('CC BY-SA 2.0');
    expect(licenceLabel('by-nc-nd', '')).toBe('CC BY-NC-ND');
    expect(licenceLabel('cc0', '1.0')).toBe('CC0');
    expect(licenceLabel('pdm', '1.0')).toBe('Public domain');
    expect(licenceLabel(null)).toBe('');
  });

  it('keeps the sizes and the credit the card needs', () => {
    const body = { results: [
      { url: 'https://live.staticflickr.com/1_b.jpg', thumbnail: 'https://api.openverse.org/v1/images/a/thumb/', title: 'Lemon Chicken Gnocchi',
        creator: ' MattCC716 ', creator_url: 'https://www.flickr.com/photos/matt', foreign_landing_url: 'https://www.flickr.com/photos/matt/1',
        license: 'by-sa', license_version: '2.0' },
      { url: 'https://upload.wikimedia.org/2.jpg', creator: '', creator_url: 'https://commons.wikimedia.org/wiki/User:X', license: 'cc0' },
      { url: 'https://example.org/3.jpg', thumbnail: 'javascript:x' },
      { thumbnail: 'https://api.openverse.org/v1/images/d/thumb/' },
      { url: 'http://insecure.example/5.jpg' },
    ] };
    expect(toPhotos(body)).toEqual([
      { thumb: 'https://api.openverse.org/v1/images/a/thumb/', url: 'https://live.staticflickr.com/1_b.jpg', alt: 'Lemon Chicken Gnocchi',
        photographer: 'MattCC716, CC BY-SA 2.0', photographerUrl: 'https://www.flickr.com/photos/matt/1' },
      { thumb: 'https://upload.wikimedia.org/2.jpg', url: 'https://upload.wikimedia.org/2.jpg', alt: '',
        photographer: 'Unknown, CC0', photographerUrl: 'https://commons.wikimedia.org/wiki/User:X' },
      { thumb: 'https://example.org/3.jpg', url: 'https://example.org/3.jpg', alt: '', photographer: 'Unknown', photographerUrl: 'https://openverse.org' },
    ]);
    expect(toPhotos(null)).toEqual([]);
  });
});
