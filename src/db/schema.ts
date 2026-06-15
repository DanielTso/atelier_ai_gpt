import { pgTable, text, integer, boolean, timestamp, vector, index, uniqueIndex } from 'drizzle-orm/pg-core';

const idPk = () => integer('id').primaryKey().generatedAlwaysAsIdentity();
const createdAt = (name = 'created_at') => timestamp(name, { withTimezone: true }).defaultNow();

export const projects = pgTable('projects', {
  id: idPk(),
  name: text('name').notNull(),
  icon: text('icon'),
  defaultPersonaId: text('default_persona_id'),
  defaultModel: text('default_model'),
  createdAt: createdAt(),
});

export const chats = pgTable('chats', {
  id: idPk(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  archived: boolean('archived').notNull().default(false),
  systemPrompt: text('system_prompt'),
  summary: text('summary'),
  summaryUpToMessageId: integer('summary_up_to_message_id'),
  createdAt: createdAt(),
}, (table) => [
  index('idx_chats_project_id').on(table.projectId),
  index('idx_chats_created_at').on(table.createdAt),
  index('idx_chats_archived_project').on(table.projectId, table.archived, table.createdAt),
]);

export const messages = pgTable('messages', {
  id: idPk(),
  chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: createdAt(),
}, (table) => [
  index('idx_messages_chat_id').on(table.chatId),
  index('idx_messages_created_at').on(table.createdAt),
]);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const messageEmbeddings = pgTable('message_embeddings', {
  id: idPk(),
  messageId: integer('message_id').references(() => messages.id, { onDelete: 'cascade' }).notNull(),
  chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 768 }).notNull(),
  createdAt: createdAt(),
}, (table) => [
  index('idx_embeddings_chat_id').on(table.chatId),
  index('idx_embeddings_project_id').on(table.projectId),
  uniqueIndex('idx_embeddings_message_id').on(table.messageId),
  index('idx_embeddings_vector').using('hnsw', table.embedding.op('vector_cosine_ops')),
]);

export const documents = pgTable('documents', {
  id: idPk(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  charCount: integer('char_count').notNull(),
  chunkCount: integer('chunk_count').default(0),
  status: text('status').notNull().default('processing'),
  errorMessage: text('error_message'),
  storagePath: text('storage_path'),
  thumbnailPath: text('thumbnail_path'),
  createdAt: createdAt(),
}, (table) => [
  index('idx_documents_project_id').on(table.projectId),
]);

export const documentChunks = pgTable('document_chunks', {
  id: idPk(),
  documentId: integer('document_id').references(() => documents.id, { onDelete: 'cascade' }).notNull(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 768 }),
  createdAt: createdAt(),
}, (table) => [
  index('idx_chunks_document_id').on(table.documentId),
  index('idx_chunks_project_id').on(table.projectId),
  index('idx_chunks_vector').using('hnsw', table.embedding.op('vector_cosine_ops')),
]);

export const personaUsage = pgTable('persona_usage', {
  id: idPk(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }),
  personaId: text('persona_id').notNull(),
  modelUsed: text('model_used'),
  messageCount: integer('message_count').default(0),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_persona_usage_project_id').on(table.projectId),
  index('idx_persona_usage_chat_id').on(table.chatId),
]);

export const messageAttachments = pgTable('message_attachments', {
  id: idPk(),
  messageId: integer('message_id').references(() => messages.id, { onDelete: 'cascade' }).notNull(),
  chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
  filename: text('filename').notNull(),
  mediaType: text('media_type').notNull(),
  dataUrl: text('data_url').notNull(),
  fileSize: integer('file_size').notNull(),
  createdAt: createdAt(),
}, (table) => [
  index('idx_attachments_message_id').on(table.messageId),
  index('idx_attachments_chat_id').on(table.chatId),
]);

export const chatTopics = pgTable('chat_topics', {
  id: idPk(),
  chatId: integer('chat_id').references(() => chats.id, { onDelete: 'cascade' }).notNull(),
  topic: text('topic').notNull(),
  confidence: integer('confidence').default(50),
  detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_chat_topics_chat_id').on(table.chatId),
  uniqueIndex('idx_chat_topics_chat_id_topic').on(table.chatId, table.topic),
]);
