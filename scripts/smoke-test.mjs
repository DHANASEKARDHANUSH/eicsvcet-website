import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const testAdminCredentials = [
  { username: 'smoke-admin-one', password: 'smoke-password-one' },
  { username: 'smoke-admin-two', password: 'smoke-password-two' }
];
const testAdmins = testAdminCredentials.map(({ username, password }) => {
  const N = 16_384;
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return { username, passwordHash: `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}` };
});
const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, NODE_ENV: 'test', PORT: '3187', ADMIN_USERS: JSON.stringify(testAdmins), VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' }, stdio: ['ignore','pipe','pipe'] });
let output = '';
proc.stdout.on('data', (d) => output += d.toString());
proc.stderr.on('data', (d) => output += d.toString());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stop = () => proc.kill('SIGTERM');
try {
  let health;
  for (let i=0;i<60;i++) { try { health = await fetch('http://127.0.0.1:3187/api/health'); if (health.ok) break; } catch {} await sleep(100); }
  if (!health?.ok) throw new Error('Server did not become ready.');
  const checks = [
    ['home', await fetch('http://127.0.0.1:3187/')],
    ['admin', await fetch('http://127.0.0.1:3187/admin/')],
    ['about', await fetch('http://127.0.0.1:3187/about/')],
    ['initiatives', await fetch('http://127.0.0.1:3187/initiatives/')],
    ['achievements', await fetch('http://127.0.0.1:3187/initiatives/achievements/')],
    ['membership', await fetch('http://127.0.0.1:3187/membership/')],
    ['contact', await fetch('http://127.0.0.1:3187/contact/')],
    ['404', await fetch('http://127.0.0.1:3187/not-a-page')],
    ['health', health]
  ];
  const valid = checks.every(([name, r]) => name === '404' ? r.status === 404 : r.ok);
  for (const [name, r] of checks) console.log(`${name}: ${r.status}`);
  if (!valid) throw new Error('HTTP smoke test failed');
  const adminApi = await fetch('http://127.0.0.1:3187/api/admin/content');
  console.log(`admin API auth: ${adminApi.status}`);
  if (adminApi.status !== 401) throw new Error('Admin API route smoke test failed');
  const publicKeyResponse = await fetch('http://127.0.0.1:3187/api/notifications/public-key');
  if (publicKeyResponse.status !== 503) throw new Error('Unconfigured VAPID key route should return 503');
  const testSubscription = {
    endpoint: 'https://push.example.test/eic-smoke',
    keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) }
  };
  const saveSubscription = await fetch('http://127.0.0.1:3187/api/notifications/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3187' },
    body: JSON.stringify(testSubscription)
  });
  if (saveSubscription.status !== 201) throw new Error(`Subscription save failed: ${saveSubscription.status}`);
  const removeSubscription = await fetch('http://127.0.0.1:3187/api/notifications/subscribe', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3187' },
    body: JSON.stringify({ endpoint: testSubscription.endpoint })
  });
  if (!removeSubscription.ok) throw new Error(`Subscription removal failed: ${removeSubscription.status}`);
  const emptySession = await fetch('http://127.0.0.1:3187/api/admin/session');
  const emptySessionData = await emptySession.json();
  if (!emptySessionData || emptySessionData.authenticated) throw new Error('Unauthenticated session check failed');
  let adminSession;
  for (const { username, password } of testAdminCredentials) {
    const login = await fetch('http://127.0.0.1:3187/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3187' },
      body: JSON.stringify({ username, password })
    });
    if (!login.ok) throw new Error(`Admin login failed for ${username}: ${login.status}`);
    const loginData = await login.json();
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0] || '';
    const restoredSession = await fetch('http://127.0.0.1:3187/api/admin/session', { headers: { cookie } });
    const restoredData = await restoredSession.json();
    if (!restoredData.authenticated || restoredData.csrfToken !== loginData.csrfToken) {
      throw new Error(`Admin session could not be restored for ${username}`);
    }
    const content = await fetch('http://127.0.0.1:3187/api/admin/content', { headers: { cookie } });
    console.log(`admin login (${username}): ${content.status}`);
    if (!content.ok) throw new Error(`Admin session failed for ${username}: ${content.status}`);
    if (!adminSession) {
      adminSession = { cookie, csrfToken: loginData.csrfToken };
    }
  }
  const createPost = (kind, title, published = true) => fetch('http://127.0.0.1:3187/api/admin/content', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:3187',
      cookie: adminSession.cookie,
      'x-csrf-token': adminSession.csrfToken
    },
    body: JSON.stringify({ kind, title, description: 'A test post used by the smoke test.', eventDate: null, location: 'Test venue', published, image: null })
  });
  const achievementResponse = await createPost('achievement', 'Smoke-test award');
  if (achievementResponse.status !== 201) throw new Error(`Achievement create failed: ${achievementResponse.status} ${await achievementResponse.text()}`);
  const achievementResult = await achievementResponse.json();
  const achievement = achievementResult.item;
  if (!achievementResult.notification?.skipped) throw new Error('Published achievement did not produce a push result');
  const publicAchievementsResponse = await fetch('http://127.0.0.1:3187/api/public/content?kind=achievement');
  if (!publicAchievementsResponse.ok) throw new Error(`Public achievements failed: ${publicAchievementsResponse.status}`);
  const publicAchievements = await publicAchievementsResponse.json();
  if (!publicAchievements.items.some(item => item.id === achievement.id)) throw new Error('Created achievement was not visible publicly');
  const removeAchievement = await fetch(`http://127.0.0.1:3187/api/admin/content/${achievement.id}`, {
    method: 'DELETE',
    headers: { origin: 'http://127.0.0.1:3187', cookie: adminSession.cookie, 'x-csrf-token': adminSession.csrfToken }
  });
  if (!removeAchievement.ok) throw new Error(`Achievement cleanup failed: ${removeAchievement.status}`);
  const eventResponse = await createPost('event', 'Smoke-test event');
  if (eventResponse.status !== 201) throw new Error(`Event create failed: ${eventResponse.status} ${await eventResponse.text()}`);
  const eventResult = await eventResponse.json();
  if (!eventResult.notification?.skipped) throw new Error('Published event did not produce a push result');
  const removeEvent = await fetch(`http://127.0.0.1:3187/api/admin/content/${eventResult.item.id}`, {
    method: 'DELETE',
    headers: { origin: 'http://127.0.0.1:3187', cookie: adminSession.cookie, 'x-csrf-token': adminSession.csrfToken }
  });
  if (!removeEvent.ok) throw new Error(`Event cleanup failed: ${removeEvent.status}`);
  const draftResponse = await createPost('achievement', 'Smoke-test draft', false);
  if (draftResponse.status !== 201) throw new Error(`Draft creation failed: ${draftResponse.status}`);
  const draftResult = await draftResponse.json();
  if (draftResult.notification !== null) throw new Error('Draft achievement should not trigger a push');
  const removeDraft = await fetch(`http://127.0.0.1:3187/api/admin/content/${draftResult.item.id}`, {
    method: 'DELETE',
    headers: { origin: 'http://127.0.0.1:3187', cookie: adminSession.cookie, 'x-csrf-token': adminSession.csrfToken }
  });
  if (!removeDraft.ok) throw new Error(`Draft cleanup failed: ${removeDraft.status}`);
  console.log('event and achievement notifications / subscription lifecycle: passed');
  const runId = Date.now().toString();
  const registration = await fetch('http://127.0.0.1:3187/api/membership', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3187' },
    body: JSON.stringify({ name:'Test Student', email:`smoke-${crypto.randomUUID()}@example.edu`, phone:`+91 9${runId.slice(-9)}`, registerNumber:`SMOKE${runId}`, department:'AIDS', year:'3rd year', interests:['Technology','Research'], motivation:'I want to build useful prototypes with the club and learn how to validate them.', website:'' })
  });
  console.log(`membership POST: ${registration.status}`);
  if (registration.status !== 201) throw new Error(`Registration test failed: ${await registration.text()}`);
  console.log('Smoke test passed.');
} finally { stop(); await sleep(200); console.log(output); }
