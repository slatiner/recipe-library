import { describe, it, expect } from 'vitest';
import { searchUrl, toPhotos } from './photos.js';

describe('photo-search', () => {
  it('searches Pexels for the title, nine landscape photos', () => {
    expect(searchUrl('  Gochujang   mince gnocchi ')).toBe('https://api.pexels.com/v1/search?query=Gochujang+mince+gnocchi&per_page=9&orientation=landscape');
    expect(searchUrl('  ')).toBeNull();
    expect(searchUrl('x'.repeat(300))).toContain(`query=${'x'.repeat(100)}&`);
  });

  it('keeps the sizes and the credit the card needs', () => {
    const body = { photos: [
      { url: 'https://www.pexels.com/photo/1/', photographer: ' Jane Doe ', photographer_url: 'https://www.pexels.com/@jane', alt: 'Gnocchi',
        src: { medium: 'https://images.pexels.com/1-m.jpg', large: 'https://images.pexels.com/1-l.jpg' } },
      { url: 'https://www.pexels.com/photo/2/', photographer: '', src: { small: 'https://images.pexels.com/2-s.jpg', original: 'https://images.pexels.com/2-o.jpg' } },
      { photographer: 'No image', src: {} },
      { photographer: 'Bad', src: { medium: 'javascript:x', large: 'https://images.pexels.com/3.jpg' } },
    ] };
    expect(toPhotos(body)).toEqual([
      { thumb: 'https://images.pexels.com/1-m.jpg', url: 'https://images.pexels.com/1-l.jpg', alt: 'Gnocchi', photographer: 'Jane Doe', photographerUrl: 'https://www.pexels.com/@jane' },
      { thumb: 'https://images.pexels.com/2-s.jpg', url: 'https://images.pexels.com/2-o.jpg', alt: '', photographer: 'Pexels', photographerUrl: 'https://www.pexels.com/photo/2/' },
    ]);
    expect(toPhotos(null)).toEqual([]);
  });
});
