import { NextRequest, NextResponse } from 'next/server'
import { isTavilyConfigured, mapSite } from '@/lib/tavily'
import { webMapRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'

export async function POST(request: NextRequest) {
  try {
    const parsed = webMapRequestSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    if (!(await isTavilyConfigured())) return NextResponse.json({ urls: [], configured: false })
    const urls = await mapSite(parsed.data.url, { maxDepth: parsed.data.maxDepth, limit: parsed.data.limit })
    return NextResponse.json({ urls, configured: true })
  } catch (error) {
    return apiError(error, 'Failed to map site', 502)
  }
}
