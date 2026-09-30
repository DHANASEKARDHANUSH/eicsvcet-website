import webpush from 'web-push';
import { pool } from './db.js';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || '';

const VAPID_CONFIGURED = Boolean(
  VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT
);

if (VAPID_CONFIGURED) {
  webpush.setVapidDetails(
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
} else {
  console.warn(
    'Web Push is disabled: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT are required.'
  );
}

export async function initPushDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export function getVapidPublicKey() {
  return VAPID_CONFIGURED ? VAPID_PUBLIC_KEY : '';
}

function normalizeSubscription(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid push subscription.');
  }

  const endpoint = typeof value.endpoint === 'string' ? value.endpoint.trim() : '';
  const keys = value.keys;
  const p256dh = typeof keys?.p256dh === 'string' ? keys.p256dh.trim() : '';
  const auth = typeof keys?.auth === 'string' ? keys.auth.trim() : '';

  if (!endpoint || endpoint.length > 4096) throw new Error('Invalid push endpoint.');
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('Invalid push endpoint.');
  }
  if (parsed.protocol !== 'https:') throw new Error('Invalid push endpoint.');

  if (!/^[A-Za-z0-9_-]+$/.test(p256dh) || p256dh.length < 20 || p256dh.length > 512) {
    throw new Error('Invalid push subscription key.');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(auth) || auth.length < 8 || auth.length > 256) {
    throw new Error('Invalid push authentication key.');
  }

  return { endpoint, p256dh, auth };
}

export async function savePushSubscription(value) {
  const subscription = normalizeSubscription(value);

  await pool.query(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth)
    VALUES ($1, $2, $3)
    ON CONFLICT (endpoint)
    DO UPDATE SET
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      updated_at = NOW()
  `, [subscription.endpoint, subscription.p256dh, subscription.auth]);
}

export async function removePushSubscription(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 4096) return;
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

async function listPushSubscriptions() {
  const { rows } = await pool.query(`
    SELECT endpoint, p256dh, auth
    FROM push_subscriptions
    ORDER BY id ASC
  `);
  return rows;
}

async function sendOne(row, payload) {
  const subscription = {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth
    }
  };

  return webpush.sendNotification(subscription, payload, {
    TTL: 86400,
    urgency: 'normal',
    timeout: 10000
  });
}

export async function sendContentPush(item) {
  if (!VAPID_CONFIGURED) {
    return { sent: 0, removed: 0, failed: 0, skipped: true };
  }

  const rows = await listPushSubscriptions();
  if (!rows.length) {
    return { sent: 0, removed: 0, failed: 0, skipped: false };
  }

  const kindLabel = item.kind === 'event' ? 'event' : 'achievement';
  const payload = JSON.stringify({
    title: `New EIC ${kindLabel}`,
    body: item.title,
    icon: '/assets/favicon.svg',
    badge: '/assets/favicon.svg',
    tag: `eic-${kindLabel}-${item.id}`,
    url: '/initiatives/'
  });

  let sent = 0;
  let removed = 0;
  let failed = 0;

  // Keep concurrency bounded so a large subscriber list does not create
  // an uncontrolled burst of outbound requests.
  const batchSize = 25;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map(async row => {
        try {
          await sendOne(row, payload);
          return { status: 'sent', row };
        } catch (error) {
          const statusCode = Number(error?.statusCode || 0);
          if (statusCode === 404 || statusCode === 410) {
            await removePushSubscription(row.endpoint);
            return { status: 'removed', row };
          }
          console.error('Web Push delivery failed:', {
            statusCode,
            endpoint: row.endpoint.slice(0, 80)
          });
          return { status: 'failed', row };
        }
      })
    );

    for (const result of results) {
      if (result.status !== 'fulfilled') {
        failed += 1;
      } else if (result.value.status === 'sent') {
        sent += 1;
      } else if (result.value.status === 'removed') {
        removed += 1;
      } else {
        failed += 1;
      }
    }
  }

  return { sent, removed, failed, skipped: false };
}
