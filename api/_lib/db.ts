import { neon } from '@neondatabase/serverless';
import { generateAccountPublicId, isValidAccountPublicId } from './crypto.js';

export interface UserRow {
  id: string;
  public_id: string | null;
  provider: string;
  contact_key: string | null;
  contact_display: string;
  password_salt: string | null;
  password_hash: string | null;
  google_id: string | null;
  telegram_id: string | null;
  telegram_username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  child_name: string;
  avatar_id: string;
  created_at: string | Date;
  updated_at: string | Date;
}

let _sql: ReturnType<typeof neon> | null = null;
let _schemaPromise: Promise<void> | null = null;

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getSql() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error('DATABASE_URL is not configured');
  }
  if (!_sql) {
    _sql = neon(url);
  }
  return _sql;
}

export async function ensureSchema(): Promise<void> {
  if (!_schemaPromise) {
    _schemaPromise = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          public_id TEXT UNIQUE,
          provider TEXT NOT NULL DEFAULT 'password',
          contact_key TEXT UNIQUE,
          contact_display TEXT NOT NULL,
          password_salt TEXT,
          password_hash TEXT,
          google_id TEXT UNIQUE,
          telegram_id TEXT UNIQUE,
          telegram_username TEXT,
          display_name TEXT,
          avatar_url TEXT,
          child_name TEXT NOT NULL DEFAULT 'Bolajon',
          avatar_id TEXT NOT NULL DEFAULT 'fox',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS public_id TEXT
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_id
        ON users (public_id)
        WHERE public_id IS NOT NULL
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS user_states (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          state_json JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS telegram_auth_codes (
          code_hash TEXT PRIMARY KEY,
          telegram_id TEXT NOT NULL,
          telegram_username TEXT,
          first_name TEXT NOT NULL DEFAULT '',
          last_name TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_tg_auth_codes_tg_id
        ON telegram_auth_codes (telegram_id, created_at DESC)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS telegram_login_sessions (
          token_hash TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'pending',
          child_name TEXT,
          avatar_id TEXT,
          telegram_id TEXT,
          telegram_username TEXT,
          first_name TEXT NOT NULL DEFAULT '',
          last_name TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          approved_at TIMESTAMPTZ,
          consumed_at TIMESTAMPTZ
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_tg_login_sessions_expires
        ON telegram_login_sessions (expires_at)
      `;
    })().catch((err) => {
      _schemaPromise = null;
      throw err;
    });
  }
  return _schemaPromise;
}

export function isUniqueViolationError(err: unknown, hint?: string): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as { code?: unknown; constraint?: unknown; message?: unknown };
  const isUnique =
    record.code === '23505' ||
    (typeof record.message === 'string' &&
      record.message.toLowerCase().includes('unique'));
  if (!isUnique) return false;
  if (!hint) return true;
  const hay = `${typeof record.constraint === 'string' ? record.constraint : ''} ${
    typeof record.message === 'string' ? record.message : ''
  }`.toLowerCase();
  return hay.includes(hint.toLowerCase());
}

export async function ensureUserPublicId(user: UserRow): Promise<UserRow> {
  if (isValidAccountPublicId(user.public_id)) {
    return user;
  }

  const sql = getSql();
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateAccountPublicId();
    try {
      const updated = (await sql`
        UPDATE users
        SET public_id = ${candidate}, updated_at = NOW()
        WHERE id = ${user.id} AND (public_id IS NULL OR public_id !~ '^[0-9]{8}$')
        RETURNING *
      `) as UserRow[];
      if (updated[0]) {
        return updated[0];
      }
      const fetched = (await sql`
        SELECT * FROM users WHERE id = ${user.id} LIMIT 1
      `) as UserRow[];
      if (isValidAccountPublicId(fetched[0]?.public_id)) {
        return fetched[0];
      }
    } catch (err) {
      if (isUniqueViolationError(err) && attempt < 4) {
        continue;
      }
      throw err;
    }
  }

  throw new Error('Could not assign unique public_id to user');
}

export function userRowToSession(row: UserRow, signedInAt = new Date().toISOString()) {
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  return {
    id: row.id,
    publicId: row.public_id ?? undefined,
    contact: row.contact_display,
    createdAt,
    signedInAt,
    provider: (row.provider === 'google' || row.provider === 'telegram'
      ? row.provider
      : 'password') as 'password' | 'google' | 'telegram',
    avatarUrl: row.avatar_url ?? undefined,
  };
}
