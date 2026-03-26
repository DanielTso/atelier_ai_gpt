import { embedAndStore, ensureEmbeddingModel } from '@/lib/embeddings';
import { getEmbeddingCount } from '@/app/actions';
import { apiError } from '@/lib/errors';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const chatId = url.searchParams.get('chatId');
    const projectId = url.searchParams.get('projectId');

    const { available, provider } = await ensureEmbeddingModel();

    const scope: { chatId?: number; projectId?: number } = {};
    if (projectId) scope.projectId = Number(projectId);
    else if (chatId) scope.chatId = Number(chatId);

    const embeddingCount = await getEmbeddingCount(scope);

    return new Response(JSON.stringify({
      available,
      provider,
      embeddingCount,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ available: false, provider: null, embeddingCount: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function POST(req: Request) {
  try {
    const { messageId, chatId, projectId, content } = await req.json();

    if (!messageId || !chatId || !content) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if any embedding provider is available
    const { available } = await ensureEmbeddingModel();
    if (!available) {
      return new Response(JSON.stringify({ success: false, reason: 'Embedding model not available' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await embedAndStore(messageId, chatId, projectId ?? null, content);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return apiError(error, 'Embedding failed', 200);
  }
}
