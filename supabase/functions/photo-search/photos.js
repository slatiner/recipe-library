// What photo-search asks Openverse and returns to the app. Plain JavaScript so
// the Deno function and the Vitest tests load the same file.
// Openverse (openverse.org, run by WordPress) indexes openly licensed photos,
// mostly from Flickr and Wikimedia Commons. No key; each photo is credited
// with its creator, licence and a link to where it lives.

export const PER_PAGE = 9;

// The search address for a recipe title: photographs only.
// null when there's nothing to search for.
export function searchUrl(query) {
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!q) return null;
  const params = new URLSearchParams({ q, page_size: String(PER_PAGE), category: 'photograph' });
  return `https://api.openverse.org/v1/images/?${params}`;
}

const http = (v) => (typeof v === 'string' && /^https:\/\//i.test(v) ? v : null);
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');

// "CC BY-SA 2.0", "CC0", "Public domain".
export function licenceLabel(licence, version) {
  const l = text(licence, 20).toLowerCase();
  if (!l) return '';
  if (l === 'cc0') return 'CC0';
  if (l === 'pdm') return 'Public domain';
  return `CC ${l.toUpperCase()}${text(version, 10) ? ` ${text(version, 10)}` : ''}`;
}

// Openverse's answer cut down to what the picker shows and the card keeps.
// The credit is "creator, licence"; its link is the photo's own page.
export function toPhotos(body) {
  return ((body && body.results) || [])
    .map((p) => {
      const licence = licenceLabel(p.license, p.license_version);
      const who = text(p.creator, 160) || 'Unknown';
      return {
        thumb: http(p.thumbnail) || http(p.url),
        url: http(p.url),
        alt: text(p.title, 200),
        photographer: licence ? `${who}, ${licence}` : who,
        photographerUrl: http(p.foreign_landing_url) || http(p.creator_url) || 'https://openverse.org',
      };
    })
    .filter((p) => p.thumb && p.url);
}
