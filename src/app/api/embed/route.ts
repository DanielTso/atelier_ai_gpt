import { embedAndStore, ensureEmbeddingModel } from '@/lib/embeddings';
import { getChatWithContext, getEmbeddingCount } from '@/app/actions';
import { apiError } from '@/lib/errors';
import { embedRequestSchema } from '@/lib/validation';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const chatId = url.searchParams.get('chatId');
    const projectId = url.searchParams.get('projectId');

    const { available, provider } = await ensureEmbeddingModel();

    // Validate ids before use (the POST path uses a Zod schema; mirror that here so a
    // malformed `?projectId=abc` → NaN can't silently produce a wrong/zero count).
    const scope: { chatId?: number; projectId?: number } = {};
    const pid = Number(projectId);
    const cid = Number(chatId);
    if (projectId && Number.isInteger(pid) && pid > 0) scope.projectId = pid;
    else if (chatId && Number.isInteger(cid) && cid > 0) scope.chatId = cid;

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
    const body = embedRequestSchema.safeParse(await req.json());
    if (!body.success) {
      return apiError(body.error, 'Invalid request body', 400);
    }
    // A body `projectId` is accepted but ignored: the embedding is filed under the
    // chat's DB project. The client's nav project can be stale, and project-scoped
    // retrieval would then surface this message in the wrong project (audit U3).
    const { messageId, chatId, content } = body.data;

    const chat = await getChatWithContext(chatId);
    if (!chat) {
      return new Response(JSON.stringify({ error: 'Chat not found' }), {
        status: 404,
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

    await embedAndStore(messageId, chatId, chat.projectId ?? null, content);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return apiError(error, 'Embedding failed', 200);
  }
}
