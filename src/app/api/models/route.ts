import { NextResponse } from 'next/server';
import { getGeminiApiKey, getAnthropicApiKey } from '@/lib/settings';

export async function GET() {
  const [anthropicApiKey, geminiApiKey] = await Promise.all([
    getAnthropicApiKey(),
    getGeminiApiKey(),
  ]);

  const models: { name: string; model: string; digest: string }[] = [];

  // Claude — primary chat models. Opus first → becomes the default for new
  // chats via the client's `data.models[0]` fallback.
  if (anthropicApiKey) {
    models.push(
      { name: 'Claude Opus 4.8', model: 'claude-opus-4-8', digest: 'claude-opus-4-8' },
      { name: 'Claude Sonnet 4.6', model: 'claude-sonnet-4-6', digest: 'claude-sonnet-4-6' },
      { name: 'Claude Haiku 4.5', model: 'claude-haiku-4-5', digest: 'claude-haiku-4-5' },
    );
  }

  // Gemini — image generation only (Nano Banana 2). Embeddings + utility tasks
  // use Gemini internally but are not user-selectable models.
  if (geminiApiKey) {
    models.push(
      { name: 'Nano Banana 2', model: 'gemini-3.1-flash-image', digest: 'gemini-3.1-flash-image' },
    );
  }

  return NextResponse.json({ models }, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
