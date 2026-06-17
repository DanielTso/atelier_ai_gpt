'use server'

import { db } from '@/db'
import { projects, chats, messages, settings, messageEmbeddings, personaUsage, chatTopics, documents, documentChunks, messageAttachments, artifacts } from '@/db/schema'
import { eq, desc, isNull, isNotNull, and, lte, asc, count, inArray, sql } from 'drizzle-orm'
import { isStorageConfigured, uploadBuffer, createSignedDownloadUrl, removeObjects } from '@/lib/storage'

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

const SENSITIVE_KEYS = new Set(['gemini-api-key', 'anthropic-api-key'])

export async function getProjects() {
  return await db.select().from(projects)
}

export async function createProject(name: string) {
  return await db.insert(projects).values({ name }).returning()
}

export async function deleteProject(id: number) {
  await db.delete(projects).where(eq(projects.id, id))
}

export async function updateProjectName(id: number, name: string) {
  return await db.update(projects).set({ name }).where(eq(projects.id, id)).returning()
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
  const allFirstMessages = await db.select({
    chatId: messages.chatId,
    content: messages.content,
  }).from(messages)
    .where(and(
      inArray(messages.chatId, chatIds),
      eq(messages.role, 'user')
    ))
    .orderBy(asc(messages.createdAt))

  // Keep only the first message per chat
  const firstMsgMap = new Map<number, string>()
  for (const msg of allFirstMessages) {
    if (!firstMsgMap.has(msg.chatId)) {
      firstMsgMap.set(msg.chatId, msg.content)
    }
  }

  return projectChats.map(chat => ({
    id: chat.id,
    title: chat.title,
    preview: firstMsgMap.get(chat.id)?.substring(0, 120) ?? null,
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
  return await db.insert(chats).values({ projectId, title }).returning()
}

export async function createStandaloneChat(title: string) {
  return await db.insert(chats).values({ projectId: null, title }).returning()
}

export async function deleteChat(id: number) {
  await removeAttachmentObjects(eq(messageAttachments.chatId, id))
  await db.delete(chats).where(eq(chats.id, id))
}

export async function updateChatTitle(id: number, title: string) {
  return await db.update(chats).set({ title }).where(eq(chats.id, id)).returning()
}

export async function saveMessage(chatId: number, role: string, content: string) {
  return await db.insert(messages).values({ chatId, role, content }).returning()
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

// Alias for backward compatibility
export async function getChatWithSummary(chatId: number) {
  return getChatWithContext(chatId)
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

export async function getMessagesForSummarization(chatId: number, upToMessageId: number) {
  // Get messages up to (and including) the specified message ID for summarization
  // These are the older messages that will be compressed into a summary
  return await db.select()
    .from(messages)
    .where(and(
      eq(messages.chatId, chatId),
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

export async function getEmbeddingsForChat(chatId: number) {
  return await db.select().from(messageEmbeddings)
    .where(eq(messageEmbeddings.chatId, chatId))
}

export async function getEmbeddingsForProject(projectId: number) {
  return await db.select().from(messageEmbeddings)
    .where(eq(messageEmbeddings.projectId, projectId))
}

export async function getAllEmbeddings() {
  return await db.select().from(messageEmbeddings)
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
  // Get existing usage record for this chat
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
  return await db.insert(documents).values({
    projectId: data.projectId,
    filename: data.filename,
    mimeType: data.mimeType,
    fileSize: data.fileSize,
    charCount: 0,
    status: 'uploading',
  }).returning()
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
    .set({ status, ...updates })
    .where(eq(documents.id, id))
    .returning()
}

export async function getProjectDocuments(projectId: number) {
  return await db.select().from(documents)
    .where(eq(documents.projectId, projectId))
    .orderBy(desc(documents.createdAt))
}

export async function deleteDocument(id: number) {
  return await db.delete(documents).where(eq(documents.id, id)).returning()
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

export async function getChatAttachments(chatId: number) {
  const rows = await db.select().from(messageAttachments).where(eq(messageAttachments.chatId, chatId))
  return await Promise.all(rows.map(async (r) => {
    let url = r.dataUrl ?? ''
    if (r.storagePath) {
      url = await createSignedDownloadUrl(r.storagePath, ATTACHMENT_URL_TTL_SECONDS).catch(() => '')
    }
    return { messageId: r.messageId, mediaType: r.mediaType, filename: r.filename, url }
  }))
}

export async function getApiKeyStatus(): Promise<{ gemini: boolean; anthropic: boolean }> {
  const { getGeminiApiKey, getAnthropicApiKey } = await import('@/lib/settings')
  const [gemini, anthropic] = await Promise.all([getGeminiApiKey(), getAnthropicApiKey()])
  return { gemini: Boolean(gemini), anthropic: Boolean(anthropic) }
}

// ── Artifact Actions ──

export async function createArtifact(data: {
  chatId: number; projectId: number | null; type: string; title: string; storagePath: string; status?: string; errorMessage?: string
}) {
  return await db.insert(artifacts).values({
    chatId: data.chatId, projectId: data.projectId ?? null, type: data.type, title: data.title,
    storagePath: data.storagePath, status: data.status ?? 'ready', errorMessage: data.errorMessage ?? null,
  }).returning()
}

export async function getArtifactById(id: number) {
  const [a] = await db.select().from(artifacts).where(eq(artifacts.id, id))
  return a ?? null
}

export async function getChatArtifacts(chatId: number) {
  const rows = await db.select().from(artifacts).where(eq(artifacts.chatId, chatId)).orderBy(asc(artifacts.createdAt))
  return await Promise.all(rows.map(async (r) => ({
    id: r.id, chatId: r.chatId, type: r.type, title: r.title, status: r.status, createdAt: r.createdAt,
    downloadUrl: r.storagePath ? await createSignedDownloadUrl(r.storagePath).catch(() => null) : null,
  })))
}

export async function deleteArtifact(id: number) {
  return await db.delete(artifacts).where(eq(artifacts.id, id)).returning()
}

export async function updateArtifactStoragePath(id: number, storagePath: string) {
  return await db.update(artifacts).set({ storagePath }).where(eq(artifacts.id, id)).returning()
}
