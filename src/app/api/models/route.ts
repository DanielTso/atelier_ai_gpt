import { NextResponse } from 'next/server';
import { getModelRegistry } from '@/lib/models/registry';
import { apiError } from '@/lib/errors';

export async function GET() {
  try {
    // The registry is the single source of truth for what's offered — it
    // already handles key gating (no Anthropic key => no Claude entries;
    // Gemini entries only when its key is set) and ordering (Claude before
    // Gemini). This route is a thin wire-shape adapter, nothing more.
    const registry = await getModelRegistry();

    const models = registry.curated.map((m) => ({
      // name/model/digest kept for back-compat with existing clients; digest
      // stays the model id (there's no separate content-hash concept here).
      name: m.name,
      model: m.id,
      digest: m.id,
      provider: m.provider,
      family: m.family,
      capabilities: m.capabilities,
      pricing: m.pricing,
    }));

    return NextResponse.json({ models }, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (error) {
    return apiError(error, 'Failed to load models', 500);
  }
}
