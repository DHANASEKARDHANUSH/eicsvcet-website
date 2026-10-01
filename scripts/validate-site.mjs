import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pages = ['public/index.html','public/about/index.html','public/initiatives/index.html','public/initiatives/achievements/index.html','public/membership/index.html','public/contact/index.html','public/privacy/index.html','public/404.html'];
const sitemap = fs.readFileSync(path.join(root, 'public/sitemap.xml'), 'utf8');
const sitemapUrls = [...sitemap.matchAll(/<loc>(https:\/\/[^<]+)<\/loc>/g)].map((match) => new URL(match[1]));
if (sitemapUrls.length === 0) throw new Error('sitemap.xml: no HTTPS URLs found');
const sitemapOrigin = sitemapUrls[0].origin;
if (sitemapUrls.some((url) => url.origin !== sitemapOrigin)) throw new Error('sitemap.xml: URLs must use one canonical host');
for (const rel of pages) {
  const html = fs.readFileSync(path.join(root, rel), 'utf8');
  if (!/<meta charset="utf-8"\s*\/?>/i.test(html)) throw new Error(`${rel}: missing charset`);
  if (!/<meta\b(?=[^>]*\bname="viewport")[^>]*>/i.test(html)) throw new Error(`${rel}: missing viewport`);
  if (!/<title>[^<]+<\/title>/i.test(html)) throw new Error(`${rel}: missing title`);
  if (!/<meta\b(?=[^>]*\bname="description")(?=[^>]*\bcontent="[^"]+")[^>]*>/i.test(html)) throw new Error(`${rel}: missing description`);
  const canonical = html.match(/<link\b(?=[^>]*\brel="canonical")(?=[^>]*\bhref="([^"]+)")[^>]*>/i)?.[1];
  if (rel === 'public/404.html') {
    if (canonical) throw new Error(`${rel}: noindex page should not declare a canonical`);
  } else {
    if (!canonical) throw new Error(`${rel}: missing canonical`);
    const canonicalUrl = new URL(canonical);
    const expectedPath = rel.replace(/^public/, '').replace(/index\.html$/, '');
    if (canonicalUrl.protocol !== 'https:' || canonicalUrl.origin !== sitemapOrigin || canonicalUrl.pathname !== expectedPath) {
      throw new Error(`${rel}: canonical must match sitemap host and page path`);
    }
  }
  if ((html.match(/<h1\b/gi) || []).length !== 1) throw new Error(`${rel}: expected exactly one h1`);
  if (/\sstyle="/i.test(html)) throw new Error(`${rel}: inline style violates CSP`);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) if (!/\balt="[^"]*"/i.test(m[0])) throw new Error(`${rel}: image without alt text`);
}
console.log(`Validated ${pages.length} HTML pages: metadata, sitemap-aligned canonicals, single H1, image alt text, and no inline styles.`);
