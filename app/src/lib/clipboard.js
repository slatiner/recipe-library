// Copies text to the clipboard. false when the browser refuses (permission,
// no clipboard API) or the text never comes, so the caller can show the text
// to copy by hand.
//
// text can be a promise (a share link still being made). Safari only allows a
// clipboard write during the tap itself, so where ClipboardItem exists the
// write starts at once with the text to follow.
export async function copyText(text) {
  const pending = Promise.resolve(text);
  try {
    if (typeof text !== 'string' && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
      const blob = pending.then((t) => new Blob([t], { type: 'text/plain' }));
      blob.catch(() => {}); // the write reports it
      await Promise.all([navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]), pending]);
    } else {
      await navigator.clipboard.writeText(await pending);
    }
    return true;
  } catch {
    return false;
  }
}
