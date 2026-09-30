import crypto from 'node:crypto';
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = prompt => new Promise(resolve => rl.question(prompt, resolve));

const username = (await ask('Admin username: ')).trim();
const password = await ask('Admin password (12+ characters): ');
rl.close();

if (!username || username.length > 100) {
  console.error('Username must contain between 1 and 100 characters.');
  process.exit(1);
}

if (password.length < 12) {
  console.error('Password must contain at least 12 characters.');
  process.exit(1);
}

const N = 16_384;
const r = 8;
const p = 1;
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
const account = {
  username,
  passwordHash: `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`
};

console.log('\nAdd this object to the ADMIN_USERS JSON array in .env:\n');
console.log(JSON.stringify(account));
console.log('\nFor the first admin, the .env value looks like:\n');
console.log(`ADMIN_USERS='${JSON.stringify([account])}'`);
