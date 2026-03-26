import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  icon: text('icon'),
  defaultPersonaId: text('default_persona_id'),
  defaultModel: text('default_model'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const chats = sqliteTable('chats', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  systemPrompt: text('system_prompt'), // Per-chat system instruction (never trimmed)
  summary: text('summary'), // Compressed context from older messages
  summaryUpToMessageId: integer('summary_up_to_message_id'), // Last message ID included in summary
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => ({
  projectIdIdx: index('idx_chats_project_id').on(table.projectId),
  createdAtIdx: index('idx_chats_created_at').on(table.createdAt),
  archivedProjectIdx: index('idx_chats_archived_project').on(table.projectId, table.archived, table.createdAt),
}));

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => ({
  chatIdIdx: index('idx_messages_chat_id').on(table.chatId),
  createdAtIdx: index('idx_messages_created_at').on(table.createdAt),
}));

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Semantic memory: vector embeddings for messages
export const messageEmbeddings = sqliteTable('message_embeddings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id').references(() => messages.id, { onDelete: 'cascade' }).notNull(),
  chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  embedding: text('embedding').notNull(), // JSON-serialized float[] (768 dims)
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => ({
  chatIdIdx: index('idx_embeddings_chat_id').on(table.chatId),
  projectIdIdx: index('idx_embeddings_project_id').on(table.projectId),
  messageIdIdx: uniqueIndex('idx_embeddings_message_id').on(table.messageId),
}));

// Document RAG: uploaded documents per project
export const documents = sqliteTable('documents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  charCount: integer('char_count').notNull(),
  chunkCount: integer('chunk_count').default(0),
  status: text('status').notNull().default('processing'), // 'processing' | 'ready' | 'error'
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => ({
  projectIdIdx: index('idx_documents_project_id').on(table.projectId),
}));

// Document RAG: chunked text with embeddings
export const documentChunks = sqliteTable('document_chunks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  documentId: integer('document_id').references(() => documents.id, { onDelete: 'cascade' }).notNull(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  embedding: text('embedding'), // JSON 768-dim vector, nullable until processed
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => ({
  documentIdIdx: index('idx_chunks_document_id').on(table.documentId),
  projectIdIdx: index('idx_chunks_project_id').on(table.projectId),
}));

// Persona usage tracking
export const personaUsage = sqliteTable('persona_usage', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }),
  personaId: text('persona_id').notNull(),
  modelUsed: text('model_used'),
  messageCount: integer('message_count').default(0),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => ({
  projectIdIdx: index('idx_persona_usage_project_id').on(table.projectId),
  chatIdIdx: index('idx_persona_usage_chat_id').on(table.chatId),
}));

// Message image/file attachments (multimodal)
export const messageAttachments = sqliteTable('message_attachments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id').references(() => messages.id, { onDelete: 'cascade' }).notNull(),
  chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
  filename: text('filename').notNull(),
  mediaType: text('media_type').notNull(),
  dataUrl: text('data_url').notNull(),
  fileSize: integer('file_size').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => ({
  messageIdIdx: index('idx_attachments_message_id').on(table.messageId),
  chatIdIdx: index('idx_attachments_chat_id').on(table.chatId),
}));

// Chat topic detection results
export const chatTopics = sqliteTable('chat_topics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
  topic: text('topic').notNull(),
  confidence: integer('confidence').default(50),
  detectedAt: integer('detected_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => ({
  chatIdIdx: index('idx_chat_topics_chat_id').on(table.chatId),
  chatIdTopicIdx: uniqueIndex('idx_chat_topics_chat_id_topic').on(table.chatId, table.topic),
}));
