import { NextRequest, NextResponse } from 'next/server'
import { getChatArtifacts, getArtifactById, getArtifactVersionPaths, deleteArtifact } from '@/app/actions'
import { removeObjects } from '@/lib/storage'
import { apiError } from '@/lib/errors'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const chatId = Number(searchParams.get('chatId'))
    if (!chatId || isNaN(chatId)) return NextResponse.json({ error: 'Invalid chatId' }, { status: 400 })
    return NextResponse.json({ artifacts: await getChatArtifacts(chatId) })
  } catch (error) {
    return apiError(error, 'Failed to load artifacts', 500)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = Number(searchParams.get('id'))
    if (!id || isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    const a = await getArtifactById(id)
    // Sweep the current file AND every superseded version's file. The version rows
    // cascade-delete with the artifact, so their Storage objects would otherwise be
    // orphaned untraceably (mirrors the documents revision sweep).
    const versionPaths = await getArtifactVersionPaths(id)
    const paths = [...new Set([a?.storagePath, ...versionPaths].filter((p): p is string => Boolean(p)))]
    if (paths.length > 0) {
      await removeObjects(paths).catch((e) => console.warn('[artifacts] cleanup failed:', e instanceof Error ? e.message : e))
    }
    await deleteArtifact(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return apiError(error, 'Failed to delete artifact', 500)
  }
}
