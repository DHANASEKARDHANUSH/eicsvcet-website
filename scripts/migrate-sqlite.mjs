import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { closeDatabase, initDatabase, pool } from '../db.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sqlitePath = path.join(root, 'data', 'eic.db');

if (!fs.existsSync(sqlitePath)) {
  throw new Error(`SQLite database not found: ${sqlitePath}`);
}

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const rows = sqlite.prepare(`
  SELECT id, reference, name, email, phone, register_number, department,
         year, interests, motivation, created_at
  FROM membership_applications
  ORDER BY id
`).all();

try {
  await initDatabase();
  await pool.query('BEGIN');
  for (const row of rows) {
    await pool.query(`
      INSERT INTO membership_applications
        (id, reference, name, email, phone, register_number, department, year, interests, motivation, created_at)
      OVERRIDING SYSTEM VALUE
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
      ON CONFLICT DO NOTHING
    `, [
      row.id, row.reference, row.name, row.email, row.phone,
      row.register_number, row.department, row.year, row.interests,
      row.motivation, row.created_at
    ]);
  }
  await pool.query(`
    SELECT setval(
      pg_get_serial_sequence('membership_applications', 'id'),
      COALESCE((SELECT MAX(id) FROM membership_applications), 1),
      true
    )
  `);
  await pool.query('COMMIT');
  console.log(`Migrated ${rows.length} SQLite applications to PostgreSQL.`);
} catch (error) {
  await pool.query('ROLLBACK');
  throw error;
} finally {
  sqlite.close();
  await closeDatabase();
}
