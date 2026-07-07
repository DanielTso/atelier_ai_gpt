'use server'

import { db } from '@/db'
import { projects, chats, messages, settings, messageEmbeddings, personaUsage, chatTopics, documents, documentChunks, documentRevisions, messageAttachments, artifacts, artifactVersions, memorySuggestions, generatedImages } from '@/db/schema'
import { eq, desc, isNull, isNotNull, and, lte, gt, asc, count, inArray, sql } from 'drizzle-orm'
import { isStorageConfigured, uploadBuffer, createSignedDownloadUrls, removeObjects, signedArtifactUrl, signedArtifactUrls } from '@/lib/storage'
import { blankArtifactTemplate } from '@/lib/artifacts/templates'
import { renderArtifact } from '@/lib/artifacts/render'
import { artifactStoragePath } from '@/lib/artifacts/path'
import type { ArtifactType, SheetSpec } from '@/lib/artifacts/types'

function sanitizeAttachmentName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+$/, '_')
}

// Cap decoded attachment size. User uploads are bounded by the server-action body
// limit, but AI-generated images (saved in onFinish) are not — guard the decode so
// an oversized data URL can't balloon server memory.
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024 // 20MB
// Signed URLs for chat images live in the open page for a session; a short TTL would
// break already-rendered <img> tags. Use a generous window (private bucket, single user).
const ATTACHMENT_URL_TTL_SECONDS = 24 * 60 * 60 // 24h

function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',')
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  if (b64.length > Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3)) {
    throw new Error('Attachment too large')
  }
  return Buffer.from(b64, 'base64')
}

async function removeAttachmentObjects(where: ReturnType<typeof eq>) {
  if (!isStorageConfigured()) return
  const rows = await db.select({ storagePath: messageAttachments.storagePath }).from(messageAttachments).where(where)
  const paths = rows.map(r => r.storagePath).filter((p): p is string => Boolean(p))
  // Best-effort: the DB row (the recovery anchor) is about to be deleted, so log the
  // exact paths if cleanup fails — they'd otherwise be untraceable orphans.
  if (paths.length) await removeObjects(paths).catch(e => console.warn('[attachments] storage cleanup failed for paths:', paths, e instanceof Error ? e.message : e))
}

const SENSITIVE_KEYS = new Set(['gemini-api-key', 'anthropic-api-key', 'tavily-api-key'])

export async function getProjects() {
  return await db.select().from(projects)
}

// Document count per project (for the Projects view cards). Returns a map keyed by
// projectId; projects with no documents are simply absent (callers default to 0).
export async function getProjectFileCounts(): Promise<Record<number, number>> {
  const rows = await db
    .select({ projectId: documents.projectId, n: count() })
    .from(documents)
    .groupBy(documents.projectId)
  const map: Record<number, number> = {}
  for (const r of rows) map[r.projectId] = Number(r.n)
  return map
}

// Defensive bounds for free-text persisted to NOT NULL columns. Single-user app, but
// keep oversized/garbage values out of the DB regardless of the caller (the UI also
// validates upstream).
const MAX_NAME_LEN = 200
const MAX_MESSAGE_LEN = 200_000
const VALID_MESSAGE_ROLES = new Set(['user', 'assistant', 'system'])

export async function createProject(name: string) {
  return await db.insert(projects).values({ name: name.slice(0, MAX_NAME_LEN) }).returning()
}

export async function deleteProject(id: number) {
  await db.delete(projects).where(eq(projects.id, id))
}

// Bump a project's updated_at to "now". Best-effort: a touch failure must never
// break the mutation that triggered it.
async function touchProject(projectId: number) {
  try {
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId))
  } catch (e) {
    console.error('[touchProject] failed:', e)
  }
}

// Bump the project that owns a chat (no-op for standalone chats — project_id is null).
async function touchProjectForChat(chatId: number) {
  try {
    await db.execute(
      sql`UPDATE projects SET updated_at = now() WHERE id = (SELECT project_id FROM chats WHERE id = ${chatId})`,
    )
  } catch (e) {
    console.error('[touchProjectForChat] failed:', e)
  }
}

export async function updateProjectName(id: number, name: string) {
  return await db.update(projects).set({ name, updatedAt: new Date() }).where(eq(projects.id, id)).returning()
}

export async function updateProjectContext(
  id: number,
  fields: { memory?: string | null; instructions?: string | null },
) {
  const set: { memory?: string | null; instructions?: string | null; updatedAt: Date } = {
    updatedAt: new Date(),
  }
  if ('memory' in fields) set.memory = fields.memory ?? null
  if ('instructions' in fields) set.instructions = fields.instructions ?? null
  return await db.update(projects).set(set).where(eq(projects.id, id)).returning()
}

