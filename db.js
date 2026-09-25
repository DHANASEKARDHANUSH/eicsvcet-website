import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true'
    ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

export async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS membership_applications (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL UNIQUE,
      register_number TEXT NOT NULL,
      department TEXT NOT NULL,
      year TEXT NOT NULL,
      interests JSONB NOT NULL,
      motivation TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_membership_created_at
      ON membership_applications(created_at);
  `);
}

export async function insertApplication(values) {
  await pool.query(`
    INSERT INTO membership_applications
      (reference, name, email, phone, register_number, department, year, interests, motivation, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
  `, values);
}

export async function getApplications() {
  const { rows } = await pool.query(`
    SELECT reference, name, email, phone, register_number, department, year,
           interests, motivation, created_at
    FROM membership_applications
    ORDER BY id DESC
  `);
  return rows;
}

export async function closeDatabase() {
  await pool.end();
}

export { pool };
