import { NextRequest, NextResponse } from 'next/server'
import { getChatArtifacts, getArtifactById, deleteArtifact } from '@/app/actions'
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
    if (a?.storagePath) {
      await removeObjects([a.storagePath]).catch((e) => console.warn('[artifacts] cleanup failed:', e instanceof Error ? e.message : e))
    }
    await deleteArtifact(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return apiError(error, 'Failed to delete artifact', 500)
  }
}