export async function getProjectContext(id: number) {
  const [row] = await db
    .select({ memory: projects.memory, instructions: projects.instructions })
    .from(projects)
    .where(eq(projects.id, id))
  return row ?? null
}

export async function getChats(projectId: number) {
  return await db.select().from(chats).where(
    and(eq(chats.projectId, projectId), eq(chats.archived, false))
  ).orderBy(desc(chats.createdAt))
}

export async function getProjectChatPreviews(projectId: number) {
  const projectChats = await db.select().from(chats).where(
    and(eq(chats.projectId, projectId), eq(chats.archived, false))
  ).orderBy(desc(chats.createdAt))

  if (projectChats.length === 0) return []

  const chatIds = projectChats.map(c => c.id)
  // Pick the first user message per chat and truncate to 120 chars in SQL, so we transfer
  // ~120 bytes/chat instead of every full message body. DISTINCT ON (chat_id) with the
  // ORDER BY leading on chat_id then created_at keeps the earliest row per chat.
  const previews = await db.selectDistinctOn([messages.chatId], {
    chatId: messages.chatId,
    preview: sql<string>`left(${messages.content}, 120)`,
  }).from(messages)
    .where(and(
      inArray(messages.chatId, chatIds),
      eq(messages.role, 'user')
    ))
    .orderBy(messages.chatId, asc(messages.createdAt))

  const firstMsgMap = new Map<number, string>()
  for (const row of previews) {
    firstMsgMap.set(row.chatId, row.preview)
  }

  return projectChats.map(chat => ({
    id: chat.id,
    title: chat.title,
    preview: firstMsgMap.get(chat.id) ?? null,
    createdAt: chat.createdAt,
  }))
}

export async function getAllProjectChats() {
  // Get all non-archived chats that belong to a project
  return await db.select().from(chats).where(
    and(isNotNull(chats.projectId), eq(chats.archived, false))
  ).orderBy(desc(chats.createdAt))
}

export async function getStandaloneChats() {
  return await db.select().from(chats).where(
    and(isNull(chats.projectId), eq(chats.archived, false))
  ).orderBy(desc(chats.createdAt))
}

export async function createChat(projectId: number, title: string) {
  const rows = await db.insert(chats).values({ projectId, title: title.slice(0, MAX_NAME_LEN) }).returning()
  await touchProject(projectId)
  return rows
}

export async function createStandaloneChat(title: string) {
  return await db.insert(chats).values({ projectId: null, title: title.slice(0, MAX_NAME_LEN) }).returning()
}

export async function deleteChat(id: number) {
  await removeAttachmentObjects(eq(messageAttachments.chatId, id))
  await db.delete(chats).where(eq(chats.id, id))
}

export async function updateChatTitle(id: number, title: string) {
  return await db.update(chats).set({ title }).where(eq(chats.id, id)).returning()
}

export async function saveMessage(chatId: number, role: string, content: string) {
  const safeRole = VALID_MESSAGE_ROLES.has(role) ? role : 'user'
  const rows = await db.insert(messages)
    .values({ chatId, role: safeRole, content: content.slice(0, MAX_MESSAGE_LEN) })
    .returning()
  await touchProjectForChat(chatId)
  return rows
}

export async function deleteMessage(id: number) {
  await removeAttachmentObjects(eq(messageAttachments.messageId, id))
  await db.delete(messages).where(eq(messages.id, id))
}

export async function getChatMessages(chatId: number, limit: number = 100) {
  // Limit messages to improve performance on large chats
  // Load most recent messages by ordering by createdAt DESC and limiting, then reverse
  const recentMessages = await db.select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(desc(messages.createdAt))
    .limit(limit)

  // Reverse to get chronological order (oldest first)
  return recentMessages.reverse()
}

export async function moveChatToProject(chatId: number, projectId: number | null) {
  return await db.update(chats).set({ projectId }).where(eq(chats.id, chatId)).returning()
}

export async function archiveChat(id: number) {
  return await db.update(chats).set({ archived: true }).where(eq(chats.id, id)).returning()
}

export async function restoreChat(id: number) {
  return await db.update(chats).set({ archived: false }).where(eq(chats.id, id)).returning()
}

export async function getArchivedChats() {
  return await db.select().from(chats).where(eq(chats.archived, true)).orderBy(desc(chats.createdAt))
}

// Context Management Actions

export async function getChatWithContext(chatId: number) {
  // Get chat with summary and system prompt for context building
  const [result] = await db.select().from(chats).where(eq(chats.id, chatId))
  return result
}

export async function updateChatSystemPrompt(chatId: number, systemPrompt: string | null) {
  return await db.update(chats)
    .set({ systemPrompt })
    .where(eq(chats.id, chatId))
    .returning()
}

export async function updateChatSummary(chatId: number, summary: string, summaryUpToMessageId: number) {
  return await db.update(chats)
    .set({ summary, summaryUpToMessageId })
    .where(eq(chats.id, chatId))
    .returning()
}

