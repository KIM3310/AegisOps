import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import tailwindConfig from '../tailwind.config.cjs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');

describe('local browser assets', () => {
  it('boots the app using only local executable and stylesheet resources', () => {
    const page = new DOMParser().parseFromString(html, 'text/html');
    const resources = Array.from(page.querySelectorAll('script[src], link[rel="stylesheet"], link[rel="preconnect"], link[rel="preload"]'))
      .map((element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '');

    expect(page.querySelector('#root')?.tagName).toBe('DIV');
    expect(page.documentElement.lang).toBe('ko');
    expect(resources).toContain('./index.tsx');
    expect(resources.filter((resource) => /^(https?:)?\/\//.test(resource))).toEqual([]);
    expect(page.querySelectorAll('script[type="importmap"]').length).toBe(0);
  });

  it('compiles the existing theme, responsive utilities, and accessibility styles locally', async () => {
    const source = readFileSync(`${process.cwd()}/index.css`, 'utf8');
    const compiled = await postcss([tailwindcss(tailwindConfig), autoprefixer()]).process(source, {
      from: `${process.cwd()}/index.css`,
    });
    const rules = (selector: string, property: string): string[] => {
      const values: string[] = [];
      compiled.root.walkRules(selector, (rule) => {
        rule.walkDecls(property, (declaration) => { values.push(declaration.value); });
      });
      return values;
    };

    expect(rules('.bg-bg', 'background-color')).toEqual(['rgb(9 9 11 / var(--tw-bg-opacity, 1))']);
    expect(rules('.text-text', 'color')).toEqual(['rgb(236 236 241 / var(--tw-text-opacity, 1))']);
    expect(rules('.text-2xs', 'font-size')).toEqual(['11px']);
    expect(rules('.max-w-4xl', 'max-width')).toEqual(['56rem']);
    expect(rules('.sm\\:flex-row', 'flex-direction')).toEqual(['row']);
    expect(rules('.adsense-publication-nav', 'background')).toEqual(['#f5f6f4']);
    expect(rules('::selection', 'background')).toEqual(['rgba(139, 92, 246, 0.35)']);
    expect(compiled.css).toContain('outline: 2px solid #8B5CF6');
    expect(compiled.css).toContain('(prefers-reduced-motion: reduce)');
    compiled.root.walkAtRules('import', (rule) => { expect.fail(`Unexpected CSS import: ${rule.params}`); });
    compiled.root.walkDecls((declaration) => { expect(declaration.value).not.toMatch(/url\([^)]*(?:https?:)?\/\//); });
  });
});
