import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getGeminiApiKey, getAnthropicApiKey } from '@/lib/settings';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ProviderResult {
  model: any;
  tools?: Record<string, any>;
  providerOptions?: Record<string, Record<string, any>>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function createProvider(modelName: string): Promise<ProviderResult> {
  // Claude (Anthropic) — the primary chat brain. Web search enabled; no
  // explicit thinking config (Opus 4.8 rejects budget_tokens; adaptive thinking
  // is a deferred follow-up).
  if (modelName.startsWith('claude')) {
    const apiKey = await getAnthropicApiKey();
    if (!apiKey) {
      throw new Error('Anthropic API Key is missing. Set it in Settings or .env.local.');
    }
    const anthropic = createAnthropic({ apiKey });
    const model = anthropic(modelName);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, any> = {
      web_search: anthropic.tools.webSearch_20250305({ maxUses: 5 }),
    };
    return { model, tools };
  }

  // Gemini — image generation (Nano Banana) + internal utility/embedding text.
  if (modelName.startsWith('gemini')) {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      throw new Error('Google Gemini API Key is missing. Set it in Settings or .env.local.');
    }
    const google = createGoogleGenerativeAI({ apiKey });
    const model = google(modelName);

    if (modelName.includes('image')) {
      // Image models need TEXT+IMAGE response modalities, no search grounding.
      return { model, providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } } };
    }

    // Internal Gemini text (title/summarize utility): Google Search grounding.
    return { model, tools: { google_search: google.tools.googleSearch({}) } };
  }

  throw new Error(
    `Unknown model provider for model: ${modelName}. Supported: Claude (claude-*) and Gemini (gemini-*).`
  );
}
