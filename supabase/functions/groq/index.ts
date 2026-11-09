// Groq proxy for the assistant. The Groq key lives in Supabase's secret
// store (GROQ_API_KEY) and never reaches the browser. Only signed-in users may
// call it; the function checks the caller's session with Supabase Auth itself
// (deployed with --no-verify-jwt, which also lets the CORS preflight through).
// Only members may use it: an account that hasn't redeemed an invite gets 403.
// Each member has 50 requests per UTC day; past that the reply is 429 with
// code 'daily_limit'.
// Only the fields the app uses are passed on, with the tokens capped (body.js).
// The server key is checked before a request is counted, so a broken deploy
// doesn't spend anyone's daily limit.
import { groqBody } from './body.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
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
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: { message: 'POST only' } });

  // Signed in? Ask Supabase Auth about the caller's token.
  const auth = req.headers.get('authorization') ?? '';
  const apikey = req.headers.get('apikey') ?? '';
  const who = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: { authorization: auth, apikey },
  });
  if (!who.ok) return reply(401, { error: { code: 'not_signed_in', message: 'Sign in to use the assistant.' } });

  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return reply(400, { error: { message: 'Body must be JSON' } });
  }
  const body = groqBody(input);
  if (!body) return reply(400, { error: { message: 'Model not allowed' } });

  const key = Deno.env.get('GROQ_API_KEY');
  if (!key) return reply(500, { error: { code: 'no_server_key', message: 'GROQ_API_KEY is not set' } });

  // Membership and the daily limit, checked by the database as the caller.
  const claim = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/claim_assistant_request`, {
    method: 'POST',
    headers: { authorization: auth, apikey, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!claim.ok) {
    const err = await claim.json().catch(() => ({}));
    if (err.message === 'daily_limit') return reply(429, { error: { code: 'daily_limit', message: err.details } });
    if (err.code === '42501') return reply(403, { error: { code: 'not_member', message: 'Redeem an invite code to use the assistant.' } });
    return reply(502, { error: { code: 'limit_check_failed', message: 'Could not check your daily limit. Try again.' } });
  }

  const groq = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // A rejected server key is our problem, not the caller's sign-in.
  return reply(groq.status === 401 ? 502 : groq.status, await groq.text());
});
