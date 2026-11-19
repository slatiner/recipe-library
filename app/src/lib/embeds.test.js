import { describe, it, expect } from 'vitest';
import { youtubeId, embedOf } from './embeds.js';

describe('youtubeId', () => {
  it('reads watch, short, shorts, embed and mobile links', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://youtu.be/dQw4w9WgXcQ?si=x',
      'https://youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    ]) expect(youtubeId(url)).toBe('dQw4w9WgXcQ');
  });
  it('anything else is null', () => {
    for (const url of ['https://www.youtube.com/@chef', 'https://youtube.com/watch?v=short', 'https://notyoutube.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', '', null]) {
      expect(youtubeId(url)).toBeNull();
    }
  });
});

describe('embedOf', () => {
  it('Instagram posts and reels use the public embed page', () => {
    expect(embedOf('https://www.instagram.com/p/XyZ_1/?igsh=a').src).toBe('https://www.instagram.com/p/XyZ_1/embed/');
    expect(embedOf('https://instagram.com/cook/reel/ABC/').src).toBe('https://www.instagram.com/reel/ABC/embed/');
  });
  it('a recipe site or an Instagram profile has nothing to embed', () => {
    expect(embedOf('https://cook.example/gnudi')).toBeNull();
    expect(embedOf('https://www.instagram.com/cook/')).toBeNull();
  });
});
