import { NextRequest, NextResponse } from 'next/server'
import { createDocument, updateDocumentStatus, saveDocumentChunks, updateChunkEmbedding, getProjectDocuments, deleteDocument } from '@/app/actions'
import { generateEmbedding, ensureEmbeddingModel } from '@/lib/embeddings'
import { chunkText } from '@/lib/chunking'
import { MAX_FILE_SIZE, MAX_TEXT_LENGTH, getExtension, isSupported, extractTextFromBuffer } from '@/lib/fileExtraction'
import { apiError } from '@/lib/errors'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const projectId = Number(formData.get('projectId'))

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (!projectId || isNaN(projectId)) {
      return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.` },
        { status: 400 }
      )
    }
    if (!isSupported(file.name, file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.name}. Supported: PDF, DOCX, and text/code files.` },
        { status: 400 }
      )
    }

    // Check embedding availability upfront
    const { available } = await ensureEmbeddingModel()
    if (!available) {
      return NextResponse.json(
        { error: 'No embedding provider available. Set a Gemini API key in Settings or .env.local.' },
        { status: 503 }
      )
    }

    // Extract text from file
    const ext = getExtension(file.name)
    const buffer = Buffer.from(await file.arrayBuffer())
    let textContent = await extractTextFromBuffer(buffer, ext)

    if (textContent.length > MAX_TEXT_LENGTH) {
      textContent = textContent.slice(0, MAX_TEXT_LENGTH)
    }

    if (!textContent.trim()) {
      return NextResponse.json({ error: 'No text content could be extracted from the file.' }, { status: 400 })
    }

    // Create document record
    const [doc] = await createDocument({
      projectId,
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileSize: file.size,
      charCount: textContent.length,
    })

    try {
      // Chunk text
      const textChunks = chunkText(textContent)

      // Save chunks to DB
      const savedChunks = await saveDocumentChunks(
        textChunks.map(c => ({
          documentId: doc.id,
          projectId,
          chunkIndex: c.index,
          content: c.content,
        }))
      )

      // Generate and store embeddings for each chunk (parallelized)
      const embeddingResults = await Promise.allSettled(
        savedChunks.map(async (chunk) => {
          const embedding = await generateEmbedding(chunk.content, 'document')
          await updateChunkEmbedding(chunk.id, embedding)
        })
      )

      const embeddedCount = embeddingResults.filter(r => r.status === 'fulfilled').length
      const failedCount = embeddingResults.filter(r => r.status === 'rejected').length
      if (failedCount > 0) {
        console.warn(`[Documents] ${failedCount}/${savedChunks.length} chunks failed to embed`)
      }

      const status = embeddedCount === 0 && savedChunks.length > 0 ? 'error' : 'ready'
      await updateDocumentStatus(doc.id, status, { chunkCount: savedChunks.length })

      // Return the updated document
      return NextResponse.json({
        ...doc,
        status,
        chunkCount: savedChunks.length,
        embeddedCount,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Processing failed'
      await updateDocumentStatus(doc.id, 'error', { errorMessage: message })
      return NextResponse.json({ error: `Document processing failed: ${message}` }, { status: 500 })
    }
  } catch (error) {
    // Surface the real reason (e.g. body too large, encrypted PDF) so uploads
    // aren't a generic black-box failure. These are the user's own documents.
    return apiError(error, 'Failed to process document:', 500, true)
  }
}

export async function GET(request: NextRequest) {
  const projectId = Number(request.nextUrl.searchParams.get('projectId'))
  if (!projectId || isNaN(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 })
  }

  const docs = await getProjectDocuments(projectId)
  return NextResponse.json({ documents: docs })
}

export async function DELETE(request: NextRequest) {
  const id = Number(request.nextUrl.searchParams.get('id'))
  if (!id || isNaN(id)) {
    return NextResponse.json({ error: 'Invalid document id' }, { status: 400 })
  }

  await deleteDocument(id)
  return NextResponse.json({ success: true })
}
