import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyText } from './clipboard.js';

function stub({ withItem }) {
  const clipboard = { writeText: vi.fn(async () => {}), write: vi.fn(async () => {}) };
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  if (withItem) globalThis.ClipboardItem = class { constructor(items) { this.items = items; } };
  return clipboard;
}

afterEach(() => { delete globalThis.ClipboardItem; });

describe('copyText', () => {
  it('copies plain text', async () => {
    const c = stub({ withItem: false });
    expect(await copyText('hi')).toBe(true);
    expect(c.writeText).toHaveBeenCalledWith('hi');
  });

  it('text still to come is written at once as a ClipboardItem, so Safari keeps the tap', async () => {
    const c = stub({ withItem: true });
    let resolve;
    const later = new Promise((r) => { resolve = r; });
    const done = copyText(later);
    expect(c.write).toHaveBeenCalledTimes(1);
    resolve('https://x/#/r/t1');
    expect(await done).toBe(true);
    const blob = await c.write.mock.calls[0][0][0].items['text/plain'];
    expect(await blob.text()).toBe('https://x/#/r/t1');
    expect(c.writeText).not.toHaveBeenCalled();
  });

  it('text still to come, without ClipboardItem, waits and writes it', async () => {
    const c = stub({ withItem: false });
    expect(await copyText(Promise.resolve('later'))).toBe(true);
    expect(c.writeText).toHaveBeenCalledWith('later');
  });

  it('false when the text never comes or the browser refuses', async () => {
    stub({ withItem: true });
    expect(await copyText(Promise.reject(new Error('offline')))).toBe(false);
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    expect(await copyText('hi')).toBe(false);
  });
});
