// A small hash router: #/ is the library, #/recipe/<id> one recipe, #/r/<token>
// a recipe shared by link (readable without signing in). Hash
// routes work on GitHub Pages without server rewrites, and the back button
// and bookmarks work.
import { reactive } from 'vue';

export function parseHash(hash) {
  const m = /^#\/(recipe|r)\/([^/?#]+)$/.exec(hash || '');
  if (!m) return { name: 'library', id: null };
  return { name: m[1] === 'r' ? 'shared' : 'recipe', id: decodeURIComponent(m[2]) };
}

export const route = reactive(parseHash(window.location.hash));

window.addEventListener('hashchange', () => Object.assign(route, parseHash(window.location.hash)));

export function go(hash) {
  window.location.hash = hash;
  Object.assign(route, parseHash(hash));
}
