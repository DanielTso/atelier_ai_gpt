import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from '@/db/schema'

const DDL = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT,
  default_persona_id TEXT,
  default_model TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  archived INTEGER DEFAULT 0,
  system_prompt TEXT,
  summary TEXT,
  summary_up_to_message_id INTEGER,
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_chats_project_id ON chats(project_id);
CREATE INDEX IF NOT EXISTS idx_chats_created_at ON chats(created_at);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS message_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding TEXT NOT NULL,
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_embeddings_chat_id ON message_embeddings(chat_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_project_id ON message_embeddings(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_message_id ON message_embeddings(message_id);

CREATE TABLE IF NOT EXISTS persona_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
  persona_id TEXT NOT NULL,
  model_used TEXT,
  message_count INTEGER DEFAULT 0,
  last_used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_persona_usage_project_id ON persona_usage(project_id);
CREATE INDEX IF NOT EXISTS idx_persona_usage_chat_id ON persona_usage(chat_id);

CREATE TABLE IF NOT EXISTS message_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  data_url TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_attachments_chat_id ON message_attachments(chat_id);

CREATE TABLE IF NOT EXISTS chat_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  confidence INTEGER DEFAULT 50,
  detected_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_chat_topics_chat_id ON chat_topics(chat_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_topics_chat_id_topic ON chat_topics(chat_id, topic);

PRAGMA foreign_keys = ON;
`

export let testDb: ReturnType<typeof drizzle<typeof schema>>

export async function createTestDb() {
  const client = createClient({ url: ':memory:' })
  await client.executeMultiple(DDL)
  testDb = drizzle(client, { schema })
  return testDb
}
