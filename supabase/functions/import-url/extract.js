// What import-url reads from a page. Plain JavaScript so the Deno function and
// the Vitest tests load the same file. Nothing here fetches or calls the LLM:
// each function takes a page's HTML and returns text for the parser.

// Longest text handed to the parser (the same cap as a paste, app/src/lib/recipes.js).
export const MAX_TEXT = 12000;

// A link the function will fetch: { kind: 'instagram', fetchUrl } for a post or
// reel (its public embed page), { kind: 'web', fetchUrl } for anything else on
// http(s), or null.
export function classifyUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'instagram.com' || host === 'instagr.am') {
    const m = u.pathname.match(/^\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/);
    if (!m) return null;
    const kind = m[1] === 'p' ? 'p' : 'reel';
    return { kind: 'instagram', fetchUrl: `https://www.instagram.com/${kind}/${m[2]}/embed/captioned/`, url: `https://www.instagram.com/${kind}/${m[2]}/` };
  }
  return { kind: 'web', fetchUrl: u.href, url: u.href };
}

// Hosts the function must not reach: this machine, the private network and
// cloud metadata. Checked on every redirect hop. (A public name that resolves
// to a private address isn't caught; Supabase's edge network can't reach a
// private one anyway.)
export function isPrivateHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h.includes(':')) return h === '::1' || h === '::' || /^(fc|fd|fe8|fe9|fea|feb)/.test(h) || h.startsWith('::ffff:');
  const ip = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ip) return !h.includes('.');
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decodeEntities(s) {
  return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+\d*);/gi, (all, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

// HTML to plain text: block ends and <br> become line breaks.
function htmlToText(html) {
  const t = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(t).split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const cap = (s) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s);
const http = (v) => (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : null);

// ---- Instagram ----

// The caption on a public embed page (…/embed/captioned/): the handle and the
// text, or null when the page has none (blocked, removed, login wall).
export function instagramCaption(html) {
  const start = html.indexOf('<div class="Caption">');
  if (start < 0) return null;
  let body = html.slice(start + '<div class="Caption">'.length);
  const end = body.search(/<div class="CaptionComments"|<\/div>/);
  if (end >= 0) body = body.slice(0, end);
  const user = body.match(/<a class="CaptionUsername"[^>]*>([^<]*)<\/a>/);
  const text = htmlToText(body.replace(/<a class="CaptionUsername"[^>]*>[^<]*<\/a>/, ''));
  if (!text) return null;
  return { author: user ? `@${decodeEntities(user[1]).trim()}` : null, text: cap(text) };
}

// ---- Recipe websites ----

// Every JSON-LD object on the page, flattened out of arrays and @graph.
function jsonLdNodes(html) {
  const out = [];
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') {
      out.push(n);
      if (n['@graph']) walk(n['@graph']);
    }
  };
  for (const m of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* a broken block; try the next */ }
  }
  return out;
}

const isRecipe = (n) => [].concat(n['@type'] || []).some((t) => String(t).toLowerCase() === 'recipe');
// JSON-LD strings sometimes hold escaped HTML ("&lt;b&gt;"): unescape, then strip.
const str = (v) => (typeof v === 'string' ? htmlToText(decodeEntities(v)) : typeof v === 'number' ? String(v) : '');

// PT1H30M -> 90; anything else -> null.
export function isoMinutes(v) {
  const m = typeof v === 'string' && v.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  return Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

function imageOf(v) {
  if (!v) return null;
  if (typeof v === 'string') return http(v);
  if (Array.isArray(v)) return v.map(imageOf).find(Boolean) || null;
  return http(v.url) || http(v.contentUrl);
}

function authorOf(v) {
  const a = [].concat(v || [])[0];
  return typeof a === 'string' ? a.trim() || null : (a && str(a.name)) || null;
}

// Steps: strings, HowToStep, or HowToSection with its own list.
function stepLines(v, out = []) {
  if (!v) return out;
  if (typeof v === 'string') {
    htmlToText(decodeEntities(v)).split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => out.push(l));
  } else if (Array.isArray(v)) {
    v.forEach((x) => stepLines(x, out));
  } else if (typeof v === 'object') {
    const types = [].concat(v['@type'] || []).map(String);
    if (types.includes('HowToSection')) {
      if (v.name) out.push(`${str(v.name)}:`);
      stepLines(v.itemListElement, out);
    } else {
      const t = str(v.text) || str(v.name);
      if (t) out.push(t);
    }
  }
  return out;
}

// A schema.org Recipe as plain text for the parser, plus the parts that don't
// need the LLM. null when the page has no Recipe.
export function recipeFromJsonLd(html) {
  const r = jsonLdNodes(html).find(isRecipe);
  if (!r) return null;
  const title = str(r.name);
  const yieldText = [].concat(r.recipeYield || []).map(str).filter(Boolean)[0] || '';
  const prep = isoMinutes(r.prepTime);
  const cook = isoMinutes(r.cookTime);
  const total = isoMinutes(r.totalTime);
  const ingredients = [].concat(r.recipeIngredient || r.ingredients || []).map(str).filter(Boolean);
  const steps = stepLines(r.recipeInstructions);
  const lines = [
    title,
    str(r.description),
    yieldText && `Serves: ${yieldText}`,
    prep !== null && `Prep time: ${prep} minutes`,
    cook !== null && `Cook time: ${cook} minutes`,
    prep === null && cook === null && total !== null && `Total time: ${total} minutes`,
    ingredients.length && `\nIngredients:\n${ingredients.map((i) => `- ${i}`).join('\n')}`,
    steps.length && `\nMethod:\n${steps.map((s, n) => `${n + 1}. ${s}`).join('\n')}`,
  ].filter(Boolean);
  return { title, text: cap(lines.join('\n')), imageUrl: imageOf(r.image), author: authorOf(r.author), hasSteps: steps.length > 0 };
}

function metaContent(html, prop) {
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0];
    const p = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i);
    const c = tag.match(/content\s*=\s*["']([^"']*)["']/i);
    if (p && c && p[1].toLowerCase() === prop) return decodeEntities(c[1]).trim();
  }
  return null;
}

// The page's visible text, without scripts, styles and site chrome.
export function pageText(html) {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<head\b[\s\S]*?<\/head>/i, '');
  return cap(htmlToText(body));
}

// A web page: JSON-LD when it has a Recipe, else its text. Either way the
// page's photo (JSON-LD image, else og:image).
export function extractWebPage(html) {
  const ld = recipeFromJsonLd(html);
  const og = http(metaContent(html, 'og:image'));
  if (ld) return { text: ld.text, title: ld.title || null, author: ld.author, imageUrl: ld.imageUrl || og, structured: true };
  const title = metaContent(html, 'og:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const text = pageText(html);
  return { text, title: decodeEntities(title).trim() || null, author: metaContent(html, 'og:site_name'), imageUrl: og, structured: false };
}
