// Links in the paste box. The import-url edge function fetches the page and
// returns its text; the LLM (llm.js) then makes the card from it.

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// The paste box holds a link and nothing else: the link, else null.
export function linkOnly(text) {
  const t = String(text || '').trim();
  return /^https?:\/\/\S+$/i.test(t) ? t : null;
}

export const isInstagram = (url) => /^https?:\/\/(www\.)?(instagram\.com|instagr\.am)\//i.test(url);

// Web links in a caption ("full recipe on my site: …"), without Instagram's
// own and without trailing punctuation.
export function linksIn(text) {
  const found = String(text || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  return [...new Set(found.map((u) => u.replace(/[.,;:!?]+$/, '')))].filter((u) => !isInstagram(u));
}

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; } };
export { hostOf };

// What to do when a link can't be read: always end in pasting.
function fallback(url) {
  return isInstagram(url) ? 'Paste the caption instead.' : 'Copy the recipe from the page and paste it instead.';
}

// endpoint: the import-url function, or null when signed out (code NO_KEY).
// Returns { kind, url, text, title, author, imageUrl }.
export async function importLink(endpoint, url) {
  if (!endpoint) throw fail('NO_KEY', 'Sign in to import a link.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw fail('NETWORK', "You're offline. Check your connection and try again.");
  }
  const what = isInstagram(url) ? "Couldn't read that post" : "Couldn't read that page";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let r;
  try {
    r = await fetch(endpoint.url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...endpoint.headers },
      body: JSON.stringify({ url }),
    });
  } catch (e) {
    throw fail('NETWORK', e && e.name === 'AbortError' ? `${what}: it took too long. ${fallback(url)}` : "Couldn't reach the importer. Check your connection.");
  } finally {
    clearTimeout(timer);
  }
  const body = await r.json().catch(() => null);
  if (r.ok && body && typeof body.text === 'string') return body;
  const err = (body && body.error) || {};
  if (r.status === 401) throw fail(401, 'Your sign-in has expired. Reload the page and sign in again.');
  if (r.status === 403) throw fail(403, 'Redeem an invite code to import links.');
  if (r.status === 400 && err.code === 'bad_url') throw fail('BAD_URL', `${err.message} ${fallback(url)}`);
  const reason = r.status === 422 && err.message ? ` (${err.message.replace(/\.$/, '').toLowerCase()})` : r.status >= 500 ? ` (HTTP ${r.status})` : '';
  throw fail(err.code || r.status, `${what}${reason}. ${fallback(url)}`);
}
