import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pages = ['public/index.html','public/about/index.html','public/initiatives/index.html','public/membership/index.html','public/contact/index.html','public/privacy/index.html','public/404.html'];
for (const rel of pages) {
  const html = fs.readFileSync(path.join(root, rel), 'utf8');
  if (!/<meta charset="utf-8">/i.test(html)) throw new Error(`${rel}: missing charset`);
  if (!/<meta name="viewport"/i.test(html)) throw new Error(`${rel}: missing viewport`);
  if (!/<title>[^<]+<\/title>/i.test(html)) throw new Error(`${rel}: missing title`);
  if (!/<meta name="description" content="[^"]+">/i.test(html)) throw new Error(`${rel}: missing description`);
  if (!/<link rel="canonical" href="https:\/\//i.test(html)) throw new Error(`${rel}: canonical must be absolute HTTPS`);
  if ((html.match(/<h1\b/gi) || []).length !== 1) throw new Error(`${rel}: expected exactly one h1`);
  if (/\sstyle="/i.test(html)) throw new Error(`${rel}: inline style violates CSP`);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) if (!/\balt="[^"]*"/i.test(m[0])) throw new Error(`${rel}: image without alt text`);
}
console.log(`Validated ${pages.length} HTML pages: metadata, canonical, single H1, image alt text, and no inline styles.`);
