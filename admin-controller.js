import crypto from 'node:crypto';
import {
  authenticateAdmin,
  getAdminSession,
  destroyAdminSession,
  isValidCsrf,
  setAdminCookie,
  clearAdminCookie,
  sameOrigin,
  adminLoginRateLimit
} from './admin-auth.js';
import {
  listPublicContent,
  listAdminContent,
  getContentImage,
  createContent,
  updateContent,
  deleteContent,
  listMembershipRows,
  getContentImageForAdmin
} from './admin-db.js';

const NODE_ENV = process.env.NODE_ENV || 'development';
const PRODUCTION = NODE_ENV === 'production';
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 900 * 1024;

const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store'
};

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    ...HEADERS,
    'Content-Type': type,
    'Content-Length': payload.length,
    ...extra
  });
  res.end(payload);
}

function json(res, status, data, extra = {}) {
  return send(res, status, JSON.stringify(data), 'application/json; charset=utf-8', extra);
}

async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { code: 'PAYLOAD_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

function parseBoolean(value, fallback = true) {
  return typeof value === 'boolean' ? value : fallback;
}

function parseId(value) {
  const raw = String(value || '');
  if (!/^\d+$/.test(raw)) return null;
  const id = BigInt(raw);
  return id > 0n ? id.toString() : null;
}

function clientIp(req) {
  return String(req.socket.remoteAddress || 'unknown').slice(0, 128);
}

function requireAdmin(req, res, { csrf = false } = {}) {
  const session = getAdminSession(req);
  if (!session) {
    json(res, 401, { message: 'Authentication required.' });
    return null;
  }

  if (csrf && (!sameOrigin(req) || !isValidCsrf(req, session))) {
    json(res, 403, { message: 'Request validation failed.' });
    return null;
  }

  return session;
}

function parseImage(image) {
  if (image == null || image === '') return null;
  if (!image || typeof image !== 'object') throw new Error('Invalid image.');

  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const mime = cleanText(image.mime, 32).toLowerCase();
  if (!allowed.has(mime)) throw new Error('Only JPEG, PNG, or WebP images are allowed.');

  const rawData = typeof image.data === 'string' ? image.data : '';
  const prefix = `data:${mime};base64,`;
  if (!rawData.startsWith(prefix)) throw new Error('Invalid image encoding.');

  let buffer;
  try { buffer = Buffer.from(rawData.slice(prefix.length), 'base64'); } catch { throw new Error('Invalid image data.'); }
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('Image must be 900 KB or smaller after compression.');
  if (!validMagic(buffer, mime)) throw new Error('Image content does not match its declared type.');

  const alt = cleanText(image.alt, 220);
  if (alt.length < 4) throw new Error('Please provide useful image alt text.');

  return { data: buffer, mime, alt };
}

function validMagic(buffer, mime) {
  if (mime === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function parseContent(body) {
  const kind = cleanText(body.kind, 20).toLowerCase();
  if (!['event', 'program', 'achievement'].includes(kind)) throw new Error('Choose Event, Program, or Achievement.');

  const title = cleanText(body.title, 120);
  const description = cleanText(body.description, 3000);
  const location = cleanText(body.location, 180);
  const published = parseBoolean(body.published, true);
  let eventDate = null;

  if (body.eventDate) {
    const date = new Date(String(body.eventDate));
    if (Number.isNaN(date.getTime())) throw new Error('Invalid date.');
    eventDate = date.toISOString();
  }

  if (title.length < 2) throw new Error('Title is required.');
  if (description.length < 10) throw new Error('Description is too short.');

  const image = parseImage(body.image);

  return {
    kind,
    title,
    description,
    location: location || null,
    eventDate,
    published,
    imageData: image?.data || null,
    imageMime: image?.mime || null,
    imageAlt: image?.alt || null
  };
}

function csvEscape(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function membershipCsv(rows) {
  const headers = ['reference', 'name', 'email', 'phone', 'register_number', 'department', 'year', 'interests', 'motivation', 'created_at'];
  const lines = [headers.map(csvEscape).join(',')];

  for (const row of rows) {
    let interests = row.interests;
    if (typeof interests === 'string') {
      try { interests = JSON.parse(interests); } catch { /* keep as string */ }
    }
    if (Array.isArray(interests)) interests = interests.join('; ');

    lines.push([
      row.reference,
      row.name,
      row.email,
      row.phone,
      row.register_number,
      row.department,
      row.year,
      interests,
      row.motivation,
      row.created_at
    ].map(csvEscape).join(','));
  }

  return `${lines.join('\r\n')}\r\n`;
}

export function createAdminController() {
  return {
    async init() {
      await import('./admin-db.js').then(module => module.initAdminDatabase());
    },

    async handle(req, res, requestUrl) {
      const pathname = requestUrl.pathname;

      if (req.method === 'GET' && pathname === '/api/public/content') {
        const kind = requestUrl.searchParams.get('kind');
        if (!['event', 'program', 'achievement'].includes(kind)) return json(res, 400, { message: 'Invalid content type.' });
        try {
          const items = await listPublicContent(kind);
          return json(res, 200, { items }, { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' });
        } catch (error) {
          console.error('Public content read failed:', error);
          return json(res, 500, { message: 'Could not load content.' });
        }
      }

      const adminImageMatch = pathname.match(/^\/api\/admin\/content\/(\d+)\/image$/);
      if (req.method === 'GET' && adminImageMatch) {
        if (!requireAdmin(req, res)) return;
        try {
          const image = await getContentImageForAdmin(adminImageMatch[1]);
          if (!image?.image_data || !image.image_mime) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
          const tag = crypto.createHash('sha256').update(image.image_data).digest('hex');
          if (req.headers['if-none-match'] === `"${tag}"`) {
            res.writeHead(304, { ...HEADERS, 'Cache-Control': 'private, max-age=300', ETag: `"${tag}"` });
            return res.end();
          }
          return send(res, 200, image.image_data, image.image_mime, {
            'Cache-Control': 'private, max-age=300',
            'ETag': `"${tag}"`,
            'Content-Disposition': 'inline'
          });
        } catch (error) {
          console.error('Admin image read failed:', error);
          return json(res, 500, { message: 'Could not load image.' });
        }
      }

      const imageMatch = pathname.match(/^\/api\/public\/content\/(\d+)\/image$/);
      if (req.method === 'GET' && imageMatch) {
        try {
          const image = await getContentImage(imageMatch[1]);
          if (!image?.image_data || !image.image_mime) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
          const tag = crypto.createHash('sha256').update(image.image_data).digest('hex');
          if (req.headers['if-none-match'] === `"${tag}"`) {
            res.writeHead(304, { ...HEADERS, 'Cache-Control': 'public, max-age=86400', ETag: `"${tag}"` });
            return res.end();
          }
          return send(res, 200, image.image_data, image.image_mime, {
            'Cache-Control': 'public, max-age=86400',
            'ETag': `"${tag}"`,
            'Content-Disposition': 'inline'
          });
        } catch (error) {
          console.error('Public image read failed:', error);
          return json(res, 500, { message: 'Could not load image.' });
        }
      }

      if (pathname === '/api/admin/login' && req.method === 'POST') {
        if (!sameOrigin(req)) return json(res, 403, { message: 'Request validation failed.' });

        const rl = adminLoginRateLimit(clientIp(req));
        if (!rl.allowed) {
          return json(res, 429, { message: 'Too many login attempts. Try again later.' }, { 'Retry-After': String(rl.retryAfter) });
        }

        try {
          const body = JSON.parse(await readBody(req));
          const username = cleanText(body.username, 100);
          const password = typeof body.password === 'string' ? body.password : '';
          const session = authenticateAdmin(username, password);

          if (!session) return json(res, 401, { message: 'Invalid username or password.' });

          return json(res, 200, { ok: true, csrfToken: session.csrfToken }, {
            'Set-Cookie': setAdminCookie(session.token, PRODUCTION),
            'Cache-Control': 'no-store'
          });
        } catch (error) {
          return json(res, error?.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { message: 'Invalid login request.' });
        }
      }

      if (pathname === '/api/admin/session' && req.method === 'GET') {
        const session = getAdminSession(req);
        return json(res, 200, {
          authenticated: Boolean(session),
          csrfToken: session?.csrfToken || ''
        });
      }

      if (pathname === '/api/admin/logout' && req.method === 'POST') {
        const session = requireAdmin(req, res, { csrf: true });
        if (!session) return;
        destroyAdminSession(req);
        return json(res, 200, { ok: true }, { 'Set-Cookie': clearAdminCookie(PRODUCTION) });
      }

      if (pathname === '/api/admin/content' && req.method === 'GET') {
        if (!requireAdmin(req, res)) return;
        const kind = requestUrl.searchParams.get('kind') || '';
        try {
          const items = await listAdminContent(kind);
          return json(res, 200, { items });
        } catch (error) {
          return json(res, 400, { message: error.message || 'Could not load content.' });
        }
      }

      if (pathname === '/api/admin/content' && req.method === 'POST') {
        if (!requireAdmin(req, res, { csrf: true })) return;
        try {
          const body = JSON.parse(await readBody(req));
          const item = parseContent(body);
          const created = await createContent(item);
          return json(res, 201, { item: created });
        } catch (error) {
          console.error('Content create failed:', error);
          return json(res, error?.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { message: error.message || 'Could not create content.' });
        }
      }

      const contentIdMatch = pathname.match(/^\/api\/admin\/content\/(\d+)$/);
      if (contentIdMatch && req.method === 'PUT') {
        if (!requireAdmin(req, res, { csrf: true })) return;
        const id = parseId(contentIdMatch[1]);
        if (!id) return json(res, 400, { message: 'Invalid content ID.' });
        try {
          const body = JSON.parse(await readBody(req));
          const item = parseContent(body);
          const updated = await updateContent(id, item);
          if (!updated) return json(res, 404, { message: 'Content not found.' });
          return json(res, 200, { item: updated });
        } catch (error) {
          console.error('Content update failed:', error);
          return json(res, error?.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { message: error.message || 'Could not update content.' });
        }
      }

      if (contentIdMatch && req.method === 'DELETE') {
        if (!requireAdmin(req, res, { csrf: true })) return;
        const id = parseId(contentIdMatch[1]);
        if (!id) return json(res, 400, { message: 'Invalid content ID.' });
        try {
          const deleted = await deleteContent(id);
          if (!deleted) return json(res, 404, { message: 'Content not found.' });
          return json(res, 200, { ok: true });
        } catch (error) {
          console.error('Content delete failed:', error);
          return json(res, 500, { message: 'Could not delete content.' });
        }
      }

      if (pathname === '/api/admin/export-members' && req.method === 'GET') {
        if (!requireAdmin(req, res)) return;
        try {
          const rows = await listMembershipRows();
          const csv = membershipCsv(rows);
          const filename = `members-${new Date().toISOString().slice(0, 10)}.csv`;
          return send(res, 200, csv, 'text/csv; charset=utf-8', {
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store'
          });
        } catch (error) {
          console.error('Membership export failed:', error);
          return json(res, 500, { message: 'Could not export membership data.' });
        }
      }

      return json(res, 404, { message: 'Not found.' });
    }
  };
}
