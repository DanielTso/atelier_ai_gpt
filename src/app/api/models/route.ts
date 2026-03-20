import { NextResponse } from 'next/server';
import { getGeminiApiKey, getOllamaBaseUrl, getDashScopeApiKey, isCloudEnvironment } from '@/lib/settings';

export async function GET() {
  // Parallel settings fetch
  const [geminiApiKey, dashScopeApiKey, ollamaBaseUrl] = await Promise.all([
    getGeminiApiKey(),
    getDashScopeApiKey(),
    getOllamaBaseUrl(),
  ]);

  // Only include Gemini models if an API key is configured
  const geminiModels = geminiApiKey ? [
    { name: 'Gemini 3 Flash', model: 'gemini-3-flash-preview', digest: 'gemini-3-flash-preview' },
    { name: 'Gemini 3.1 Pro', model: 'gemini-3.1-pro-preview', digest: 'gemini-3.1-pro-preview' },
    { name: 'Gemini 3.1 Deep Think', model: 'gemini-3.1-pro-preview-deep-think', digest: 'gemini-3.1-pro-preview-deep-think' },
    { name: 'Gemini 3.1 Flash-Lite', model: 'gemini-3.1-flash-lite-preview', digest: 'gemini-3.1-flash-lite-preview' },
    { name: 'Nano Banana 2', model: 'gemini-3.1-flash-image-preview', digest: 'gemini-3.1-flash-image-preview' },
  ] : [];

  // Fetch Qwen models dynamically from DashScope if API key is configured
  let qwenModels: { name: string; model: string; digest: string }[] = [];
  if (dashScopeApiKey) {
    try {
      const dashRes = await fetch('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models', {
        headers: { 'Authorization': `Bearer ${dashScopeApiKey}` },
        signal: AbortSignal.timeout(3000),
      });
      if (dashRes.ok) {
        const data = await dashRes.json();
        const models = data?.data || [];
        qwenModels = models
          .filter((m: { id: string; owned_by?: string }) =>
            m.id.startsWith('qwen') && !m.id.includes('embed') && !m.id.includes('audio') && !m.id.includes('vl') && !m.id.includes('omni')
          )
          .map((m: { id: string }) => ({
            name: m.id.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
            model: m.id,
            digest: m.id,
          }));
      }
    } catch {
      // DashScope models API unavailable, skip
    }
  }

  // Try to fetch local Ollama models — skip entirely on cloud (no Ollama available)
  let ollamaModels: { name: string; model: string; digest: string }[] = [];
  if (!isCloudEnvironment()) {
    try {
      const ollamaRes = await fetch(`${ollamaBaseUrl}/api/tags`, {
        signal: AbortSignal.timeout(1000),
      });
      if (ollamaRes.ok) {
        const data = await ollamaRes.json();
        ollamaModels = data.models || [];
      }
    } catch {
      // Ollama not available, continue with cloud providers only
    }
  }

  // Combine all model types
  const allModels = [...geminiModels, ...qwenModels, ...ollamaModels];

  return NextResponse.json({ models: allModels }, {
    headers: {
      'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
    }
  });
}
