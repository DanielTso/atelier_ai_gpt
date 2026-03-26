import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { getGeminiApiKey, getDashScopeApiKey } from '@/lib/settings';

export const DASHSCOPE_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ProviderResult {
  model: any;
  tools?: Record<string, any>;
  providerOptions?: Record<string, Record<string, any>>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function createProvider(modelName: string): Promise<ProviderResult> {
  const isGeminiModel = modelName.startsWith('gemini');
  const isQwenModel = modelName.startsWith('qwen');
  const isImageModel = modelName.includes('image');
  const isDeepThink = modelName.includes('deep-think');
  // Generic thinking variant: any gemini model suffixed with -think-{minimal|low|medium|high}
  const thinkMatch = modelName.match(/^(.+)-think-(minimal|low|medium|high)$/);
  const thinkLevel = thinkMatch?.[2] ?? null;

  // Resolve virtual model IDs to their real counterparts
  const actualModelName = isDeepThink
    ? 'gemini-3.1-pro-preview'
    : thinkMatch
      ? thinkMatch[1] // base model name without the -think-{level} suffix
      : modelName;

  if (isGeminiModel) {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      throw new Error("Google Gemini API Key is missing. Set it in Settings or .env.local.");
    }
    const google = createGoogleGenerativeAI({ apiKey });
    const model = google(actualModelName);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tools: Record<string, any> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let providerOptions: Record<string, Record<string, any>> | undefined;

    if (isImageModel) {
      // Image models need TEXT+IMAGE response modalities, no search grounding
      providerOptions = { google: { responseModalities: ['TEXT', 'IMAGE'] } };
    } else if (isDeepThink) {
      // Deep Think uses high thinking level for extended reasoning
      providerOptions = { google: { thinkingConfig: { thinkingLevel: 'high' } } };
      tools = { google_search: google.tools.googleSearch({}) };
    } else if (thinkLevel) {
      // Generic thinking variant
      providerOptions = { google: { thinkingConfig: { thinkingLevel: thinkLevel } } };
      tools = { google_search: google.tools.googleSearch({}) };
    } else {
      // Enable Google Search grounding for non-image Gemini models
      tools = { google_search: google.tools.googleSearch({}) };
    }

    return { model, tools, providerOptions };
  } else if (isQwenModel) {
    const apiKey = await getDashScopeApiKey();
    if (!apiKey) {
      throw new Error("DashScope API Key is missing. Set it in Settings or .env.local.");
    }
    const dashscope = createOpenAI({
      baseURL: DASHSCOPE_BASE_URL,
      apiKey,
    });
    return { model: dashscope.chat(modelName) };
  } else {
    throw new Error(`Unknown model provider for model: ${modelName}. Only Gemini and Qwen models are supported.`);
  }
}
