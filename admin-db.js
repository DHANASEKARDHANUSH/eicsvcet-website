import { pool } from './db.js';

const ALLOWED_KINDS = new Set(['event', 'program', 'achievement']);

export async function initAdminDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS club_content_items (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('event', 'program', 'achievement')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      event_date TIMESTAMPTZ,
      location TEXT,
      image_data BYTEA,
      image_mime TEXT,
      image_alt TEXT,
      published BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT club_content_image_pair CHECK (
        (image_data IS NULL AND image_mime IS NULL AND image_alt IS NULL)
        OR
        (image_data IS NOT NULL AND image_mime IN ('image/jpeg','image/png','image/webp') AND image_alt IS NOT NULL)
      )
    )
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'club_content_items'::regclass
          AND conname = 'club_content_items_kind_check'
          AND pg_get_constraintdef(oid) NOT ILIKE '%achievement%'
      ) THEN
        ALTER TABLE club_content_items DROP CONSTRAINT club_content_items_kind_check;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'club_content_items'::regclass
          AND conname = 'club_content_items_kind_check'
      ) THEN
        ALTER TABLE club_content_items
          ADD CONSTRAINT club_content_items_kind_check
          CHECK (kind IN ('event', 'program', 'achievement'));
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_club_content_kind_created_at
    ON club_content_items(kind, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_club_content_event_date
    ON club_content_items(event_date)
  `);
}

function assertKind(kind) {
  if (!ALLOWED_KINDS.has(kind)) throw new Error('Invalid content type.');
}

export async function listPublicContent(kind, limit = null) {
  assertKind(kind);

  const values = [kind];
  const limitClause = Number.isInteger(limit) && limit > 0
    ? (values.push(limit + 1), `LIMIT $${values.length}`)
    : '';
  const orderClause = kind === 'achievement'
    ? 'created_at DESC, id DESC'
    : `CASE WHEN event_date IS NULL THEN 1 ELSE 0 END,
       event_date DESC NULLS LAST,
       created_at DESC, id DESC`;
  const { rows } = await pool.query(`
    SELECT
      id, kind, title, description, event_date, location,
      image_mime, image_alt, created_at, updated_at
    FROM club_content_items
    WHERE kind = $1 AND published = TRUE
    ORDER BY ${orderClause}
    ${limitClause}
  `, values);

  const hasMore = Number.isInteger(limit) && limit > 0 && rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items: items.map(row => ({
    id: row.id.toString(),
    kind: row.kind,
    title: row.title,
    description: row.description,
    eventDate: row.event_date,
    location: row.location,
    imageUrl: row.image_mime ? `/api/public/content/${row.id}/image` : null,
    imageAlt: row.image_alt,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  })), hasMore };
}

export async function listAdminContent(kind = '') {
  const values = [];
  let where = '';

  if (kind) {
    assertKind(kind);
    values.push(kind);
    where = 'WHERE kind = $1';
  }

  const { rows } = await pool.query(`
    SELECT
      id, kind, title, description, event_date, location,
      image_mime, image_alt, published, created_at, updated_at
    FROM club_content_items
    ${where}
    ORDER BY created_at DESC, id DESC
  `, values);

  return rows.map(row => ({
    id: row.id.toString(),
    kind: row.kind,
    title: row.title,
    description: row.description,
    eventDate: row.event_date,
    location: row.location,
    imageUrl: row.image_mime ? `/api/admin/content/${row.id}/image` : null,
    imageAlt: row.image_alt,
    published: row.published,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function getContentImage(id) {
  const { rows } = await pool.query(`
    SELECT image_data, image_mime, updated_at
    FROM club_content_items
    WHERE id = $1 AND published = TRUE
  `, [id]);

  return rows[0] || null;
}

export async function createContent(item) {
  assertKind(item.kind);

  const { rows } = await pool.query(`
    INSERT INTO club_content_items
      (kind, title, description, event_date, location, image_data, image_mime, image_alt, published)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING id, kind, title, description, event_date, location, image_mime, image_alt, published, created_at, updated_at
  `, [
    item.kind,
    item.title,
    item.description,
    item.eventDate,
    item.location,
    item.imageData,
    item.imageMime,
    item.imageAlt,
    item.published
  ]);

  return normalizeAdminRow(rows[0]);
}

export async function updateContent(id, item) {
  assertKind(item.kind);

  const { rows } = await pool.query(`
    UPDATE club_content_items
    SET
      kind = $1,
      title = $2,
      description = $3,
      event_date = $4,
      location = $5,
      image_data = COALESCE($6, image_data),
      image_mime = CASE WHEN $6 IS NULL THEN image_mime ELSE $7 END,
      image_alt = CASE WHEN $6 IS NULL THEN image_alt ELSE $8 END,
      published = $9,
      updated_at = NOW()
    WHERE id = $10
    RETURNING id, kind, title, description, event_date, location, image_mime, image_alt, published, created_at, updated_at
  `, [
    item.kind,
    item.title,
    item.description,
    item.eventDate,
    item.location,
    item.imageData,
    item.imageMime,
    item.imageAlt,
    item.published,
    id
  ]);

  return rows[0] ? normalizeAdminRow(rows[0]) : null;
}

export async function deleteContent(id) {
  const result = await pool.query(
    'DELETE FROM club_content_items WHERE id = $1 RETURNING id',
    [id]
  );
  return result.rowCount === 1;
}

export async function getContentImageForAdmin(id) {
  const { rows } = await pool.query(`
    SELECT image_data, image_mime, updated_at
    FROM club_content_items
    WHERE id = $1
  `, [id]);
  return rows[0] || null;
}

export async function listMembershipRows() {
  const { rows } = await pool.query(`
    SELECT
      reference, name, email, phone, register_number,
      department, year, interests, motivation, created_at
    FROM membership_applications
    ORDER BY id DESC
  `);
  return rows;
}

function normalizeAdminRow(row) {
  return {
    id: row.id.toString(),
    kind: row.kind,
    title: row.title,
    description: row.description,
    eventDate: row.event_date,
    location: row.location,
    imageUrl: row.image_mime ? `/api/public/content/${row.id}/image` : null,
    imageAlt: row.image_alt,
    published: row.published,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
