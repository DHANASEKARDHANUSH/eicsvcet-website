import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { closeDatabase, initDatabase, insertApplication } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const SITE_URL = (process.env.SITE_URL || 'https://eic.example.edu').replace(/\/$/, '');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8']
]);

const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-DNS-Prefetch-Control': 'off',
  'X-Download-Options': 'noopen',
  'Cache-Control': 'no-store'
};

const rateBuckets = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 120;
const MEMBERSHIP_WINDOW_MS = 60 * 60 * 1000;
const MEMBERSHIP_LIMIT = 20;

function getClientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded.slice(0, 64);
  }
  return String(req.socket.remoteAddress || 'unknown').slice(0, 64);
}
function rateLimit(ip, windowMs, limit, bucketName) {
  const key = `${bucketName}:${ip}`;
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start >= windowMs) bucket = { start: now, count: 0 };
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return { allowed: bucket.count <= limit, retryAfter: Math.max(1, Math.ceil((bucket.start + windowMs - now) / 1000)) };
}
setInterval(() => {
  const cutoff = Date.now() - Math.max(RATE_WINDOW_MS, MEMBERSHIP_WINDOW_MS);
  for (const [key, bucket] of rateBuckets) if (bucket.start < cutoff) rateBuckets.delete(key);
}, 10 * 60 * 1000).unref();

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value); }
function validPhone(value) { return /^[+]?\d[\d\s().-]{7,14}\d$/.test(value); }
function normalizeEmail(value) { return value.toLowerCase(); }
function makeReference() { return `EIC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }
function send(res, status, body, contentType = 'application/json; charset=utf-8', extra = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, { ...HEADERS, 'Content-Type': contentType, 'Content-Length': payload.length, ...extra });
  res.end(payload);
}
function json(res, status, data, extra = {}) { send(res, status, JSON.stringify(data), 'application/json; charset=utf-8', extra); }
async function readBody(req, maxBytes = 12 * 1024) {
  return await new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { reject(Object.assign(new Error('Payload too large'), { code: 'PAYLOAD_TOO_LARGE' })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function safeFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const normalized = path.posix.normalize('/' + decoded.replace(/^\/+/, ''));
  const candidate = path.resolve(publicDir, '.' + normalized);
  const root = path.resolve(publicDir);
  if (!(candidate === root || candidate.startsWith(root + path.sep))) return null;
  return candidate;
}
function htmlRoute(file) { return fs.readFileSync(path.join(publicDir, file)); }

async function handleMembership(req, res) {
  const ip = getClientIp(req);
  const rl = rateLimit(ip, MEMBERSHIP_WINDOW_MS, MEMBERSHIP_LIMIT, 'membership');
  if (!rl.allowed) return json(res, 429, { message: 'Too many membership submissions from this network. Please try again later.' }, { 'Retry-After': String(rl.retryAfter) });

  const origin = String(req.headers.origin || '');
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const host = req.headers.host || '';
      if (originUrl.host !== host) return json(res, 403, { message: 'Cross-origin submission blocked.' });
    } catch { return json(res, 403, { message: 'Invalid origin.' }); }
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (error) {
    return json(res, error?.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { message: 'Invalid request body.' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { message: 'Invalid request body.' });
  if (cleanText(body.website, 20)) return json(res, 400, { message: 'Invalid submission.' });

  const name = cleanText(body.name, 80);
  const email = normalizeEmail(cleanText(body.email, 160));
  const phone = cleanText(body.phone, 16);
  const registerNumber = cleanText(body.registerNumber, 30);
  const department = cleanText(body.department, 80);
  const year = cleanText(body.year, 30);
  const motivation = cleanText(body.motivation, 1200);
  const allowedYears = new Set(['1st year', '2nd year', '3rd year', '4th year', 'Other']);
  const allowedDepartments = new Set(['AIDS', 'CSE', 'AIML', 'CS', 'IT', 'ECE', 'EE', 'MECH', 'CIVIL', 'MBA', 'MCA']);
  const allowedInterests = new Set(['Startups', 'Product', 'Technology', 'Research', 'Design', 'Communication']);
  const interests = Array.isArray(body.interests) ? [...new Set(body.interests.map((x) => cleanText(x, 40)))] : [];

  const valid = name.length >= 2 && validEmail(email) && validPhone(phone) && registerNumber.length >= 2 && allowedDepartments.has(department) && allowedYears.has(year) && interests.length >= 1 && interests.length <= 4 && interests.every((x) => allowedInterests.has(x)) && motivation.length >= 0;
  if (!valid) return json(res, 400, { message: 'Please complete the required fields with valid information.' });

  const reference = makeReference();
  try {
    await insertApplication([
      reference, name, email, phone, registerNumber, department,
      year, JSON.stringify(interests), motivation, new Date()
    ]);
    return json(res, 201, { ok: true, reference });
  } catch (error) {
    if (error?.code === '23505') return json(res, 409, { message: 'An application with this email already exists.' });
    console.error('Membership insert failed:', error);
    return json(res, 500, { message: 'We could not save your application. Please try again.' });
  }
}

function serveStatic(req, res, urlPath) {
  let file;
  try { file = safeFilePath(urlPath); } catch { return send(res, 400, Buffer.from('Bad request'), 'text/plain; charset=utf-8'); }
  if (!file) return send(res, 400, Buffer.from('Bad request'), 'text/plain; charset=utf-8');
  try {
    let stat = fs.statSync(file);
    if (stat.isDirectory()) {
      file = path.join(file, 'index.html');
      stat = fs.statSync(file);
    }
    const ext = path.extname(file).toLowerCase();
    const type = MIME.get(ext);
    if (!type) return send(res, 404, Buffer.from('Not found'), 'text/plain; charset=utf-8');
    const data = fs.readFileSync(file);
    const isHtml = ext === '.html';
    const cache = isHtml ? 'no-cache' : (ext === '.css' || ext === '.js' ? 'public, max-age=86400' : 'public, max-age=2592000, immutable');
    const acceptEncoding = String(req.headers['accept-encoding'] || '');
    let payload = data;
    const headers = { 'Cache-Control': cache, 'Last-Modified': stat.mtime.toUTCString() };
    if (data.length > 1024 && acceptEncoding.includes('br')) { payload = brotliCompressSync(data); headers['Content-Encoding'] = 'br'; headers.Vary = 'Accept-Encoding'; }
    else if (data.length > 1024 && acceptEncoding.includes('gzip')) { payload = gzipSync(data); headers['Content-Encoding'] = 'gzip'; headers.Vary = 'Accept-Encoding'; }
    if (req.method === 'HEAD') { res.writeHead(200, { ...HEADERS, 'Content-Type': type, 'Content-Length': payload.length, ...headers }); return res.end(); }
    return send(res, 200, payload, type, headers);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    console.error('Static file error:', error);
    return send(res, 500, Buffer.from('Internal server error'), 'text/plain; charset=utf-8');
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Connection', 'keep-alive');
  const globalRl = rateLimit(getClientIp(req), RATE_WINDOW_MS, RATE_LIMIT, 'global');
  if (!globalRl.allowed) return json(res, 429, { message: 'Too many requests. Please try again later.' }, { 'Retry-After': String(globalRl.retryAfter) });

  let requestUrl;
  try { requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch { return json(res, 400, { message: 'Bad request.' }); }
  const pathname = requestUrl.pathname.replace(/\/{2,}/g, '/') || '/';

  if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true, service: 'eic-club' }, { 'Cache-Control': 'no-store' });
  if (req.method === 'POST' && pathname === '/api/membership') return handleMembership(req, res);
  if (pathname.startsWith('/api/')) return json(res, 404, { message: 'Not found.' });
  if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { message: 'Method not allowed.' }, { Allow: 'GET, HEAD, POST' });

  const served = serveStatic(req, res, pathname);
  if (served !== false) return;

  return send(res, 404, htmlRoute('404.html'), 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
});

server.requestTimeout = 10_000;
server.headersTimeout = 12_000;
server.keepAliveTimeout = 5_000;

if (NODE_ENV === 'production') {
  // HSTS is appropriate only when production traffic is guaranteed to be HTTPS.
  HEADERS['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
}

await initDatabase();

server.listen(PORT, () => {
  console.log(`EIC site running at http://localhost:${PORT}`);
  console.log(`Canonical site URL: ${SITE_URL}`);
});

const shutdown = (signal) => {
  console.log(`${signal}: shutting down`);
  server.close(async () => { await closeDatabase(); process.exit(0); });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