export async function getMessageCount(chatId: number) {
  const [result] = await db.select({ count: count() })
    .from(messages)
    .where(eq(messages.chatId, chatId))
  return result?.count ?? 0
}

export async function getMessagesForSummarization(chatId: number, upToMessageId: number, fromMessageId = 0) {
  // Fold only messages in (fromMessageId, upToMessageId]. `fromMessageId` defaults to
  // 0 (backwards-compatible: 0 < every identity PK) so existing callers are unchanged;
  // the summarize route passes chat.summaryUpToMessageId so each fold is incremental.
  return await db.select()
    .from(messages)
    .where(and(
      eq(messages.chatId, chatId),
      gt(messages.id, fromMessageId),
      lte(messages.id, upToMessageId),
    ))
    .orderBy(asc(messages.createdAt))
}

// Settings Actions

export async function getSetting(key: string) {
  if (SENSITIVE_KEYS.has(key)) {
    throw new Error('Access denied: this setting cannot be read from the client')
  }
  const [result] = await db.select().from(settings).where(eq(settings.key, key))
  return result?.value ?? null
}

export async function getSettings(keys: string[]) {
  const safeKeys = keys.filter(k => !SENSITIVE_KEYS.has(k))
  if (safeKeys.length === 0) return {}
  const results = await db.select().from(settings).where(inArray(settings.key, safeKeys))
  const map: Record<string, string> = {}
  for (const row of results) {
    map[row.key] = row.value
  }
  return map
}

export async function setSetting(key: string, value: string) {
  const { clearSettingsCache } = await import('@/lib/settings')
  clearSettingsCache()
  return await db.insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
    .returning()
}

export async function setSettings(entries: { key: string; value: string }[]) {
  const { clearSettingsCache } = await import('@/lib/settings')
  clearSettingsCache()
  return await db.transaction(async (tx) => {
    const results = []
    for (const entry of entries) {
      const result = await tx.insert(settings)
        .values({ key: entry.key, value: entry.value, updatedAt: new Date() })
        .onConflictDoUpdate({ target: settings.key, set: { value: entry.value, updatedAt: new Date() } })
        .returning()
      results.push(result)
    }
    return results
  })
}

// ── Embedding Actions ──

export async function saveMessageEmbedding(
  messageId: number,
  chatId: number,
  projectId: number | null,
  content: string,
  embedding: number[]
) {
  return await db.insert(messageEmbeddings).values({
    messageId,
    chatId,
    projectId,
    content,
    embedding,
  }).onConflictDoUpdate({
    target: messageEmbeddings.messageId,
    set: { content, embedding, createdAt: new Date() },
  }).returning()
}


export async function getEmbeddingCount(scope?: { chatId?: number; projectId?: number }) {
  if (scope?.projectId) {
    const result = await db.select({ value: count() }).from(messageEmbeddings)
      .where(eq(messageEmbeddings.projectId, scope.projectId))
    return result[0]?.value ?? 0
  }
  if (scope?.chatId) {
    const result = await db.select({ value: count() }).from(messageEmbeddings)
      .where(eq(messageEmbeddings.chatId, scope.chatId))
    return result[0]?.value ?? 0
  }
  const result = await db.select({ value: count() }).from(messageEmbeddings)
  return result[0]?.value ?? 0
}

// ── Project Defaults Actions ──

export async function updateProjectDefaults(
  projectId: number,
  defaults: { defaultPersonaId?: string | null; defaultModel?: string | null }
) {
  return await db.update(projects)
    .set(defaults)
    .where(eq(projects.id, projectId))
    .returning()
}

export async function getProjectDefaults(projectId: number) {
  const [result] = await db.select({
    defaultPersonaId: projects.defaultPersonaId,
    defaultModel: projects.defaultModel,
  }).from(projects).where(eq(projects.id, projectId))
  return result ?? { defaultPersonaId: null, defaultModel: null }
}

// ── Persona Usage Tracking Actions ──

export async function recordPersonaUsage(data: {
  projectId: number | null
  chatId: number
  personaId: string
  modelUsed: string | null
}) {
  return await db.insert(personaUsage).values({
    projectId: data.projectId,
    chatId: data.chatId,
    personaId: data.personaId,
    modelUsed: data.modelUsed,
    messageCount: 1,
    lastUsedAt: new Date(),
  }).returning()
}

