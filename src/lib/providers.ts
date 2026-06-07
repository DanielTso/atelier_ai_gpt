import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { getGeminiApiKey } from '@/lib/settings';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ProviderResult {
  model: any;
  tools?: Record<string, any>;
  providerOptions?: Record<string, Record<string, any>>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function createProvider(modelName: string): Promise<ProviderResult> {
  if (!modelName.startsWith('gemini')) {
    throw new Error(`Unknown model provider for model: ${modelName}. Only Gemini models are supported.`);
  }

  const isImageModel = modelName.includes('image');
  const isDeepThink = modelName.includes('deep-think');

  // Deep Think is a virtual model ID — route it to the real Pro model.
  const actualModelName = isDeepThink ? 'gemini-3.1-pro-preview' : modelName;

  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Google Gemini API Key is missing. Set it in Settings or .env.local.');
  }

  const google = createGoogleGenerativeAI({ apiKey });
  const model = google(actualModelName);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tools: Record<string, any> | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let providerOptions: Record<string, Record<string, any>> | undefined;

  if (isImageModel) {
    // Image models need TEXT+IMAGE response modalities, no search grounding.
    providerOptions = { google: { responseModalities: ['TEXT', 'IMAGE'] } };
  } else if (isDeepThink) {
    // Deep Think uses a high thinking level for extended reasoning, plus grounding.
    providerOptions = { google: { thinkingConfig: { thinkingLevel: 'high' } } };
    tools = { google_search: google.tools.googleSearch({}) };
  } else {
    // Enable Google Search grounding for all other Gemini text models.
    tools = { google_search: google.tools.googleSearch({}) };
  }

  return { model, tools, providerOptions };
}
