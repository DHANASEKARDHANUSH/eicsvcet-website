import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, getApplications } from '../db.js';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const header = ['reference','name','email','phone','register_number','department','year','interests','motivation','created_at'];
try {
	const rows = await getApplications();
	const lines = [header.map(escape).join(',')];
	for (const row of rows) lines.push(header.map((key) => escape(key === 'interests' ? (Array.isArray(row[key]) ? row[key] : JSON.parse(row[key] || '[]')).join('; ') : row[key])).join(','));
	const outDir = path.join(root, 'exports'); fs.mkdirSync(outDir, { recursive: true });
	const out = path.join(outDir, `members-${new Date().toISOString().slice(0,10)}.csv`);
	fs.writeFileSync(out, lines.join('\n') + '\n', { mode: 0o600 });
	console.log(`Exported ${rows.length} applications to ${out}`);
} finally {
	await closeDatabase();
}
