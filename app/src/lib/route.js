// A small hash router: #/ is the library, #/recipe/<id> one recipe. Hash
// routes work on GitHub Pages without server rewrites, and the back button
// and bookmarks work.
import { reactive } from 'vue';

export function parseHash(hash) {
  const m = /^#\/recipe\/([^/?#]+)$/.exec(hash || '');
  return m ? { name: 'recipe', id: decodeURIComponent(m[1]) } : { name: 'library', id: null };
}

export const route = reactive(parseHash(window.location.hash));

window.addEventListener('hashchange', () => Object.assign(route, parseHash(window.location.hash)));

export function go(hash) {
  window.location.hash = hash;
  Object.assign(route, parseHash(hash));
}
