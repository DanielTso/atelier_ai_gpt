import 'dotenv/config';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:sqlite.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Enable foreign key enforcement for local SQLite
// Turso remote mode already enforces FKs; this ensures local dev parity
client.execute('PRAGMA foreign_keys = ON').catch(() => {})

export const db = drizzle(client, { schema });
