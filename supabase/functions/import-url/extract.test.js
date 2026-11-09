import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyUrl, isPrivateHost, instagramCaption, recipeFromJsonLd, extractWebPage, isoMinutes, decodeEntities, MAX_TEXT } from './extract.js';

// Tests run from the repo root (vite.config.js); jsdom's import.meta.url isn't a file path.
const fixture = (name) => readFileSync(resolve('supabase/functions/import-url/fixtures', name), 'utf8');

describe('classifyUrl', () => {
  it('an Instagram post or reel goes to its public embed page', () => {
    expect(classifyUrl('https://www.instagram.com/reel/DfK2yVrPyDK/?igsh=abc')).toEqual({
      kind: 'instagram',
      fetchUrl: 'https://www.instagram.com/reel/DfK2yVrPyDK/embed/captioned/',
      url: 'https://www.instagram.com/reel/DfK2yVrPyDK/',
    });
    expect(classifyUrl('https://instagram.com/p/AbC_1-x').fetchUrl).toBe('https://www.instagram.com/p/AbC_1-x/embed/captioned/');
    expect(classifyUrl('https://www.instagram.com/someone/reel/XYZ/').fetchUrl).toBe('https://www.instagram.com/reel/XYZ/embed/captioned/');
  });
  it('an Instagram profile is not a post', () => {
    expect(classifyUrl('https://www.instagram.com/someone/')).toBeNull();
  });
  it('other http(s) links are web pages; anything else is refused', () => {
    expect(classifyUrl(' https://example.com/soup ')).toMatchObject({ kind: 'web', fetchUrl: 'https://example.com/soup' });
    expect(classifyUrl('javascript:alert(1)')).toBeNull();
    expect(classifyUrl('ftp://example.com/x')).toBeNull();
    expect(classifyUrl('https://user:pw@example.com/')).toBeNull();
    expect(classifyUrl('not a link')).toBeNull();
  });
});

describe('isPrivateHost', () => {
  it('blocks this machine, private networks and metadata addresses', () => {
    for (const h of ['localhost', 'api.localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.9.9', '192.168.1.1',
      '169.254.169.254', '100.64.0.1', '0.0.0.0', '[::1]', 'fd00::1', '::ffff:127.0.0.1', 'printer.local', 'db.internal', 'intranet']) {
      expect(isPrivateHost(h), h).toBe(true);
    }
  });
  it('lets public hosts through', () => {
    for (const h of ['example.com', 'www.instagram.com', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) {
      expect(isPrivateHost(h), h).toBe(false);
    }
  });
});

describe('instagramCaption', () => {
  it('reads the handle and the caption, with line breaks and entities', () => {
    const c = instagramCaption(fixture('instagram-embed.html'));
    expect(c.author).toBe('@test.kitchen');
    expect(c.text).toContain("A quick weeknight soup you'll make again.\n\nRoasted Tomato Soup");
    expect(c.text).toContain('2 lb (900 g) ripe tomatoes, halved\n½ cup (120 ml) cream');
    expect(c.text).toContain('Salt & pepper');
    expect(c.text).toContain('#soup #fall');
    expect(c.text).not.toContain('test.kitchen');
    expect(c.text).not.toContain('View all');
  });
  it('a page without a caption (login wall, removed post) gives null', () => {
    expect(instagramCaption('<html><body><div id="root"></div></body></html>')).toBeNull();
  });
});

describe('recipe websites', () => {
  it('maps a schema.org Recipe inside @graph to text for the parser', () => {
    const r = recipeFromJsonLd(fixture('recipe-site.html'));
    expect(r.title).toBe('Lemon Drizzle Cake');
    expect(r.imageUrl).toBe('https://example.com/cake.jpg');
    expect(r.author).toBe('Jo Baker');
    expect(r.hasSteps).toBe(true);
    expect(r.text).toBe([
      'Lemon Drizzle Cake',
      'A light loaf cake.',
      'Serves: 8',
      'Prep time: 20 minutes',
      'Cook time: 65 minutes',
      '\nIngredients:\n- 1 cup sugar\n- 2 eggs\n- 1 & 1/2 cups flour',
      '\nMethod:\n1. Cake:\n2. Heat the oven to 350°F.\n3. Mix and bake.\n4. Drizzle:\n5. Pour the lemon syrup over.',
    ].join('\n'));
  });
  it('a page without a Recipe gives null from JSON-LD', () => {
    expect(recipeFromJsonLd(fixture('plain-page.html'))).toBeNull();
    expect(recipeFromJsonLd('<script type="application/ld+json">{broken</script>')).toBeNull();
  });
  it('steps given as one string are split into lines', () => {
    const html = '<script type="application/ld+json">{"@type":"Recipe","name":"X","recipeInstructions":"Boil.\\nServe."}</script>';
    expect(recipeFromJsonLd(html).text).toContain('Method:\n1. Boil.\n2. Serve.');
  });
  it('without JSON-LD: the visible text without scripts, styles or site chrome, and og:image', () => {
    const p = extractWebPage(fixture('plain-page.html'));
    expect(p.structured).toBe(false);
    expect(p.title).toBe("Grandma's Stew");
    expect(p.imageUrl).toBe('https://example.com/stew.jpg');
    expect(p.text).toBe("Grandma's Stew\n- 500 g beef\n- 2 carrots\n\nBrown the beef.\nAdd carrots & simmer.");
  });
  it('with JSON-LD: structured, and the Recipe image wins over og:image', () => {
    const p = extractWebPage(fixture('recipe-site.html'));
    expect(p).toMatchObject({ structured: true, title: 'Lemon Drizzle Cake', imageUrl: 'https://example.com/cake.jpg' });
  });
  it('only http(s) images are kept', () => {
    const html = '<script type="application/ld+json">{"@type":"Recipe","name":"X","image":"javascript:x"}</script>';
    expect(extractWebPage(html).imageUrl).toBeNull();
  });
  it('a very long page is cut to the paste limit', () => {
    expect(extractWebPage(`<p>${'word '.repeat(5000)}</p>`).text.length).toBe(MAX_TEXT);
  });
});

describe('helpers', () => {
  it('isoMinutes', () => {
    expect(isoMinutes('PT1H30M')).toBe(90);
    expect(isoMinutes('PT45M')).toBe(45);
    expect(isoMinutes('P1DT2H')).toBe(1560);
    expect(isoMinutes('PT')).toBeNull();
    expect(isoMinutes(30)).toBeNull();
  });
  it('decodeEntities', () => {
    expect(decodeEntities('&amp;&#064;&#x2019;&nbsp;&bogus;')).toBe('&@’ &bogus;');
  });
});