export async function incrementUsageMessageCount(chatId: number) {
  // Best-effort analytics. The increment itself is atomic SQL (`messageCount + 1`), but
  // the select-then-update is not transactional, so a row inserted between the two could
  // be missed under concurrent same-chat writes — acceptable here (single-user app; a
  // slightly under-counted usage stat is non-critical). Wrap in a transaction only if it drifts.
  const [existing] = await db.select().from(personaUsage)
    .where(eq(personaUsage.chatId, chatId))
    .orderBy(desc(personaUsage.lastUsedAt))
    .limit(1)

  if (existing) {
    return await db.update(personaUsage)
      .set({
        messageCount: sql`${personaUsage.messageCount} + 1`,
        lastUsedAt: new Date(),
      })
      .where(eq(personaUsage.id, existing.id))
      .returning()
  }
  return null
}

export async function getProjectPersonaStats(projectId: number) {
  return await db.select().from(personaUsage)
    .where(eq(personaUsage.projectId, projectId))
    .orderBy(desc(personaUsage.messageCount))
}

// ── Chat Topics Actions ──

export async function saveChatTopics(chatId: number, topics: { topic: string; confidence: number }[]) {
  if (topics.length === 0) return []
  const rows = topics.map(t => ({ chatId, topic: t.topic, confidence: t.confidence, detectedAt: new Date() }))
  return await db.insert(chatTopics).values(rows).returning()
}

export async function getChatTopics(chatId: number) {
  return await db.select().from(chatTopics)
    .where(eq(chatTopics.chatId, chatId))
    .orderBy(desc(chatTopics.confidence))
}

// ── Document RAG Actions ──

export async function createUploadingDocument(data: {
  projectId: number
  filename: string
  mimeType: string
  fileSize: number
}) {
  const rows = await db.insert(documents).values({
    projectId: data.projectId,
    filename: data.filename,
    mimeType: data.mimeType,
    fileSize: data.fileSize,
    charCount: 0,
    status: 'uploading',
  }).returning()
  await touchProject(data.projectId)
  return rows
}

export async function updateDocumentStoragePath(id: number, storagePath: string) {
  return await db.update(documents).set({ storagePath }).where(eq(documents.id, id)).returning()
}

export async function getDocumentById(id: number) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id))
  return doc ?? null
}

export async function updateDocumentStatus(
  id: number,
  status: 'uploading' | 'processing' | 'ready' | 'error',
  updates?: { chunkCount?: number; errorMessage?: string; charCount?: number; thumbnailPath?: string; extractionMethod?: 'text' | 'vision' }
) {
  return await db.update(documents)
    .set({ status, ...updates, updatedAt: new Date() })
    .where(eq(documents.id, id))
    .returning()
}

export async function getProjectDocuments(projectId: number) {
  return await db.select().from(documents)
    .where(eq(documents.projectId, projectId))
    .orderBy(desc(documents.createdAt))
}

// A 'processing' row older than this (by its last status write, falling back to
// created_at for legacy rows) is treated as stuck — a platform timeout killed the
// function mid-run, bypassing every catch. 20 min > maxDuration (~13.3 min) so a
// still-running job is never reaped. Not exported: actions.ts is a 'use server'
// module, which may only export async functions (a const export fails the build).
const STALE_PROCESSING_MINUTES = 20

// Opportunistic lazy sweep (no cron infra): flip genuinely-stuck 'processing' rows to
// a terminal 'error' so a killed function never leaves a row stuck forever. Called from
// GET /api/documents before listing; one indexed UPDATE, negligible cost.
export async function reapStaleProcessing(projectId?: number) {
  return await db.update(documents)
    .set({ status: 'error', errorMessage: 'Processing timed out', updatedAt: new Date() })
    .where(and(
      eq(documents.status, 'processing'),
      sql`coalesce(${documents.updatedAt}, ${documents.createdAt}) < now() - make_interval(mins => ${STALE_PROCESSING_MINUTES})`,
      projectId !== undefined ? eq(documents.projectId, projectId) : undefined,
    ))
    .returning()
}

export async function deleteDocument(id: number) {
  return await db.delete(documents).where(eq(documents.id, id)).returning()
}

// --- Re-versioning ---

/** Snapshot a superseded revision (file retained in Storage; no chunks copied). */
export async function createDocumentRevision(data: {
  documentId: number
  projectId: number
  revision: number
  filename: string
  mimeType: string
  fileSize: number
  storagePath: string | null
  thumbnailPath: string | null
  charCount: number | null
  chunkCount: number | null
  extractionMethod: string | null
}) {
  return await db.insert(documentRevisions).values(data).returning()
}

/** Remove all chunks for a document (used before re-chunking a new revision). */
export async function deleteDocumentChunks(documentId: number) {
  return await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId)).returning()
}

/** Superseded revisions for a document, newest first (for a future history UI). */
export async function getDocumentRevisions(documentId: number) {
  return await db.select().from(documentRevisions)
    .where(eq(documentRevisions.documentId, documentId))
    .orderBy(desc(documentRevisions.revision))
}

