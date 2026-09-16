import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');

describe('local browser assets', () => {
  it('boots the app using only local executable and stylesheet resources', () => {
    const page = new DOMParser().parseFromString(html, 'text/html');
    const resources = Array.from(page.querySelectorAll('script[src], link[rel="stylesheet"], link[rel="preconnect"], link[rel="preload"]'))
      .map((element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '');

    expect(page.querySelector('#root')?.tagName).toBe('DIV');
    expect(resources).toContain('./index.tsx');
    expect(resources.filter((resource) => /^(https?:)?\/\//.test(resource))).toEqual([]);
    expect(page.querySelectorAll('script[type="importmap"]').length).toBe(0);
  });
});
