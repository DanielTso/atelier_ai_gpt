import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { getGeminiApiKey } from '@/lib/settings';
import { saveChatTopics, getChatTopics } from '@/app/actions';
import { apiError } from '@/lib/errors';
import { classifyRequestSchema } from '@/lib/validation';

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
    const { chatId, messages, model } = body.data;

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
      .map((m: { role: string; content?: string; parts?: { type: string; text?: string }[] }) => {
        const text = m.parts
          ? m.parts.filter(p => p.type === 'text').map(p => p.text).join('')
          : m.content || '';
        return `${m.role}: ${text}`;
      })
      .join('\n');

    // Use Gemini for classification
    const modelName = model || 'gemini-3.5-flash';
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'No API key available' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const google = createGoogleGenerativeAI({ apiKey });
    const selectedModel = google(modelName.startsWith('gemini') ? modelName : 'gemini-3.5-flash');

    const result = await generateText({
      model: selectedModel,
      prompt: CLASSIFICATION_PROMPT + conversationText,
      maxOutputTokens: 200,
    });

    // Parse the LLM's JSON response
    let topics: { topic: string; confidence: number }[] = [];
    try {
      const jsonMatch = result.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        topics = JSON.parse(jsonMatch[0]);
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
