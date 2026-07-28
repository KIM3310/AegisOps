import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');
const SITE_ORIGIN = 'https://aegisops-ai-incident-doctor.pages.dev';
const POLICY_SURFACES = {
  about: '<h1>About AegisOps</h1>',
  privacy: '<h1>Privacy Policy</h1>',
  terms: '<h1>Terms of Service</h1>',
  contact: '<h1>Contact</h1>',
  compliance: '<h1>Compliance & Quality</h1>',
} as const;

function readPublic(filename: string): string {
  return readFileSync(path.join(PUBLIC, filename), 'utf8');
}

describe('public policy and search surface', () => {
  it('publishes unique policy content at canonical clean URLs', () => {
    for (const [route, heading] of Object.entries(POLICY_SURFACES)) {
      const html = readPublic(`${route}.html`);

      expect(html).toContain(heading);
      expect(html).toContain('name="description"');
      expect(html).toContain('name="robots" content="index,follow"');
      expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/${route}"`);
    }
  });

  it('keeps robots and sitemap aligned with every public policy route', () => {
    const robots = readPublic('robots.txt');
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
    expect(robots).not.toContain('Mediapartners-Google');

    const sitemap = readPublic('sitemap.xml');
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    const expected = [
      `${SITE_ORIGIN}/`,
      `${SITE_ORIGIN}/guide`,
      `${SITE_ORIGIN}/architecture`,
      `${SITE_ORIGIN}/verification`,
      `${SITE_ORIGIN}/publisher`,
      ...Object.keys(POLICY_SURFACES).map((route) => `${SITE_ORIGIN}/${route}`),
    ];

    expect(new Set(locations)).toEqual(new Set(expected));
    expect(locations).toHaveLength(expected.length);
  });

  it('checks response identity and never treats an SPA ads fallback as success', () => {
    const smoke = readFileSync(path.join(ROOT, 'scripts', 'smoke_production.sh'), 'utf8');

    expect(smoke).not.toContain('/ads.txt');
    expect(smoke).toContain('%{content_type}');
    expect(smoke).toContain('%{url_effective}');
    for (const [route, heading] of Object.entries(POLICY_SURFACES)) {
      expect(smoke).toContain(`"/${route}"`);
      expect(smoke).toContain(heading);
    }
    expect(smoke).toContain('/robots.txt');
    expect(smoke).toContain('/sitemap.xml');
  });
});
