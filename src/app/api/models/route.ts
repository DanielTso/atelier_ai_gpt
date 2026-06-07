import { NextResponse } from 'next/server';
import { getGeminiApiKey } from '@/lib/settings';

export async function GET() {
  const geminiApiKey = await getGeminiApiKey();

  // Only include models if a Gemini API key is configured.
  const models = geminiApiKey ? [
    { name: 'Gemini 3.5 Flash', model: 'gemini-3.5-flash', digest: 'gemini-3.5-flash' },
    { name: 'Gemini 3.1 Pro', model: 'gemini-3.1-pro-preview', digest: 'gemini-3.1-pro-preview' },
    // Deep Think — virtual model ID that routes to Pro with a high thinking level.
    { name: 'Gemini 3.1 Deep Think', model: 'gemini-3.1-pro-preview-deep-think', digest: 'gemini-3.1-pro-preview-deep-think' },
    { name: 'Gemini 3.1 Flash-Lite', model: 'gemini-3.1-flash-lite', digest: 'gemini-3.1-flash-lite' },
    // Nano Banana 2 — image generation only.
    { name: 'Nano Banana 2', model: 'gemini-3.1-flash-image', digest: 'gemini-3.1-flash-image' },
  ] : [];

  return NextResponse.json({ models }, {
    headers: {
      'Cache-Control': 'public, max-age=300',
    }
  });
}