/**
 * Atomically commit a document replacement: delete the old chunks, insert the new
 * (already-embedded) chunks, and swap the document's metadata + revision — all in
 * one transaction. Embeddings are computed BEFORE calling this, so a failure can
 * never leave the document with old metadata and zero chunks (the prior revision
 * stays intact until this commit succeeds).
 */
export async function commitDocumentReplacement(
  documentId: number,
  projectId: number,
  chunks: { chunkIndex: number; content: string; embedding: number[] | null }[],
  meta: {
    filename: string
    mimeType: string
    fileSize: number
    storagePath: string
    thumbnailPath?: string | null
    charCount: number
    chunkCount: number
    extractionMethod: 'text' | 'vision'
    revision: number
    status: 'ready' | 'error'
    errorMessage?: string | null
  },
) {
  return await db.transaction(async (tx) => {
    await tx.delete(documentChunks).where(eq(documentChunks.documentId, documentId))
    if (chunks.length > 0) {
      await tx.insert(documentChunks).values(chunks.map(c => ({
        documentId, projectId, chunkIndex: c.chunkIndex, content: c.content, embedding: c.embedding,
      })))
    }
    await tx.update(documents)
      .set({
        filename: meta.filename, mimeType: meta.mimeType, fileSize: meta.fileSize,
        storagePath: meta.storagePath, thumbnailPath: meta.thumbnailPath ?? null,
        charCount: meta.charCount, chunkCount: meta.chunkCount, extractionMethod: meta.extractionMethod,
        revision: meta.revision, status: meta.status, errorMessage: meta.errorMessage ?? null,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId))
  })
}

export async function saveDocumentChunks(chunks: {
  documentId: number
  projectId: number
  chunkIndex: number
  content: string
}[]) {
  if (chunks.length === 0) return []
  return await db.insert(documentChunks).values(chunks).returning()
}

export async function updateChunkEmbedding(chunkId: number, embedding: number[]) {
  return await db.update(documentChunks)
    .set({ embedding })
    .where(eq(documentChunks.id, chunkId))
    .returning()
}

export async function getDocumentChunks(documentId: number) {
  return await db.select({
    id: documentChunks.id,
    chunkIndex: documentChunks.chunkIndex,
    content: documentChunks.content,
  }).from(documentChunks)
    .where(eq(documentChunks.documentId, documentId))
    .orderBy(documentChunks.chunkIndex)
}

export async function getDocumentChunksForProject(projectId: number) {
  return await db.select({
    id: documentChunks.id,
    documentId: documentChunks.documentId,
    projectId: documentChunks.projectId,
    chunkIndex: documentChunks.chunkIndex,
    content: documentChunks.content,
    embedding: documentChunks.embedding,
    filename: documents.filename,
  }).from(documentChunks)
    .innerJoin(documents, eq(documentChunks.documentId, documents.id))
    .where(
      and(
        eq(documentChunks.projectId, projectId),
        isNotNull(documentChunks.embedding)
      )
    )
}

// ── Message Attachment Actions ──

export async function saveMessageAttachments(
  messageId: number,
  chatId: number,
  attachments: { filename: string; mediaType: string; dataUrl: string; fileSize: number }[]
) {
  if (attachments.length === 0) return []
  if (isStorageConfigured()) {
    // Upload serially and track what landed, so a mid-batch failure cleans up the
    // already-uploaded objects instead of orphaning them (the insert below is
    // all-or-nothing, so a partial upload must not leave stray blobs).
    const rows: typeof messageAttachments.$inferInsert[] = []
    const uploaded: string[] = []
    try {
      for (const [i, a] of attachments.entries()) {
        const path = `attachments/${chatId}/${messageId}/${i}-${sanitizeAttachmentName(a.filename)}`
        await uploadBuffer(path, dataUrlToBuffer(a.dataUrl), a.mediaType)
        uploaded.push(path)
        rows.push({ messageId, chatId, filename: a.filename, mediaType: a.mediaType, storagePath: path, dataUrl: null, fileSize: a.fileSize })
      }
      return await db.insert(messageAttachments).values(rows).returning()
    } catch (e) {
      if (uploaded.length) await removeObjects(uploaded).catch(() => {})
      throw e
    }
  }
  const rows = attachments.map(a => ({ messageId, chatId, filename: a.filename, mediaType: a.mediaType, dataUrl: a.dataUrl, fileSize: a.fileSize }))
  return await db.insert(messageAttachments).values(rows).returning()
}

// Link an already-uploaded generated image (from the generate_image tool) to a message.
// The bytes are already in storage at `storagePath`; we just insert the attachment row so
// getChatAttachments mints a signed URL and the image renders inline like any attachment.
export async function saveGeneratedImage(
  messageId: number,
  chatId: number,
  items: { storagePath: string; mediaType: string; filename: string; fileSize?: number }[]
) {
  if (items.length === 0) return []
  const rows = items.map(it => ({
    messageId, chatId, filename: it.filename, mediaType: it.mediaType,
    storagePath: it.storagePath, dataUrl: null, fileSize: it.fileSize ?? 0,
  }))
  return await db.insert(messageAttachments).values(rows).returning()
}

