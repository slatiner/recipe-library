// Stock photos for a card without one: the photo-search edge function asks
// Pexels. A picked photo is stored as a link with its photographer's credit.

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export const PEXELS_URL = 'https://www.pexels.com';

// endpoint: the photo-search function, or null when signed out (code NO_KEY).
export async function searchPhotos(endpoint, query) {
  if (!endpoint) throw fail('NO_KEY', 'Sign in to find a photo.');
  if (!String(query || '').trim()) throw fail('NO_QUERY', 'Type what to search for.');
  let r;
  try {
    r = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...endpoint.headers },
      body: JSON.stringify({ query: query.trim() }),
    });
  } catch (e) {
    throw fail('NETWORK', "Couldn't reach the photo search. Check your connection.");
  }
  const body = await r.json().catch(() => null);
  if (r.ok && body && Array.isArray(body.photos)) return body.photos;
  if (r.status === 401) throw fail(401, 'Your sign-in has expired. Reload the page and sign in again.');
  const message = body && body.error && body.error.message;
  throw fail(r.status, message || `The photo search failed (HTTP ${r.status}).`);
}

// The fields a card keeps for a picked photo.
export const stockPhoto = (p) => ({ imageUrl: p.url, imageSource: 'stock', imageCredit: p.photographer, imageCreditUrl: p.photographerUrl });
export const noPhoto = () => ({ imageUrl: null, imageSource: null, imageCredit: null, imageCreditUrl: null });
