import { NextResponse } from 'next/server';
import { getGeminiApiKey, getDashScopeApiKey } from '@/lib/settings';

export async function GET() {
  const [geminiApiKey, dashScopeApiKey] = await Promise.all([
    getGeminiApiKey(),
    getDashScopeApiKey(),
  ]);

  // Only include Gemini models if an API key is configured
  const geminiModels = geminiApiKey ? [
    // Gemini 3 Flash — supports MINIMAL / LOW / MEDIUM / HIGH thinking
    { name: 'Gemini 3 Flash', model: 'gemini-3-flash-preview', digest: 'gemini-3-flash-preview' },
    { name: 'Flash Think (Minimal)', model: 'gemini-3-flash-preview-think-minimal', digest: 'gemini-3-flash-preview-think-minimal' },
    { name: 'Flash Think (Low)', model: 'gemini-3-flash-preview-think-low', digest: 'gemini-3-flash-preview-think-low' },
    { name: 'Flash Think (Medium)', model: 'gemini-3-flash-preview-think-medium', digest: 'gemini-3-flash-preview-think-medium' },
    { name: 'Flash Think (High)', model: 'gemini-3-flash-preview-think-high', digest: 'gemini-3-flash-preview-think-high' },
    // Gemini 3.1 Pro — supports LOW / MEDIUM / HIGH thinking (HIGH = Deep Think)
    { name: 'Gemini 3.1 Pro', model: 'gemini-3.1-pro-preview', digest: 'gemini-3.1-pro-preview' },
    { name: 'Pro Think (Low)', model: 'gemini-3.1-pro-preview-think-low', digest: 'gemini-3.1-pro-preview-think-low' },
    { name: 'Pro Think (Medium)', model: 'gemini-3.1-pro-preview-think-medium', digest: 'gemini-3.1-pro-preview-think-medium' },
    { name: 'Gemini 3.1 Deep Think', model: 'gemini-3.1-pro-preview-deep-think', digest: 'gemini-3.1-pro-preview-deep-think' },
    // Gemini 3.1 Flash-Lite — supports MINIMAL / LOW / MEDIUM / HIGH thinking
    { name: 'Gemini 3.1 Flash-Lite', model: 'gemini-3.1-flash-lite-preview', digest: 'gemini-3.1-flash-lite-preview' },
    { name: 'Flash-Lite Think (Minimal)', model: 'gemini-3.1-flash-lite-preview-think-minimal', digest: 'gemini-3.1-flash-lite-preview-think-minimal' },
    { name: 'Flash-Lite Think (Low)', model: 'gemini-3.1-flash-lite-preview-think-low', digest: 'gemini-3.1-flash-lite-preview-think-low' },
    { name: 'Flash-Lite Think (Medium)', model: 'gemini-3.1-flash-lite-preview-think-medium', digest: 'gemini-3.1-flash-lite-preview-think-medium' },
    { name: 'Flash-Lite Think (High)', model: 'gemini-3.1-flash-lite-preview-think-high', digest: 'gemini-3.1-flash-lite-preview-think-high' },
    // Nano Banana 2 — image generation only, no thinking
    { name: 'Nano Banana 2', model: 'gemini-3.1-flash-image-preview', digest: 'gemini-3.1-flash-image-preview' },
  ] : [];

  // Curated Qwen flagship models (DashScope Singapore)
  const qwenModels = dashScopeApiKey ? [
    { name: 'Qwen3.5 Plus', model: 'qwen3.5-plus', digest: 'qwen3.5-plus' },
    { name: 'Qwen3.5 Open-Source', model: 'qwen3.5-27b', digest: 'qwen3.5-27b' },
    { name: 'Qwen3 Max', model: 'qwen3-max', digest: 'qwen3-max' },
    { name: 'Qwen Plus', model: 'qwen-plus', digest: 'qwen-plus' },
    { name: 'Qwen3 Coder Plus', model: 'qwen3-coder-plus', digest: 'qwen3-coder-plus' },
    { name: 'Qwen Plus Character', model: 'qwen-plus-character', digest: 'qwen-plus-character' },
    { name: 'Qwen3 Open-Source', model: 'qwen3-coder-next', digest: 'qwen3-coder-next' },
  ] : [];

  const allModels = [...geminiModels, ...qwenModels];

  return NextResponse.json({ models: allModels }, {
    headers: {
      'Cache-Control': 'public, max-age=300',
    }
  });
}