export async function getChatAttachments(chatId: number) {
  const rows = await db.select().from(messageAttachments).where(eq(messageAttachments.chatId, chatId))
  const storagePaths = rows.map(r => r.storagePath).filter((p): p is string => Boolean(p))
  const urlMap = await createSignedDownloadUrls(storagePaths, ATTACHMENT_URL_TTL_SECONDS)
  return rows.map(r => ({
    messageId: r.messageId,
    mediaType: r.mediaType,
    filename: r.filename,
    url: r.storagePath ? (urlMap.get(r.storagePath) ?? '') : (r.dataUrl ?? ''),
  }))
}

export async function getApiKeyStatus(): Promise<{ gemini: boolean; anthropic: boolean; tavily: boolean }> {
  const { getGeminiApiKey, getAnthropicApiKey, getTavilyApiKey } = await import('@/lib/settings')
  const [gemini, anthropic, tavily] = await Promise.all([getGeminiApiKey(), getAnthropicApiKey(), getTavilyApiKey()])
  return { gemini: Boolean(gemini), anthropic: Boolean(anthropic), tavily: Boolean(tavily) }
}

// ── Artifact Actions ──

export async function createArtifact(data: {
  chatId: number; projectId: number | null; type: string; title: string; storagePath: string
  status?: string; errorMessage?: string; format?: string | null; content?: string | null
}) {
  // Insert the artifact + seed version 1 atomically (source content kept for
  // preview/edit/regenerate). Returns [row] so existing `[row] = await …` holds.
  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(artifacts).values({
      chatId: data.chatId, projectId: data.projectId ?? null, type: data.type, title: data.title,
      storagePath: data.storagePath, status: data.status ?? 'ready', errorMessage: data.errorMessage ?? null,
      format: data.format ?? null, content: data.content ?? null, currentVersion: 1,
    }).returning()
    if (row) {
      await tx.insert(artifactVersions).values({
        artifactId: row.id, version: 1, type: data.type, title: data.title,
        format: data.format ?? null, content: data.content ?? null, storagePath: data.storagePath,
      })
    }
    return row ? [row] : []
  })
}

export async function getArtifactById(id: number) {
  const [a] = await db.select().from(artifacts).where(eq(artifacts.id, id))
  return a ?? null
}

/**
 * Raw Storage object paths for every version of an artifact (cleanup on delete).
 * Unlike getArtifactVersions (which signs URLs for the UI), this returns the bare
 * paths so the DELETE route can sweep superseded blobs before the version rows
 * cascade away — mirroring the documents revision sweep.
 */
export async function getArtifactVersionPaths(artifactId: number): Promise<string[]> {
  const rows = await db.select({ storagePath: artifactVersions.storagePath }).from(artifactVersions)
    .where(eq(artifactVersions.artifactId, artifactId))
  return rows.map(r => r.storagePath).filter((p): p is string => Boolean(p))
}

/** Versions for an artifact, newest first, each with a signed download URL. */
export async function getArtifactVersions(artifactId: number) {
  const rows = await db.select().from(artifactVersions)
    .where(eq(artifactVersions.artifactId, artifactId))
    .orderBy(desc(artifactVersions.version))
  return await Promise.all(rows.map(async (v) => ({
    id: v.id, version: v.version, type: v.type, title: v.title, format: v.format, content: v.content,
    createdAt: v.createdAt,
    downloadUrl: await signedArtifactUrl(v.storagePath),
  })))
}

/**
 * Append a new artifact version (edit/regenerate) atomically: insert the version
 * row and point the artifact at it (denormalized current fields + bumped version).
 * The new binary is rendered/uploaded by the caller; `storagePath` is its path.
 */
export async function addArtifactVersion(artifactId: number, data: {
  type: string; title: string; format: string | null; content: string | null; storagePath: string
}) {
  return await db.transaction(async (tx) => {
    const [latest] = await tx.select({ v: artifactVersions.version }).from(artifactVersions)
      .where(eq(artifactVersions.artifactId, artifactId))
      .orderBy(desc(artifactVersions.version))
      .limit(1)
    const nextVersion = (latest?.v ?? 0) + 1
    await tx.insert(artifactVersions).values({
      artifactId, version: nextVersion, type: data.type, title: data.title,
      format: data.format, content: data.content, storagePath: data.storagePath,
    })
    await tx.update(artifacts).set({
      type: data.type, title: data.title, format: data.format, content: data.content,
      storagePath: data.storagePath, currentVersion: nextVersion,
    }).where(eq(artifacts.id, artifactId))
    return { version: nextVersion }
  })
}

