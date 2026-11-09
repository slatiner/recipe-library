// What photo-search asks Pexels and returns to the app. Plain JavaScript so
// the Deno function and the Vitest tests load the same file.

export const PER_PAGE = 9;

// The search address for a recipe title: food photos, landscape first.
// null when there's nothing to search for.
export function searchUrl(query) {
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!q) return null;
  const params = new URLSearchParams({ query: q, per_page: String(PER_PAGE), orientation: 'landscape' });
  return `https://api.pexels.com/v1/search?${params}`;
}

const http = (v) => (typeof v === 'string' && /^https:\/\//i.test(v) ? v : null);

// Pexels' answer cut down to what the picker shows and the card keeps.
export function toPhotos(body) {
  return ((body && body.photos) || [])
    .map((p) => ({
      thumb: http(p.src && (p.src.medium || p.src.small)),
      url: http(p.src && (p.src.large || p.src.large2x || p.src.original)),
      alt: typeof p.alt === 'string' ? p.alt : '',
      photographer: typeof p.photographer === 'string' && p.photographer.trim() ? p.photographer.trim().slice(0, 200) : 'Pexels',
      photographerUrl: http(p.photographer_url) || http(p.url) || 'https://www.pexels.com',
    }))
    .filter((p) => p.thumb && p.url);
}
