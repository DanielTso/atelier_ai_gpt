import { NextRequest, NextResponse } from 'next/server'
import { MAX_TEXT_LENGTH, getExtension, validateUploadedFile, extractTextFromBuffer } from '@/lib/fileExtraction'
import { apiError } from '@/lib/errors'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const validationError = validateUploadedFile(file.name, file.type, file.size)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const ext = getExtension(file.name)
    const buffer = Buffer.from(await file.arrayBuffer())
    let textContent = await extractTextFromBuffer(buffer, ext)

    const truncated = textContent.length > MAX_TEXT_LENGTH
    if (truncated) {
      textContent = textContent.slice(0, MAX_TEXT_LENGTH)
    }

    return NextResponse.json({
      filename: file.name,
      mimeType: file.type,
      textContent,
      charCount: textContent.length,
      truncated,
    })
  } catch (error) {
    return apiError(error, 'Failed to extract text from file', 500)
  }
}
