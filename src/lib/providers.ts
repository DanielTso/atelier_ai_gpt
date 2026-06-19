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

export type Effort = 'low' | 'medium' | 'high' | 'max';

export async function createProvider(modelName: string, effort?: Effort): Promise<ProviderResult> {
  // Claude (Anthropic) — the primary chat brain. Web search enabled. Adaptive
  // thinking is on for all Claude models; `effort` (low|medium|high|max) is
  // applied via providerOptions — EXCEPT on Haiku, which 400s on the effort param.
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anthropicOptions: Record<string, any> = { thinking: { type: 'adaptive' } };
    if (effort && !modelName.startsWith('claude-haiku')) {
      anthropicOptions.effort = effort;
    }
    return { model, tools, providerOptions: { anthropic: anthropicOptions } };
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
