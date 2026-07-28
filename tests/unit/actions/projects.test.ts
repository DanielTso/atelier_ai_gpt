import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

import {
  createProject,
  getProjects,
  deleteProject,
  updateProjectName,
} from '@/app/actions'

describe('project actions', () => {
  beforeEach(async () => {
    await createTestDb()
  })

  it('creates a project and returns it', async () => {
    const [project] = await createProject('My Project')
    expect(project).toMatchObject({ name: 'My Project' })
    expect(project.id).toBeDefined()
  })

  it('lists all projects', async () => {
    await createProject('A')
    await createProject('B')
    const projects = await getProjects()
    expect(projects).toHaveLength(2)
  })

  it('deletes a project', async () => {
    const [project] = await createProject('To Delete')
    await deleteProject(project.id)
    const projects = await getProjects()
    expect(projects).toHaveLength(0)
  })

  it('cascade-deletes chats when project is deleted', async () => {
    const { createChat, getChats } = await import('@/app/actions')
    const [project] = await createProject('With Chats')
    await createChat(project.id, 'Chat 1')
    await createChat(project.id, 'Chat 2')
    // Verify chats exist
    const chatsBefore = await getChats(project.id)
    expect(chatsBefore).toHaveLength(2)
    // Delete project
    await deleteProject(project.id)
    // Chats should be gone
    const chatsAfter = await getChats(project.id)
    expect(chatsAfter).toHaveLength(0)
  })

  it('updates project name', async () => {
    const [project] = await createProject('Old Name')
    const [updated] = await updateProjectName(project.id, 'New Name')
    expect(updated.name).toBe('New Name')
  })
})

describe('updateProjectDefaults - model validation', () => {
  beforeEach(async () => {
    vi.resetModules()
    await createTestDb()
  })

  // Stub the registry so the test never hits the network — resolveRequestedModel's
  // real implementation calls out to Anthropic when there's no cached registry.
  function mockRegistry(knownIds: string[]) {
    vi.doMock('@/lib/models/registry', () => ({
      resolveRequestedModel: async (requested?: string) => {
        if (!requested) return { modelId: 'claude-opus-4-8', usedFallback: false }
        if (knownIds.includes(requested)) return { modelId: requested, usedFallback: false }
        return { modelId: 'claude-opus-4-8', usedFallback: true }
      },
    }))
  }

  it('persists null when defaultModel is not recognized by the registry', async () => {
    mockRegistry(['claude-opus-4-8', 'claude-sonnet-5'])
    const { createProject, updateProjectDefaults, getProjectDefaults } = await import('@/app/actions')
    const [project] = await createProject('Bogus Default')
    await updateProjectDefaults(project.id, { defaultModel: 'claude-bogus-9' })
    const defaults = await getProjectDefaults(project.id)
    expect(defaults.defaultModel).toBeNull()
  })

  it('persists a valid defaultModel unchanged', async () => {
    mockRegistry(['claude-opus-4-8', 'claude-sonnet-5'])
    const { createProject, updateProjectDefaults, getProjectDefaults } = await import('@/app/actions')
    const [project] = await createProject('Valid Default')
    await updateProjectDefaults(project.id, { defaultModel: 'claude-sonnet-5' })
    const defaults = await getProjectDefaults(project.id)
    expect(defaults.defaultModel).toBe('claude-sonnet-5')
  })
})
