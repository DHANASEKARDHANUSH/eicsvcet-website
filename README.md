# EIC Club Website

A fast, dependency-light, multi-page website for a college Entrepreneurship & Innovation Club. The browser receives plain HTML, CSS and a small vanilla JS file—there is no React runtime and no Vite client runtime.

## Stack

- Node.js 24 LTS recommended.
- Node's built-in HTTP server for routing and HTTP serving.
- PostgreSQL via `pg` for membership storage.
- Vanilla HTML/CSS/JS for the frontend.

## Run locally

```bash
npm install
npm start
```

Configure PostgreSQL first by copying `.env.example` to `.env` and setting `DATABASE_URL`.

Open `http://localhost:3000`.

For development with automatic server restarts:

```bash
npm run start:dev
```

Run the built-in checks:

```bash
npm run check
```

Export membership applications for the club team:

```bash
npm run export
```

Migrate the existing SQLite database to PostgreSQL:

```bash
npm run migrate
```

The migration reads `data/eic.db`, preserves application IDs and data, and leaves the SQLite database unchanged. Back it up before migrating and verify the PostgreSQL row count afterward.

## Before launch

1. Replace `https://eic.example.edu` in the canonical tags, `robots.txt`, and `sitemap.xml` with the real HTTPS domain.
2. Replace placeholder email, Instagram, campus location, and “Your College Name” text with official details.
3. Put the app behind an HTTPS reverse proxy such as Nginx, Caddy, a managed platform, or your institution's gateway. Set `NODE_ENV=production`, `SITE_URL`, and (when behind a proxy that forwards the real client IP) `TRUST_PROXY=1`.
4. Store PostgreSQL credentials in environment variables and use TLS for hosted PostgreSQL providers (`PGSSL=true`).
5. Do not commit `.env`, the SQLite database, or exported CSVs.
6. Restrict server access and admin/export access using your hosting environment. The sample export command is a local operator tool and is not exposed as a web endpoint.

## Security controls included

- Helmet security headers and a restrictive Content Security Policy.
- `X-Content-Type-Options`, frame-ancestor protection, referrer policy, and production HSTS.
- Disabled Express `X-Powered-By` disclosure.
- JSON and form-body size limits.
- API-wide and membership-specific rate limiting.
- Strict server-side validation and normalization.
- Parameterized SQL queries, no string-built SQL.
- Unique email constraint to reduce duplicate submissions.
- Honeypot field for simple bot filtering.
- No user-provided HTML is rendered back into pages.
- Custom 404 page and `noindex` metadata.
- Short server request timeout values.
- No third-party frontend scripts, fonts, analytics, or UI frameworks.

No website can honestly be called “attack-proof.” For a public launch, add infrastructure-level DDoS/WAF protection, HTTPS certificate management, secure backups, OS patching, dependency updates, log monitoring, and periodic security testing.

## Performance choices

- No React runtime, Vite runtime, hydration, or client-side router.
- One small JS file only; it handles navigation, active links, and membership submission.
- System fonts are used instead of external font downloads.
- Local SVG artwork avoids large image payloads and third-party image hosts.
- Responsive CSS covers mobile and desktop without a UI framework.
- Static assets are cacheable; HTML is revalidated so content changes are visible quickly.
- Reduced-motion support is included.

## Project layout

```text
public/
  index.html
  404.html
  about/index.html
  initiatives/index.html
  membership/index.html
  contact/index.html
  assets/
  styles.css
  app.js
server.js
data/
scripts/
```
