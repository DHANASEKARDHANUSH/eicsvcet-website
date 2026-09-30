import crypto from 'node:crypto';

const SESSION_COOKIE = 'eic_admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  }
  return out;
}

function safeEqualText(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function verifyPassword(password, storedHash) {
  try {
    const parts = String(storedHash).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const [, n, r, p, saltHex, hashHex] = parts;
    const N = Number(n);
    const R = Number(r);
    const P = Number(p);

    if (!Number.isSafeInteger(N) || !Number.isSafeInteger(R) || !Number.isSafeInteger(P)) return false;
    if (N < 1024 || R < 1 || P < 1) return false;

    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const derived = crypto.scryptSync(password, salt, expected.length || 64, {
      N,
      r: R,
      p: P,
      maxmem: 64 * 1024 * 1024
    });

    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function configuredAdmins() {
  const serialized = process.env.ADMIN_USERS;
  if (serialized) {
    try {
      const admins = JSON.parse(serialized);
      if (!Array.isArray(admins)) return [];
      return admins.filter(admin =>
        admin && typeof admin.username === 'string' && admin.username &&
        typeof admin.passwordHash === 'string' && admin.passwordHash
      );
    } catch {
      return [];
    }
  }

  const username = process.env.ADMIN_USERNAME || '';
  const passwordHash = process.env.ADMIN_PASSWORD_HASH || '';
  return username && passwordHash ? [{ username, passwordHash }] : [];
}

export function authenticateAdmin(username, password) {
  if (!username || !password) return null;
  const admin = configuredAdmins().find(candidate => safeEqualText(username, candidate.username));
  if (!admin || !verifyPassword(password, admin.passwordHash)) return null;

  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const session = { token, csrfToken, createdAt: now, expiresAt: now + SESSION_TTL_MS };

  sessions.set(token, session);
  return session;
}

export function getAdminSession(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;

  if (Date.now() >= session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  return session;
}

export function destroyAdminSession(req) {
  const session = getAdminSession(req);
  if (session) sessions.delete(session.token);
}

export function isValidCsrf(req, session) {
  const token = String(req.headers['x-csrf-token'] || '');
  return Boolean(session && token && safeEqualText(token, session.csrfToken));
}

export function setAdminCookie(token, production) {
  const secure = production ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`;
}

export function clearAdminCookie(production) {
  const secure = production ? '; Secure' : '';
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
}

export function sameOrigin(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return false;

  try {
    const expectedHost = String(req.headers.host || '');
    const originUrl = new URL(origin);
    return originUrl.host === expectedHost && ['http:', 'https:'].includes(originUrl.protocol);
  } catch {
    return false;
  }
}

const loginBuckets = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 6;

export function adminLoginRateLimit(ip) {
  const key = String(ip || 'unknown').slice(0, 128);
  const now = Date.now();
  let bucket = loginBuckets.get(key);
  if (!bucket || now - bucket.start >= LOGIN_WINDOW_MS) bucket = { start: now, count: 0 };
  bucket.count += 1;
  loginBuckets.set(key, bucket);
  return {
    allowed: bucket.count <= LOGIN_LIMIT,
    retryAfter: Math.max(1, Math.ceil((bucket.start + LOGIN_WINDOW_MS - now) / 1000))
  };
}

setInterval(() => {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  for (const [key, bucket] of loginBuckets) {
    if (bucket.start < cutoff) loginBuckets.delete(key);
  }
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}, 10 * 60 * 1000).unref();
