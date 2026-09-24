import { spawn } from 'node:child_process';
const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, NODE_ENV: 'test', PORT: '3187' }, stdio: ['ignore','pipe','pipe'] });
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
  const registration = await fetch('http://127.0.0.1:3187/api/membership', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3187' },
    body: JSON.stringify({ name:'Test Student', email:`smoke-${Date.now()}@example.edu`, phone:'+91 9876543210', registerNumber:'TEST001', department:'AIDS', year:'3rd year', interests:['Technology','Research'], motivation:'I want to build useful prototypes with the club and learn how to validate them.', website:'' })
  });
  console.log(`membership POST: ${registration.status}`);
  if (registration.status !== 201) throw new Error(`Registration test failed: ${await registration.text()}`);
  console.log('Smoke test passed.');
} finally { stop(); await sleep(200); console.log(output); }
