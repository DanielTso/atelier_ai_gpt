import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, testDb } from '../../helpers/test-db'
import { artifacts, messageEmbeddings, personaUsage, usageEvents } from '@/db/schema'

vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

import {
  createProject,
  createChat,
  createStandaloneChat,
  getChats,
  getStandaloneChats,
  getAllProjectChats,
  archiveChat,
  restoreChat,
  moveChatToProject,
  updateChatTitle,
  deleteChat,
  getArchivedChats,
  deleteProject,
  saveMessage,
  saveMessageEmbedding,
  createArtifact,
  recordPersonaUsage,
} from '@/app/actions'

describe('chat actions', () => {
  beforeEach(async () => {
    await createTestDb()
  })

  it('creates a chat in a project', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat 1')
    expect(chat).toMatchObject({ title: 'Chat 1', projectId: project.id })
  })

  it('creates a standalone chat (no project)', async () => {
    const [chat] = await createStandaloneChat('Standalone')
    expect(chat.title).toBe('Standalone')
    expect(chat.projectId).toBeNull()
  })

  it('getChats filters by project and excludes archived', async () => {
    const [project] = await createProject('P')
    const [chat1] = await createChat(project.id, 'Active')
    const [chat2] = await createChat(project.id, 'Archived')
    await archiveChat(chat2.id)

    const chats = await getChats(project.id)
    expect(chats).toHaveLength(1)
    expect(chats[0].title).toBe('Active')
  })

  it('getStandaloneChats returns only non-archived chats without project', async () => {
    await createStandaloneChat('Solo 1')
    const [solo2] = await createStandaloneChat('Solo 2')
    await archiveChat(solo2.id)

    const chats = await getStandaloneChats()
    expect(chats).toHaveLength(1)
    expect(chats[0].title).toBe('Solo 1')
  })

  it('getAllProjectChats returns non-archived chats with projectId', async () => {
    const [project] = await createProject('P')
    await createChat(project.id, 'Project Chat')
    await createStandaloneChat('Solo')

    const chats = await getAllProjectChats()
    expect(chats).toHaveLength(1)
    expect(chats[0].title).toBe('Project Chat')
  })

  it('archives and restores a chat', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')

    await archiveChat(chat.id)
    let archived = await getArchivedChats()
    expect(archived).toHaveLength(1)

    await restoreChat(chat.id)
    archived = await getArchivedChats()
    expect(archived).toHaveLength(0)
  })

  it('moves a chat to another project', async () => {
    const [p1] = await createProject('P1')
    const [p2] = await createProject('P2')
    const [chat] = await createChat(p1.id, 'Movable')

    const [moved] = await moveChatToProject(chat.id, p2.id)
    expect(moved.projectId).toBe(p2.id)
  })

  it('moves a chat to standalone (null project)', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Chat')
    const [moved] = await moveChatToProject(chat.id, null)
    expect(moved.projectId).toBeNull()
  })

  // Audit B2: the move must carry the chat's children, or deleting the old project
  // cascades them away (artifacts, embeddings, persona usage) and retrieval scopes
  // the moved history to the wrong project.
  describe("moving carries the chat's data", () => {
    async function seedChatWithChildren(projectId: number | null) {
      const [chat] = projectId == null
        ? await createStandaloneChat('Movable')
        : await createChat(projectId, 'Movable')
      const [msg] = await saveMessage(chat.id, 'user', 'hello')
      await saveMessageEmbedding(msg.id, chat.id, projectId, 'hello', new Array(768).fill(0.01))
      await createArtifact({ chatId: chat.id, projectId, type: 'pdf', title: 'Report', storagePath: 'artifacts/r.pdf' })
      await recordPersonaUsage({ chatId: chat.id, personaId: 'default', modelUsed: null })
      await testDb.insert(usageEvents).values({
        chatId: chat.id, projectId, purpose: 'chat', model: 'claude-opus-4-8', costUsd: 0.01,
      })
      return chat
    }

    async function childProjectIds(chatId: number) {
      const art = await testDb.select({ p: artifacts.projectId }).from(artifacts).where(eq(artifacts.chatId, chatId))
      const emb = await testDb.select({ p: messageEmbeddings.projectId }).from(messageEmbeddings).where(eq(messageEmbeddings.chatId, chatId))
      const per = await testDb.select({ p: personaUsage.projectId }).from(personaUsage).where(eq(personaUsage.chatId, chatId))
      const use = await testDb.select({ p: usageEvents.projectId }).from(usageEvents).where(eq(usageEvents.chatId, chatId))
      return { art: art.map(r => r.p), emb: emb.map(r => r.p), per: per.map(r => r.p), use: use.map(r => r.p) }
    }

    it('re-tags artifacts, embeddings, persona usage and usage events with the new project', async () => {
      const [a] = await createProject('A')
      const [b] = await createProject('B')
      const chat = await seedChatWithChildren(a.id)

      await moveChatToProject(chat.id, b.id)

      expect(await childProjectIds(chat.id)).toEqual({ art: [b.id], emb: [b.id], per: [b.id], use: [b.id] })
    })

    it('keeps the artifact and embeddings when the old project is then deleted', async () => {
      const [a] = await createProject('A')
      const [b] = await createProject('B')
      const chat = await seedChatWithChildren(a.id)

      await moveChatToProject(chat.id, b.id)
      await deleteProject(a.id)

      expect(await childProjectIds(chat.id)).toEqual({ art: [b.id], emb: [b.id], per: [b.id], use: [b.id] })
    })

    it("moves a standalone chat's data into a project, and back out to standalone", async () => {
      const [b] = await createProject('B')
      const chat = await seedChatWithChildren(null)

      await moveChatToProject(chat.id, b.id)
      expect(await childProjectIds(chat.id)).toEqual({ art: [b.id], emb: [b.id], per: [b.id], use: [b.id] })

      await moveChatToProject(chat.id, null)
      expect(await childProjectIds(chat.id)).toEqual({ art: [null], emb: [null], per: [null], use: [null] })
    })

    it("leaves other chats' data alone", async () => {
      const [a] = await createProject('A')
      const [b] = await createProject('B')
      const moved = await seedChatWithChildren(a.id)
      const stays = await seedChatWithChildren(a.id)

      await moveChatToProject(moved.id, b.id)

      expect(await childProjectIds(stays.id)).toEqual({ art: [a.id], emb: [a.id], per: [a.id], use: [a.id] })
    })
  })

  it("records persona usage under the chat's own project, never a caller-supplied one", async () => {
    const [p] = await createProject('P')
    const [chat] = await createChat(p.id, 'C')
    const [solo] = await createStandaloneChat('S')

    const [row] = await recordPersonaUsage({ chatId: chat.id, personaId: 'default', modelUsed: null })
    expect(row.projectId).toBe(p.id)
    const [soloRow] = await recordPersonaUsage({ chatId: solo.id, personaId: 'default', modelUsed: null })
    expect(soloRow.projectId).toBeNull()
  })

  it('updates chat title', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'Old')
    const [updated] = await updateChatTitle(chat.id, 'New')
    expect(updated.title).toBe('New')
  })

  it('deletes a chat', async () => {
    const [project] = await createProject('P')
    const [chat] = await createChat(project.id, 'To Delete')
    await deleteChat(chat.id)
    const chats = await getChats(project.id)
    expect(chats).toHaveLength(0)
  })
})
