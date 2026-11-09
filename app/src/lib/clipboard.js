// Copies text to the clipboard. false when the browser refuses (permission,
// no clipboard API), so the caller can show the text to copy by hand.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
