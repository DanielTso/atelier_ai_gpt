import { describe, it, expect } from 'vitest'
import {
  findChatById,
  isStaleChatId,
  moveRestoredChat,
  moveChatInLists,
  removeProjectChats,
  type ChatLists,
  type LoadedFlags,
} from '@/lib/chatLookup'

type C = { id: number; projectId: number | null; archived?: boolean }

const p1: C = { id: 1, projectId: 5 }
const s1: C = { id: 2, projectId: null }
const a1: C = { id: 9, projectId: 5, archived: true }

const lists: ChatLists<C> = { chats: [p1], standaloneChats: [s1], archivedChats: [a1] }
const allLoaded: LoadedFlags = { chats: true, standalone: true, archived: true }
const empty: ChatLists<C> = { chats: [], standaloneChats: [], archivedChats: [] }

describe('findChatById', () => {
  it('finds an id that is only in archivedChats', () => {
    expect(findChatById(9, lists)).toBe(a1)
  })

  it('searches chats, then standalone, then archived', () => {
    expect(findChatById(1, lists)).toBe(p1)
    expect(findChatById(2, lists)).toBe(s1)
  })

  it('returns undefined for null and for an absent id', () => {
    expect(findChatById(null, lists)).toBeUndefined()
    expect(findChatById(404, lists)).toBeUndefined()
  })
})

describe('isStaleChatId', () => {
  it('is never stale while the archived list has not loaded', () => {
    expect(isStaleChatId(404, lists, { ...allLoaded, archived: false })).toBe(false)
  })

  it('is stale when every list has loaded and the id is in none of them', () => {
    expect(isStaleChatId(404, lists, allLoaded)).toBe(true)
  })

  it('is not stale when the id is only in archivedChats', () => {
    expect(isStaleChatId(9, lists, allLoaded)).toBe(false)
  })

  it('is not stale when nothing has loaded into any list', () => {
    expect(isStaleChatId(9, empty, allLoaded)).toBe(false)
  })

  it('waits for the project-chat list even when standalone and archived have loaded (U2)', () => {
    expect(
      isStaleChatId(
        12,
        { chats: [], standaloneChats: [s1], archivedChats: [] },
        { chats: false, standalone: true, archived: true },
      ),
    ).toBe(false)
  })

  it('waits for the standalone list too', () => {
    expect(isStaleChatId(404, lists, { ...allLoaded, standalone: false })).toBe(false)
  })
})

describe('moveRestoredChat', () => {
  it('moves a project chat from archived to the front of chats', () => {
    const l: ChatLists<C> = { chats: [p1], standaloneChats: [s1], archivedChats: [{ id: 7, projectId: 5, archived: true }] }
    const next = moveRestoredChat(l, 7)
    expect(next.archivedChats.some(c => c.id === 7)).toBe(false)
    expect(next.chats[0].id).toBe(7)
    expect(next.chats[0].archived).toBe(false)
    expect(next.standaloneChats.some(c => c.id === 7)).toBe(false)
  })

  it('moves a standalone chat to the front of standaloneChats', () => {
    const l: ChatLists<C> = { chats: [p1], standaloneChats: [s1], archivedChats: [{ id: 8, projectId: null }] }
    const next = moveRestoredChat(l, 8)
    expect(next.standaloneChats[0].id).toBe(8)
    expect(next.chats.some(c => c.id === 8)).toBe(false)
    expect(next.archivedChats).toHaveLength(0)
  })

  it('does not add an archived field to objects that have none', () => {
    const l: ChatLists<C> = { chats: [], standaloneChats: [], archivedChats: [{ id: 8, projectId: null }] }
    expect('archived' in moveRestoredChat(l, 8).standaloneChats[0]).toBe(false)
  })

  it('returns the identical lists object for an id not in archivedChats', () => {
    expect(moveRestoredChat(lists, 1)).toBe(lists)
  })

  it('never duplicates an id already in the destination', () => {
    const l: ChatLists<C> = {
      chats: [{ id: 7, projectId: 5 }, p1],
      standaloneChats: [],
      archivedChats: [{ id: 7, projectId: 5, archived: true }],
    }
    const next = moveRestoredChat(l, 7)
    expect(next.chats.filter(c => c.id === 7)).toHaveLength(1)
    expect(next.archivedChats).toHaveLength(0)
  })
})

describe('removeProjectChats (U14)', () => {
  it("drops a deleted project's chats from chats and archivedChats", () => {
    const l: ChatLists<C> = {
      chats: [p1, { id: 3, projectId: 6 }],
      standaloneChats: [s1],
      archivedChats: [a1, { id: 10, projectId: 6, archived: true }],
    }
    const next = removeProjectChats(l, 5)
    expect(next.chats.map(c => c.id)).toEqual([3])
    expect(next.archivedChats.map(c => c.id)).toEqual([10])
    expect(next.standaloneChats).toBe(l.standaloneChats)
  })

  it('returns the identical lists object when the project owns no chats', () => {
    expect(removeProjectChats(lists, 404)).toBe(lists)
  })
})

describe('moveChatInLists (handleMoveChat race)', () => {
  it('moves a quick chat to the front of chats under its new project, in one step', () => {
    const next = moveChatInLists(lists, 2, 5)
    expect(next.standaloneChats.map(c => c.id)).toEqual([])
    expect(next.chats).toEqual([{ id: 2, projectId: 5 }, p1])
    expect(next.archivedChats).toBe(lists.archivedChats)
  })

  it('moves a project chat to quick chats when the target is null', () => {
    const next = moveChatInLists(lists, 1, null)
    expect(next.chats).toEqual([])
    expect(next.standaloneChats).toEqual([{ id: 1, projectId: null }, s1])
  })

  it('re-files a project chat under another project without leaving chats', () => {
    const next = moveChatInLists(lists, 1, 6)
    expect(next.chats).toEqual([{ id: 1, projectId: 6 }])
    expect(next.standaloneChats).toBe(lists.standaloneChats)
  })

  it('updates an archived chat in place (it stays archived)', () => {
    const next = moveChatInLists(lists, 9, null)
    expect(next.archivedChats).toEqual([{ id: 9, projectId: null, archived: true }])
    expect(next.chats).toBe(lists.chats)
    expect(next.standaloneChats).toBe(lists.standaloneChats)
  })

  it('returns the identical lists object for an unknown id', () => {
    expect(moveChatInLists(lists, 404, 5)).toBe(lists)
  })
})
