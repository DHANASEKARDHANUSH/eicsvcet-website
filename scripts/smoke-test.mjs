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
const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, NODE_ENV: 'test', PORT: '3187', ADMIN_USERS: JSON.stringify(testAdmins) }, stdio: ['ignore','pipe','pipe'] });
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
  const achievementResponse = await fetch('http://127.0.0.1:3187/api/admin/content', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:3187',
      cookie: adminSession.cookie,
      'x-csrf-token': adminSession.csrfToken
    },
    body: JSON.stringify({ kind: 'achievement', title: 'Smoke-test award', description: 'A student team received a test award.', eventDate: null, location: 'Test competition', published: true, image: null })
  });
  if (achievementResponse.status !== 201) throw new Error(`Achievement create failed: ${achievementResponse.status} ${await achievementResponse.text()}`);
  const { item: achievement } = await achievementResponse.json();
  const publicAchievementsResponse = await fetch('http://127.0.0.1:3187/api/public/content?kind=achievement');
  if (!publicAchievementsResponse.ok) throw new Error(`Public achievements failed: ${publicAchievementsResponse.status}`);
  const publicAchievements = await publicAchievementsResponse.json();
  if (!publicAchievements.items.some(item => item.id === achievement.id)) throw new Error('Created achievement was not visible publicly');
  const removeAchievement = await fetch(`http://127.0.0.1:3187/api/admin/content/${achievement.id}`, {
    method: 'DELETE',
    headers: { origin: 'http://127.0.0.1:3187', cookie: adminSession.cookie, 'x-csrf-token': adminSession.csrfToken }
  });
  if (!removeAchievement.ok) throw new Error(`Achievement cleanup failed: ${removeAchievement.status}`);
  console.log('achievement create/public/cleanup: passed');
  const runId = Date.now().toString();
  const registration = await fetch('http://127.0.0.1:3187/api/membership', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3187' },
    body: JSON.stringify({ name:'Test Student', email:`smoke-${crypto.randomUUID()}@example.edu`, phone:`+91 9${runId.slice(-9)}`, registerNumber:`SMOKE${runId}`, department:'AIDS', year:'3rd year', interests:['Technology','Research'], motivation:'I want to build useful prototypes with the club and learn how to validate them.', website:'' })
  });
  console.log(`membership POST: ${registration.status}`);
  if (registration.status !== 201) throw new Error(`Registration test failed: ${await registration.text()}`);
  console.log('Smoke test passed.');
} finally { stop(); await sleep(200); console.log(output); }