/** Restore an existing version as current (no new row; just re-point the artifact). */
export async function restoreArtifactVersion(artifactId: number, version: number) {
  return await db.transaction(async (tx) => {
    const [v] = await tx.select().from(artifactVersions)
      .where(and(eq(artifactVersions.artifactId, artifactId), eq(artifactVersions.version, version)))
    if (!v) return null
    await tx.update(artifacts).set({
      type: v.type, title: v.title, format: v.format, content: v.content,
      storagePath: v.storagePath, currentVersion: v.version,
    }).where(eq(artifacts.id, artifactId))
    return { version: v.version }
  })
}

// Row → API shape with a signed download URL (best-effort). Uses the generous
// artifact TTL so the link doesn't expire before the user clicks Download.
async function toArtifactSummary(r: typeof artifacts.$inferSelect) {
  return {
    id: r.id, chatId: r.chatId, type: r.type, title: r.title, status: r.status, createdAt: r.createdAt,
    format: r.format, content: r.content, version: r.currentVersion,
    downloadUrl: await signedArtifactUrl(r.storagePath),
  }
}

export async function getChatArtifacts(chatId: number) {
  const rows = await db.select().from(artifacts).where(eq(artifacts.chatId, chatId)).orderBy(asc(artifacts.createdAt))
  return await Promise.all(rows.map(toArtifactSummary))
}

export async function deleteArtifact(id: number) {
  return await db.delete(artifacts).where(eq(artifacts.id, id)).returning()
}

// Bounded gallery list: recent artifacts + source metadata (chat title, project name)
// and an "edited" timestamp = the latest version's created_at (fallback: the artifact's).
export async function getAllArtifacts(limit = 60) {
  const rows = await db
    .select({
      id: artifacts.id, chatId: artifacts.chatId, type: artifacts.type, title: artifacts.title,
      status: artifacts.status, createdAt: artifacts.createdAt, format: artifacts.format,
      content: artifacts.content, version: artifacts.currentVersion, storagePath: artifacts.storagePath,
      chatTitle: chats.title, projectName: projects.name,
      editedAt: sql<Date>`max(${artifactVersions.createdAt})`,
    })
    .from(artifacts)
    .leftJoin(chats, eq(artifacts.chatId, chats.id))
    .leftJoin(projects, eq(artifacts.projectId, projects.id))
    .leftJoin(artifactVersions, eq(artifactVersions.artifactId, artifacts.id))
    .groupBy(artifacts.id, chats.title, projects.name)
    .orderBy(desc(artifacts.createdAt))
    .limit(limit)

  const urlMap = await signedArtifactUrls(rows.map(r => r.storagePath))
  return rows.map(r => ({
    id: r.id, chatId: r.chatId, type: r.type, title: r.title, status: r.status,
    createdAt: r.createdAt, format: r.format, content: r.content, version: r.version,
    chatTitle: r.chatTitle, projectName: r.projectName,
    editedAt: r.editedAt ?? r.createdAt,
    downloadUrl: r.storagePath ? (urlMap.get(r.storagePath) ?? null) : null,
  }))
}

// New-artifact authoring: create a standalone host chat (chat_id is NOT NULL) + a blank
// template artifact (v1), opened in the workspace editor by the client.
export async function createBlankArtifact(type: ArtifactType): Promise<{ artifactId: number; chatId: number }> {
  if (!isStorageConfigured()) throw new Error('File storage is not configured.')
  const tpl = blankArtifactTemplate(type)
  const renderContent: string | SheetSpec[] =
    tpl.format === 'sheets' ? (JSON.parse(tpl.content) as SheetSpec[]) : tpl.content

  const [chat] = await createStandaloneChat(tpl.title)
  if (!chat) throw new Error('Failed to create host chat')

  let path: string | null = null
  try {
    const { buffer, contentType, ext } = await renderArtifact(type, tpl.title, renderContent)
    path = artifactStoragePath(null, tpl.title, ext)
    await uploadBuffer(path, buffer, contentType)
    const [art] = await createArtifact({
      chatId: chat.id, projectId: null, type, title: tpl.title,
      storagePath: path, status: 'ready', format: tpl.format, content: tpl.content,
    })
    if (!art) throw new Error('Failed to persist artifact')
    return { artifactId: art.id, chatId: chat.id }
  } catch (e) {
    // Roll back so a failed create leaves no orphan host chat or storage object.
    if (path) await removeObjects([path]).catch(() => {})
    await deleteChat(chat.id).catch(() => {})
    throw e
  }
}

// ── Memory Suggestion Actions (auto-memory) ──

export async function createMemorySuggestions(projectId: number, chatId: number | null, texts: string[]) {
  if (texts.length === 0) return []
  const rows = texts.map(text => ({ projectId, chatId, text }))
  return await db.insert(memorySuggestions).values(rows).returning()
}

