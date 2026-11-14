// Pure lookups over page.tsx's three chat lists (project chats, quick chats,
// archived chats). No React: page.tsx owns the state, this module owns the rules
// for "which chat is this", "is this id a dead deep link" and "where does a
// restored chat go", so the load-order races are unit-testable.

export interface ChatRef {
  id: number
  projectId: number | null
}

export type ChatLists<C extends ChatRef> = {
  chats: C[]
  standaloneChats: C[]
  archivedChats: C[]
}

/** Which of the three lists have finished their first load (success OR failure). */
export type LoadedFlags = { chats: boolean; standalone: boolean; archived: boolean }

/** Searches chats → standaloneChats → archivedChats. `null` → `undefined`. */
export function findChatById<C extends ChatRef>(id: number | null, lists: ChatLists<C>): C | undefined {
  if (id == null) return undefined
  return (
    lists.chats.find(c => c.id === id) ??
    lists.standaloneChats.find(c => c.id === id) ??
    lists.archivedChats.find(c => c.id === id)
  )
}

/** True only when all three lists have loaded, at least one of them is non-empty,
 * and `id` is in none of them. The lists load through Next's serialized
 * server-action queue one round-trip apart, so judging an id against a partial
 * set (e.g. quick chats only) would clear a valid project-chat deep link (U2).
 * All-empty stays "not stale": the loads may all have failed. */
export function isStaleChatId<C extends ChatRef>(id: number, lists: ChatLists<C>, loaded: LoadedFlags): boolean {
  if (!loaded.chats || !loaded.standalone || !loaded.archived) return false
  if (lists.chats.length === 0 && lists.standaloneChats.length === 0 && lists.archivedChats.length === 0) return false
  return findChatById(id, lists) === undefined
}

/** Optimistically moves a just-restored chat out of archivedChats and to the front
 * of its destination list (quick chats when `projectId` is null, else project
 * chats), so it is never absent from all three lists while the reloads land.
 * Returns `lists` itself when `chatId` is not archived; never duplicates an id. */
export function moveRestoredChat<C extends ChatRef>(lists: ChatLists<C>, chatId: number): ChatLists<C> {
  const chat = lists.archivedChats.find(c => c.id === chatId)
  if (!chat) return lists
  const restored = ('archived' in chat ? { ...chat, archived: false } : chat) as C
  const archivedChats = lists.archivedChats.filter(c => c.id !== chatId)
  const prepend = (list: C[]) => [restored, ...list.filter(c => c.id !== chatId)]
  return chat.projectId == null
    ? { chats: lists.chats, standaloneChats: prepend(lists.standaloneChats), archivedChats }
    : { chats: prepend(lists.chats), standaloneChats: lists.standaloneChats, archivedChats }
}

/** Drops a deleted project's chats (the DB cascades them) from the project-chat and
 * archived lists so the palette and the deep-link validator stop seeing them (U14).
 * Returns `lists` itself when the project owned none. */
export function removeProjectChats<C extends ChatRef>(lists: ChatLists<C>, projectId: number): ChatLists<C> {
  const owned = (c: C) => c.projectId === projectId
  if (!lists.chats.some(owned) && !lists.archivedChats.some(owned)) return lists
  return {
    chats: lists.chats.filter(c => !owned(c)),
    standaloneChats: lists.standaloneChats,
    archivedChats: lists.archivedChats.filter(c => !owned(c)),
  }
}
