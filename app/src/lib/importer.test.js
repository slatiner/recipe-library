import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { linkOnly, linksIn, importLink } from './importer.js';

const endpoint = { url: 'https://fn/import-url', headers: { Authorization: 'Bearer t' } };
const reply = (status, body) => new Response(JSON.stringify(body), { status });

let replies, requests;
beforeEach(() => {
  requests = [];
  globalThis.fetch = vi.fn(async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return replies.shift(); });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('linkOnly', () => {
  it('a lone http(s) link, trimmed', () => {
    expect(linkOnly('  https://www.instagram.com/reel/X/ \n')).toBe('https://www.instagram.com/reel/X/');
  });
  it('text with a link in it, or anything else, is not a link', () => {
    expect(linkOnly('Soup https://example.com')).toBeNull();
    expect(linkOnly('example.com/soup')).toBeNull();
    expect(linkOnly('')).toBeNull();
  });
});

describe('linksIn', () => {
  it('web links in a caption, without Instagram ones or trailing punctuation', () => {
    expect(linksIn('Full recipe: https://example.com/soup. Also https://instagram.com/x and (https://b.org/a)'))
      .toEqual(['https://example.com/soup', 'https://b.org/a']);
  });
});

describe('importLink', () => {
  it('posts the link and returns the page', async () => {
    const page = { kind: 'web', url: 'https://e.com/a', text: 'Soup', title: 'Soup', author: null, imageUrl: null };
    replies = [reply(200, page)];
    expect(await importLink(endpoint, 'https://e.com/a')).toEqual(page);
    expect(requests[0]).toEqual({ url: 'https://fn/import-url', body: { url: 'https://e.com/a' } });
  });

  it('an unreadable post ends in pasting the caption', async () => {
    replies = [reply(422, { error: { code: 'no_caption', message: 'The page had no caption.' } })];
    await expect(importLink(endpoint, 'https://www.instagram.com/p/X/')).rejects.toMatchObject({
      code: 'no_caption',
      message: "Couldn't read that post (the page had no caption). Paste the caption instead.",
    });
  });

  it('a blocked site ends in pasting the recipe, with the reason', async () => {
    replies = [reply(422, { error: { code: 'blocked', message: 'The site refused the request.' } })];
    await expect(importLink(endpoint, 'https://e.com/a')).rejects.toThrow(
      "Couldn't read that page (the site refused the request). Copy the recipe from the page and paste it instead.");
  });

  it('a server error shows the status', async () => {
    replies = [reply(500, {})];
    await expect(importLink(endpoint, 'https://e.com/a')).rejects.toThrow("Couldn't read that page (HTTP 500).");
  });

  it('signed out and non-members get their own messages', async () => {
    await expect(importLink(null, 'https://e.com')).rejects.toMatchObject({ code: 'NO_KEY' });
    replies = [reply(403, { error: { code: 'not_member' } })];
    await expect(importLink(endpoint, 'https://e.com')).rejects.toThrow('Redeem an invite code to import links.');
  });
});
