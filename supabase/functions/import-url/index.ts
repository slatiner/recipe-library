// Fetches a recipe link for the app and returns its text; it never calls the
// LLM (the app sends the text to the groq function next). Members only, like
// groq, but it doesn't count against the daily limit: that LLM call does.
// Deployed with --no-verify-jwt; the function checks the caller itself.
//
// Recipe sites: the schema.org Recipe JSON-LD, else the page's text, plus the
// page's photo. Instagram posts and reels: the caption on the public embed
// page. That page is unofficial and against Meta's automated-access terms
// (ROADMAP.md, Decisions); it may break, and the app then asks for the caption
// to be pasted. It only has the caption for a plain (non-browser) request, so
// the user agent below says what this is.
//
// Only http(s), no private or local hosts (checked on every redirect), 10 s
// and 2 MB per page.
import { classifyUrl, isPrivateHost, instagramCaption, extractWebPage } from './extract.js';

const ORIGINS = new Set(['https://slatiner.github.io', 'http://localhost:5173']);
const USER_AGENT = 'RecipeLibrary/1.0 (+https://github.com/slatiner/recipe-library)';
const TIMEOUT_MS = 10000;
const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 4;

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': ORIGINS.has(origin) ? origin : 'https://slatiner.github.io',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

class FetchError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

// The page's HTML, following redirects by hand so each hop is checked.
async function fetchPage(start: string, signal: AbortSignal): Promise<string> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(url);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || isPrivateHost(u.hostname)) {
      throw new FetchError(400, 'bad_url', "That link can't be opened.");
    }
    const r = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en' },
    });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      await r.body?.cancel();
      url = new URL(r.headers.get('location')!, url).href;
      continue;
    }
    if (r.status === 404 || r.status === 410) throw new FetchError(422, 'not_found', 'That page no longer exists.');
    if (r.status === 401 || r.status === 403 || r.status === 429) throw new FetchError(422, 'blocked', 'The site refused the request.');
    if (!r.ok) throw new FetchError(422, 'fetch_failed', `The site answered with an error (HTTP ${r.status}).`);
    const type = r.headers.get('content-type') ?? '';
    if (type && !/html|xml/i.test(type)) {
      await r.body?.cancel();
      throw new FetchError(422, 'not_a_page', "That link isn't a web page.");
    }
    // Read at most MAX_BYTES.
    const reader = r.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { await reader.cancel(); throw new FetchError(422, 'too_large', 'That page is too large to read.'); }
      chunks.push(value);
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.length; }
    return new TextDecoder().decode(all);
  }
  throw new FetchError(422, 'fetch_failed', 'That link redirects too many times.');
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('origin') ?? '');
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  const error = (status: number, code: string, message: string) => reply(status, { error: { code, message } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return error(405, 'method', 'POST only');

  // A member? Ask the database as the caller (is_member() reads auth.uid()).
  const auth = req.headers.get('authorization') ?? '';
  const apikey = req.headers.get('apikey') ?? '';
  const who = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { authorization: auth, apikey } });
  if (!who.ok) return error(401, 'not_signed_in', 'Sign in to import a link.');
  const member = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/is_member`, {
    method: 'POST',
    headers: { authorization: auth, apikey, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!member.ok) return error(502, 'member_check_failed', 'Could not check your account. Try again.');
  if ((await member.json()) !== true) return error(403, 'not_member', 'Redeem an invite code to import links.');

  let input: { url?: unknown };
  try { input = await req.json(); } catch { return error(400, 'bad_body', 'Body must be JSON'); }
  const link = classifyUrl(String(input.url ?? ''));
  if (!link) return error(400, 'bad_url', "That isn't a link to a recipe page or an Instagram post.");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const html = await fetchPage(link.fetchUrl, ctrl.signal);
    if (link.kind === 'instagram') {
      const c = instagramCaption(html);
      if (!c) return error(422, 'no_caption', "Couldn't read that post.");
      // The embed's image is a signed link that expires, so none is returned.
      return reply(200, { kind: 'instagram', url: link.url, text: c.text, title: null, author: c.author, imageUrl: null });
    }
    const page = extractWebPage(html);
    if (!page.text) return error(422, 'empty', "That page has no text to read.");
    return reply(200, { kind: 'web', url: link.url, text: page.text, title: page.title, author: page.author, imageUrl: page.imageUrl });
  } catch (e) {
    if (e instanceof FetchError) return error(e.status, e.code, e.message);
    if (e instanceof DOMException && e.name === 'AbortError') return error(422, 'timeout', 'The site took too long to answer.');
    return error(422, 'fetch_failed', "Couldn't reach that site.");
  } finally {
    clearTimeout(timer);
  }
});
