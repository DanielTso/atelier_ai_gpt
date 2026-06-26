import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { z } from 'zod';
import { getGeminiApiKey } from '@/lib/settings';
import { saveChatTopics, getChatTopics } from '@/app/actions';
import { apiError } from '@/lib/errors';
import { classifyRequestSchema } from '@/lib/validation';
import { messageText } from '@/lib/messageParts';

// The model is instructed to return this shape; validate it before persisting so
// malformed output (prose, wrong types) can't write garbage rows to chat_topics.
const topicsSchema = z.array(z.object({ topic: z.string().min(1), confidence: z.number() }));

const CLASSIFICATION_PROMPT = `Classify the following conversation into one or more topics. Return ONLY a JSON array of objects with "topic" and "confidence" (0-100) fields.

Topics to choose from:
- coding (programming, software development)
- debugging (fixing bugs, errors, troubleshooting)
- creative (creative writing, storytelling, poetry)
- learning (explanations, tutorials, education)
- brief (requests for concise answers)
- analysis (complex reasoning, problem solving)
- general (doesn't fit other categories)

Example output:
[{"topic": "coding", "confidence": 85}, {"topic": "debugging", "confidence": 60}]

Conversation:
`;

export async function POST(req: Request) {
  try {
    const body = classifyRequestSchema.safeParse(await req.json());
    if (!body.success) {
      return apiError(body.error, 'Invalid request body', 400);
    }
    const { chatId, messages } = body.data;

    // Check if already classified
    const existing = await getChatTopics(chatId);
    if (existing.length > 0) {
      return new Response(JSON.stringify({ topics: existing, cached: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build conversation text for classification
    const conversationText = messages
      .slice(0, 10) // Only use first 10 messages for efficiency
      .map((m) => `${m.role}: ${messageText(m)}`)
      .join('\n');

    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'No API key available' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const google = createGoogleGenerativeAI({ apiKey });
    // Classification is housekeeping — always pin to internal Flash, never the body's
    // model (which may be a Claude or the Nano Banana image model). The previous
    // `startsWith('gemini')` guard let the image model through, defeating the pin.
    // Mirrors summarize/generate-title.
    const selectedModel = google('gemini-3.5-flash');

    const result = await generateText({
      model: selectedModel,
      prompt: CLASSIFICATION_PROMPT + conversationText,
      maxOutputTokens: 200,
    });

    // Parse + validate the LLM's JSON response (shape-checked before any DB write).
    let topics: { topic: string; confidence: number }[] = [];
    try {
      const jsonMatch = result.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = topicsSchema.safeParse(JSON.parse(jsonMatch[0]));
        if (parsed.success) topics = parsed.data;
        else console.error('[Classify] LLM output failed shape validation:', result.text);
      }
    } catch {
      console.error('[Classify] Failed to parse LLM response:', result.text);
    }

    // Save to DB (cached for future lookups)
    if (topics.length > 0) {
      await saveChatTopics(chatId, topics);
    }

    return new Response(JSON.stringify({ topics, cached: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return apiError(error, 'Classification failed', 200);
  }
}
