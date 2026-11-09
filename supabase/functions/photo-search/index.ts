// Searches Pexels for photos of a dish, for the "Find a photo" picker on a card
// without one. The Pexels key lives in Supabase's secret store
// (PEXELS_API_KEY) and never reaches the browser. Members only; Pexels allows
// 200 searches an hour and 20,000 a month for the whole app, so this doesn't
// count against the assistant's daily limit. Deployed with --no-verify-jwt;
// the function checks the caller itself.
// Pexels' terms: show a link to Pexels and credit the photographer (the app
// does both wherever a picked photo is shown).
import { searchUrl, toPhotos } from './photos.js';

const ORIGINS = new Set(['https://slatiner.github.io', 'http://localhost:5173']);

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': ORIGINS.has(origin) ? origin : 'https://slatiner.github.io',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
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
  if (!who.ok) return error(401, 'not_signed_in', 'Sign in to find a photo.');
  const member = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/is_member`, {
    method: 'POST',
    headers: { authorization: auth, apikey, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!member.ok) return error(502, 'member_check_failed', 'Could not check your account. Try again.');
  if ((await member.json()) !== true) return error(403, 'not_member', 'Redeem an invite code to find photos.');

  let input: { query?: unknown };
  try { input = await req.json(); } catch { return error(400, 'bad_body', 'Body must be JSON'); }
  const url = searchUrl(String(input.query ?? ''));
  if (!url) return error(400, 'no_query', 'Type what to search for.');

  const key = Deno.env.get('PEXELS_API_KEY');
  if (!key) return error(500, 'no_server_key', 'PEXELS_API_KEY is not set');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { headers: { Authorization: key }, signal: ctrl.signal });
    if (r.status === 401 || r.status === 403) return error(502, 'bad_server_key', "The photo search key was rejected. Check PEXELS_API_KEY in Supabase.");
    if (r.status === 429) return error(429, 'busy', 'Too many photo searches this hour. Try again later.');
    if (!r.ok) return error(502, 'search_failed', `The photo search failed (HTTP ${r.status}).`);
    return reply(200, { photos: toPhotos(await r.json()) });
  } catch {
    return error(504, 'timeout', 'The photo search took too long. Try again.');
  } finally {
    clearTimeout(timer);
  }
});
