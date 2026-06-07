import { NextRequest, NextResponse } from 'next/server'
import { MAX_FILE_SIZE, MAX_TEXT_LENGTH, getExtension, isSupported, extractTextFromBuffer } from '@/lib/fileExtraction'
import { apiError } from '@/lib/errors'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.` },
        { status: 400 }
      )
    }

    if (!isSupported(file.name, file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.name}. Supported: PDF, Word (.docx), Excel (.xlsx), and text/code files.` },
        { status: 400 }
      )
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
    return apiError(error, 'Failed to extract text from file:', 500, true)
  }
}
