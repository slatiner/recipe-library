// A recipe whose source is a YouTube video or an Instagram post can show it
// through the platform's own player. Nothing loads from the platform until the
// viewer asks (see SourceEmbed.vue), except the YouTube thumbnail.

// The video id of a YouTube link (watch, youtu.be, shorts, embed, live), else null.
export function youtubeId(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.pathname === '/watch' ? u.searchParams.get('v') : (u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/) || [])[1];
  }
  return /^[\w-]{11}$/.test(id || '') ? id : null;
}

// A still that every public video has; not signed, so it doesn't expire.
export const youtubeThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

// The post or reel code of an Instagram link, else null.
function instagramPost(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'instagram.com' && host !== 'instagr.am') return null;
  const m = u.pathname.match(/^\/(?:[\w.]+\/)?(p|reels?|tv)\/([\w-]+)/);
  return m ? { kind: m[1] === 'p' ? 'p' : 'reel', code: m[2] } : null;
}

// What a source link can show: { kind: 'youtube', src, poster },
// { kind: 'instagram', src }, or null.
export function embedOf(url) {
  const id = youtubeId(url);
  if (id) return { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`, poster: youtubeThumb(id) };
  const ig = instagramPost(url);
  if (ig) return { kind: 'instagram', src: `https://www.instagram.com/${ig.kind}/${ig.code}/embed/` };
  return null;
}