export async function getPendingSuggestions(projectId: number) {
  return await db.select().from(memorySuggestions)
    .where(and(eq(memorySuggestions.projectId, projectId), eq(memorySuggestions.status, 'pending')))
    .orderBy(desc(memorySuggestions.createdAt))
}

export async function countPendingSuggestions(projectId: number) {
  const [row] = await db.select({ value: count() }).from(memorySuggestions)
    .where(and(eq(memorySuggestions.projectId, projectId), eq(memorySuggestions.status, 'pending')))
  return row?.value ?? 0
}

export async function getRecentlyDismissed(projectId: number, limit = 50) {
  const rows = await db.select({ text: memorySuggestions.text }).from(memorySuggestions)
    .where(and(eq(memorySuggestions.projectId, projectId), eq(memorySuggestions.status, 'dismissed')))
    .orderBy(desc(memorySuggestions.createdAt))
    .limit(limit)
  return rows.map(r => r.text)
}

export async function acceptSuggestion(id: number, overrideText?: string) {
  // Transactional + SQL-side append so two concurrent accepts (or an accept racing
  // a memory edit) can't lost-update projects.memory, and the project + suggestion
  // never end up inconsistent on a partial failure.
  return await db.transaction(async (tx) => {
    const [row] = await tx.select().from(memorySuggestions).where(eq(memorySuggestions.id, id))
    if (!row) return null
    const text = (overrideText ?? row.text).trim()
    const [updated] = await tx.update(projects)
      .set({
        memory: sql`case when ${projects.memory} is null or ${projects.memory} = '' then ${text} else ${projects.memory} || chr(10) || ${text} end`,
      })
      .where(eq(projects.id, row.projectId))
      .returning({ memory: projects.memory })
    await tx.update(memorySuggestions).set({ status: 'accepted' }).where(eq(memorySuggestions.id, id))
    return { memory: updated?.memory ?? text }
  })
}

export async function dismissSuggestion(id: number) {
  return await db.update(memorySuggestions).set({ status: 'dismissed' }).where(eq(memorySuggestions.id, id))
}

// ── Generated Images Actions (Images gallery) ──

const IMAGE_URL_TTL_SECONDS = 60 * 60 // 1h — generous enough for a browsing session
const IMAGE_LIST_LIMIT = 60

export async function createGeneratedImage(data: {
  projectId: number | null
  prompt: string
  aspectRatio?: string | null
  mediaType: string
  storagePath: string
  fileSize: number
}) {
  const [row] = await db.insert(generatedImages).values({
    projectId: data.projectId ?? null,
    prompt: data.prompt,
    aspectRatio: data.aspectRatio ?? null,
    mediaType: data.mediaType,
    storagePath: data.storagePath,
    fileSize: data.fileSize,
  }).returning()
  return row ?? null
}

/**
 * List generated images, optionally filtered by project, newest-first.
 * - `projectId` = number → filter to that project
 * - `projectId` = null    → standalone images only (projectId IS NULL)
 * - `projectId` = undefined → all images (no filter)
 */
export async function getGeneratedImages(
  projectId?: number | null,
): Promise<import('@/types').GeneratedImageSummary[]> {
  const where =
    projectId === undefined
      ? undefined
      : projectId === null
        ? isNull(generatedImages.projectId)
        : eq(generatedImages.projectId, projectId)

  const rows = await db.select().from(generatedImages)
    .where(where)
    .orderBy(desc(generatedImages.createdAt))
    .limit(IMAGE_LIST_LIMIT)

  if (!isStorageConfigured()) {
    return rows.map(r => ({
      id: r.id, projectId: r.projectId, prompt: r.prompt, aspectRatio: r.aspectRatio,
      mediaType: r.mediaType, fileSize: r.fileSize, createdAt: r.createdAt, url: null,
    }))
  }

  const urlMap = await createSignedDownloadUrls(rows.map(r => r.storagePath), IMAGE_URL_TTL_SECONDS)
  return rows.map(r => ({
    id: r.id, projectId: r.projectId, prompt: r.prompt, aspectRatio: r.aspectRatio,
    mediaType: r.mediaType, fileSize: r.fileSize, createdAt: r.createdAt,
    url: urlMap.get(r.storagePath) ?? null,
  }))
}

export async function deleteGeneratedImage(id: number) {
  const [row] = await db.select({ storagePath: generatedImages.storagePath })
    .from(generatedImages)
    .where(eq(generatedImages.id, id))
  if (!row) return
  // Best-effort storage cleanup before row deletion so Storage and DB stay consistent.
  await removeObjects([row.storagePath]).catch(e =>
    console.warn('[deleteGeneratedImage] storage cleanup failed for:', row.storagePath, e instanceof Error ? e.message : e)
  )
  await db.delete(generatedImages).where(eq(generatedImages.id, id))
}
