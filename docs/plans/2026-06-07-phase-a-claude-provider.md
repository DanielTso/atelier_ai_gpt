# Phase A — Add Claude as a Model Provider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude (Opus 4.8 default, Sonnet 4.6, Haiku 4.5) the primary chat provider via `@ai-sdk/anthropic`, with web search enabled; retire Gemini text models from the picker; keep Gemini for embeddings + Nano Banana image generation.

**Architecture:** The app is built on the Vercel AI SDK, so a Claude model is just another `LanguageModel` object. `createProvider()` grows a `claude-*` branch (Anthropic provider + web-search tool) alongside the existing Gemini branch; the chat route, context pipeline, and streaming are untouched. Embeddings stay on Gemini (Anthropic has no embeddings API). Background tasks (title/summarize/classify) are pinned to a cheap internal Gemini model. The model picker is driven by `/api/models`, which now lists Claude (Opus first → becomes the default via existing `data.models[0]` logic) + Nano Banana.

**Tech Stack:** Next.js 16 App Router, TypeScript, AI SDK v6 (`ai@^6`, `@ai-sdk/google@^3`, **new** `@ai-sdk/anthropic@^3`), Drizzle + libSQL, Vitest, Playwright.

**Verified against live docs (Context7, AI SDK v6):**
- Web search tool: `const anthropic = createAnthropic({ apiKey }); anthropic.tools.webSearch_20250305({ maxUses: 5 })` placed in `tools: { web_search }` — mirrors the existing `google.tools.googleSearch({})` pattern.
- Thinking: AI SDK v6 only exposes **budget-based** thinking (`thinking: { type: 'enabled', budgetTokens }`), which **Opus 4.8 rejects (400)**. Therefore **Phase A ships Claude with NO explicit thinking config** (valid: no `thinking` field = thinking off). Adaptive thinking is a deferred follow-up.

---

## File structure (what changes and why)

| File | Responsibility after this phase |
|---|---|
| `package.json` | Adds `@ai-sdk/anthropic` |
| `src/lib/settings.ts` | `getAnthropicApiKey()` — DB-first, env (`ANTHROPIC_API_KEY`) fallback |
| `src/app/actions.ts` | Blocks `anthropic-api-key` from client reads; adds `getApiKeyStatus()` for the keys UI |
| `src/lib/providers.ts` | Routes `claude-*` → Anthropic (+web search); `gemini-*image*` → image; other `gemini-*` → utility/embeddings text |
| `src/app/api/models/route.ts` | Lists Claude (Opus first) when Anthropic key present; Nano Banana when Gemini key present |
| `src/app/api/chat/route.ts` | Default-model fallback → `claude-opus-4-8` (provider-agnostic otherwise) |
| `src/app/api/generate-title/route.ts` | Pinned to `gemini-3.5-flash` |
| `src/app/api/summarize/route.ts` | Pinned to `gemini-3.5-flash` |
| `src/app/api/classify/route.ts` | No change (already Gemini-pinned & Claude-tolerant) |
| `src/hooks/usePersonas.ts` | Combo `preferredModel`s + labels repointed to the Claude lineup |
| `src/components/settings/ApiKeysSettingsTab.tsx` | **New** — view status + set Gemini/Anthropic keys |
| `src/components/ui/SettingsDialog.tsx` | Adds the "API Keys" tab |
| `src/components/settings/ModelDefaultsSettingsTab.tsx` | Default-model dropdown groups Claude + image |
| Tests | Unit coverage for settings, provider routing, models route, key blocking, key status |
| `CLAUDE.md`, `CHANGELOG.md`, `docs/chatlog-*.md` | Updated |

---

## Task 1: Add the `@ai-sdk/anthropic` dependency

**Files:** Modify `package.json` (+ lockfile)

- [ ] **Step 1: Install the provider**

Run: `npm install @ai-sdk/anthropic`

- [ ] **Step 2: Verify the installed major matches the AI SDK v6 line**

Run: `npm ls @ai-sdk/anthropic @ai-sdk/google ai`
Expected: `ai@6.x`, `@ai-sdk/google@3.x`, `@ai-sdk/anthropic@3.x`. If `@ai-sdk/anthropic` resolved to a different major than `@ai-sdk/google` (3.x), pin it: `npm install @ai-sdk/anthropic@^3`.

- [ ] **Step 3: Confirm the build still passes**

Run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(phase-a): add @ai-sdk/anthropic dependency"
```

---

## Task 2: `getAnthropicApiKey()` in settings

**Files:**
- Modify: `src/lib/settings.ts`
- Test: `tests/unit/lib/settings.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the existing `describe('settings caching', ...)` block in `tests/unit/lib/settings.test.ts`, before its closing `})`)

```ts
  it('getAnthropicApiKey reads DB key over env', async () => {
    const { getAnthropicApiKey } = await import('@/lib/settings')
    process.env.ANTHROPIC_API_KEY = 'env-anthropic'
    await setSetting('anthropic-api-key', 'db-anthropic')
    clearSettingsCache()
    expect(await getAnthropicApiKey()).toBe('db-anthropic')
    delete process.env.ANTHROPIC_API_KEY
  })

  it('getAnthropicApiKey falls back to env when no DB key', async () => {
    const { getAnthropicApiKey } = await import('@/lib/settings')
    clearSettingsCache()
    process.env.ANTHROPIC_API_KEY = 'env-only-anthropic'
    expect(await getAnthropicApiKey()).toBe('env-only-anthropic')
    delete process.env.ANTHROPIC_API_KEY
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/settings.test.ts -t "getAnthropicApiKey"`
Expected: FAIL — `getAnthropicApiKey` is not exported.

- [ ] **Step 3: Implement** — append to `src/lib/settings.ts` (after `getGeminiApiKey`)

```ts
export async function getAnthropicApiKey(): Promise<string | null> {
  return getServerSetting('anthropic-api-key', 'ANTHROPIC_API_KEY')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/settings.test.ts -t "getAnthropicApiKey"`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings.ts tests/unit/lib/settings.test.ts
git commit -m "feat(phase-a): add getAnthropicApiKey (DB-first, env fallback)"
```

---

## Task 3: Block `anthropic-api-key` from client reads

**Files:**
- Modify: `src/app/actions.ts:7`
- Test: `tests/unit/actions/settings-security.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `tests/unit/actions/settings-security.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb } }))

import { vi } from 'vitest'
import { getSetting, getSettings } from '@/app/actions'

describe('sensitive settings are not client-readable', () => {
  beforeEach(async () => {
    await createTestDb()
  })

  it('getSetting throws for anthropic-api-key', async () => {
    await expect(getSetting('anthropic-api-key')).rejects.toThrow('Access denied')
  })

  it('getSetting throws for gemini-api-key', async () => {
    await expect(getSetting('gemini-api-key')).rejects.toThrow('Access denied')
  })

  it('getSettings filters out sensitive keys', async () => {
    const result = await getSettings(['anthropic-api-key', 'gemini-api-key'])
    expect(result).toEqual({})
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/actions/settings-security.test.ts`
Expected: FAIL — `getSetting('anthropic-api-key')` resolves instead of throwing.

- [ ] **Step 3: Implement** — edit `src/app/actions.ts:7`

```ts
const SENSITIVE_KEYS = new Set(['gemini-api-key', 'anthropic-api-key'])
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/actions/settings-security.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add src/app/actions.ts tests/unit/actions/settings-security.test.ts
git commit -m "feat(phase-a): block anthropic-api-key from client reads"
```

---

## Task 4: Claude branch in `createProvider`

**Files:**
- Modify: `src/lib/providers.ts` (full rewrite below)
- Test: `tests/unit/lib/providers.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `tests/unit/lib/providers.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockWebSearch = vi.fn(() => ({ type: 'provider-defined', id: 'web_search' }))
const mockGoogleSearch = vi.fn(() => ({ type: 'provider-defined', id: 'google_search' }))

function mockProviders() {
  vi.doMock('@ai-sdk/anthropic', () => ({
    createAnthropic: () => Object.assign(
      (model: string) => ({ modelId: model, provider: 'anthropic' }),
      { tools: { webSearch_20250305: mockWebSearch } }
    ),
  }))
  vi.doMock('@ai-sdk/google', () => ({
    createGoogleGenerativeAI: () => Object.assign(
      (model: string) => ({ modelId: model, provider: 'google' }),
      { tools: { googleSearch: mockGoogleSearch } }
    ),
  }))
}

describe('createProvider', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('routes claude models to Anthropic with a web_search tool', async () => {
    mockProviders()
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve('anthropic-key'),
      getGeminiApiKey: () => Promise.resolve(null),
    }))
    const { createProvider } = await import('@/lib/providers')
    const result = await createProvider('claude-opus-4-8')
    expect(result.model).toEqual({ modelId: 'claude-opus-4-8', provider: 'anthropic' })
    expect(result.tools).toHaveProperty('web_search')
    expect(mockWebSearch).toHaveBeenCalled()
  })

  it('throws when claude selected but no Anthropic key', async () => {
    mockProviders()
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve(null),
      getGeminiApiKey: () => Promise.resolve(null),
    }))
    const { createProvider } = await import('@/lib/providers')
    await expect(createProvider('claude-opus-4-8')).rejects.toThrow('Anthropic API Key is missing')
  })

  it('routes the gemini image model with TEXT+IMAGE modalities', async () => {
    mockProviders()
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve(null),
      getGeminiApiKey: () => Promise.resolve('gemini-key'),
    }))
    const { createProvider } = await import('@/lib/providers')
    const result = await createProvider('gemini-3.1-flash-image')
    expect(result.providerOptions).toEqual({ google: { responseModalities: ['TEXT', 'IMAGE'] } })
  })

  it('routes internal gemini text with google_search grounding', async () => {
    mockProviders()
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve(null),
      getGeminiApiKey: () => Promise.resolve('gemini-key'),
    }))
    const { createProvider } = await import('@/lib/providers')
    const result = await createProvider('gemini-3.5-flash')
    expect(result.tools).toHaveProperty('google_search')
  })

  it('throws for an unknown provider', async () => {
    mockProviders()
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve('k'),
      getGeminiApiKey: () => Promise.resolve('k'),
    }))
    const { createProvider } = await import('@/lib/providers')
    await expect(createProvider('llama3')).rejects.toThrow('Unknown model provider')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/providers.test.ts`
Expected: FAIL — claude branch not implemented / `getAnthropicApiKey` not imported.

- [ ] **Step 3: Implement** — replace the entire contents of `src/lib/providers.ts`

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/providers.test.ts`
Expected: PASS (all five).

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers.ts tests/unit/lib/providers.test.ts
git commit -m "feat(phase-a): route claude models to Anthropic with web search"
```

---

## Task 5: Models route lists Claude + image

**Files:**
- Modify: `src/app/api/models/route.ts` (full rewrite below)
- Test: `tests/unit/api/models-route.test.ts` (rewrite)

- [ ] **Step 1: Rewrite the test** — replace the entire contents of `tests/unit/api/models-route.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('GET /api/models', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  function mockKeys({ anthropic = null as string | null, gemini = null as string | null } = {}) {
    vi.doMock('@/lib/settings', () => ({
      getAnthropicApiKey: () => Promise.resolve(anthropic),
      getGeminiApiKey: () => Promise.resolve(gemini),
    }))
  }

  it('lists Claude models (Opus first) when Anthropic key is set', async () => {
    mockKeys({ anthropic: 'a-key' })
    const { GET } = await import('@/app/api/models/route')
    const data = await (await GET()).json()
    expect(data.models[0].model).toBe('claude-opus-4-8')
    const ids = data.models.map((m: { model: string }) => m.model)
    expect(ids).toContain('claude-sonnet-4-6')
    expect(ids).toContain('claude-haiku-4-5')
  })

  it('includes Nano Banana when Gemini key is set, no Gemini text models', async () => {
    mockKeys({ anthropic: 'a-key', gemini: 'g-key' })
    const { GET } = await import('@/app/api/models/route')
    const data = await (await GET()).json()
    const ids = data.models.map((m: { model: string }) => m.model)
    expect(ids).toContain('gemini-3.1-flash-image')
    expect(ids.some((id: string) => id.startsWith('gemini') && !id.includes('image'))).toBe(false)
  })

  it('returns no models when no keys are set', async () => {
    mockKeys()
    const { GET } = await import('@/app/api/models/route')
    const data = await (await GET()).json()
    expect(data.models).toHaveLength(0)
  })

  it('sets cache-control header', async () => {
    mockKeys({ anthropic: 'a-key' })
    const { GET } = await import('@/app/api/models/route')
    const response = await GET()
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/api/models-route.test.ts`
Expected: FAIL — route still returns Gemini text models / imports only `getGeminiApiKey`.

- [ ] **Step 3: Implement** — replace the entire contents of `src/app/api/models/route.ts`

```ts
import { NextResponse } from 'next/server';
import { getGeminiApiKey, getAnthropicApiKey } from '@/lib/settings';

export async function GET() {
  const [anthropicApiKey, geminiApiKey] = await Promise.all([
    getAnthropicApiKey(),
    getGeminiApiKey(),
  ]);

  const models: { name: string; model: string; digest: string }[] = [];

  // Claude — primary chat models. Opus first → becomes the default for new
  // chats via the client's `data.models[0]` fallback.
  if (anthropicApiKey) {
    models.push(
      { name: 'Claude Opus 4.8', model: 'claude-opus-4-8', digest: 'claude-opus-4-8' },
      { name: 'Claude Sonnet 4.6', model: 'claude-sonnet-4-6', digest: 'claude-sonnet-4-6' },
      { name: 'Claude Haiku 4.5', model: 'claude-haiku-4-5', digest: 'claude-haiku-4-5' },
    );
  }

  // Gemini — image generation only (Nano Banana 2). Embeddings + utility tasks
  // use Gemini internally but are not user-selectable models.
  if (geminiApiKey) {
    models.push(
      { name: 'Nano Banana 2', model: 'gemini-3.1-flash-image', digest: 'gemini-3.1-flash-image' },
    );
  }

  return NextResponse.json({ models }, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/api/models-route.test.ts`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/models/route.ts tests/unit/api/models-route.test.ts
git commit -m "feat(phase-a): list Claude models (Opus default) + Nano Banana"
```

---

## Task 6: Chat route routes Claude + default fallback

**Files:**
- Modify: `src/app/api/chat/route.ts:45`
- Test: `tests/unit/api/chat-route.test.ts`

- [ ] **Step 1: Add the Anthropic mock + a failing Claude-routing test** — in `tests/unit/api/chat-route.test.ts`, add this mock block after the `@ai-sdk/google` mock (around line 31):

```ts
const mockWebSearch = vi.fn(() => ({ type: 'provider-defined', id: 'web_search' }))
const mockAnthropicFn = Object.assign(
  vi.fn((model: string) => ({ modelId: model, provider: 'anthropic' })),
  { tools: { webSearch_20250305: mockWebSearch } }
)
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => mockAnthropicFn,
}))
```

Then inside `postChat`, add the matching `vi.doMock` after the `@ai-sdk/google` doMock (around line 57):

```ts
    vi.doMock('@ai-sdk/anthropic', () => ({
      createAnthropic: () => Object.assign(
        (model: string) => mockAnthropicFn(model),
        { tools: { webSearch_20250305: mockWebSearch } }
      ),
    }))
```

And update the `@/lib/settings` doMock (around line 58) to expose both keys:

```ts
    vi.doMock('@/lib/settings', () => ({
      getGeminiApiKey: () => Promise.resolve('test-key'),
      getAnthropicApiKey: () => Promise.resolve('test-anthropic-key'),
    }))
```

Add this test inside the `describe('POST /api/chat', ...)` block:

```ts
  it('routes claude models to the Anthropic provider', async () => {
    const response = await postChat({
      messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
      model: 'claude-opus-4-8',
    })
    expect(response.status).toBe(200)
    expect(mockAnthropicFn).toHaveBeenCalledWith('claude-opus-4-8')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/api/chat-route.test.ts -t "routes claude"`
Expected: FAIL — `@ai-sdk/anthropic` not previously mocked / `getAnthropicApiKey` undefined in mock → provider throws.

- [ ] **Step 3: Implement** — edit `src/app/api/chat/route.ts:45`

```ts
    const modelName = model || 'claude-opus-4-8';
```

- [ ] **Step 4: Run the full chat-route test file to verify all pass**

Run: `npx vitest run tests/unit/api/chat-route.test.ts`
Expected: PASS — including the existing `gemini-3.5-flash` routing test and the new Claude test.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/route.ts tests/unit/api/chat-route.test.ts
git commit -m "feat(phase-a): route claude in chat API, default to claude-opus-4-8"
```

---

## Task 7: Pin housekeeping routes to Gemini Flash

**Files:**
- Modify: `src/app/api/generate-title/route.ts:14,24`
- Modify: `src/app/api/summarize/route.ts:23,55`

> `classify` already pins to Gemini and tolerates a Claude `model` in the body (`modelName.startsWith('gemini') ? modelName : 'gemini-3.5-flash'`) — no change.

- [ ] **Step 1: Edit `generate-title` route** — `src/app/api/generate-title/route.ts:14`

```ts
    const { chatId, messages } = body.data;
```

and line 24:

```ts
    // Housekeeping runs on a cheap internal Gemini model, never the chat model.
    const modelName = 'gemini-3.5-flash';
```

- [ ] **Step 2: Edit `summarize` route** — `src/app/api/summarize/route.ts:23`

```ts
    const { chatId, cutoffMessageId } = body.data;
```

and line 55:

```ts
    // Housekeeping runs on a cheap internal Gemini model, never the chat model.
    const modelName = 'gemini-3.5-flash';
```

- [ ] **Step 3: Run the existing route tests to verify they still pass**

Run: `npx vitest run tests/unit/api/generate-title-route.test.ts tests/unit/api/summarize-route.test.ts tests/unit/api/classify-route.test.ts`
Expected: PASS — these tests already exercise `gemini-3.5-flash`; the routes now ignore the request `model` and use it directly.

- [ ] **Step 4: Lint-check for unused vars**

Run: `npm run lint`
Expected: no `model is defined but never used` errors in the two routes (the `model` field is no longer destructured).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/generate-title/route.ts src/app/api/summarize/route.ts
git commit -m "refactor(phase-a): pin title/summarize housekeeping to gemini-3.5-flash"
```

---

## Task 8: Repoint persona combos to the Claude lineup

**Files:** Modify `src/hooks/usePersonas.ts:18-30,175,201,227,254,256,279`

- [ ] **Step 1: Replace the label map + helper** — `src/hooks/usePersonas.ts:18-30`

```ts
/** Short, human-friendly labels for the curated models (used on combo chips). */
const MODEL_SHORT_LABELS: Record<string, string> = {
  'claude-opus-4-8': 'Opus 4.8',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5': 'Haiku 4.5',
  'gemini-3.1-flash-image': 'Nano Banana 2',
}

export function modelShortLabel(modelId?: string): string | null {
  if (!modelId) return null
  return MODEL_SHORT_LABELS[modelId] ?? modelId.replace(/^(claude|gemini)-/, '')
}
```

- [ ] **Step 2: Repoint the five combo `preferredModel`s** — apply these exact replacements in `COMBO_PRESETS`:
  - `combo-code-review` (line ~175): `preferredModel: 'gemini-3.1-pro-preview',` → `preferredModel: 'claude-opus-4-8',`
  - `combo-creative` (line ~201): `preferredModel: 'gemini-3.5-flash',` → `preferredModel: 'claude-sonnet-4-6',`
  - `combo-quick-code` (line ~227): `preferredModel: 'gemini-3.5-flash',` → `preferredModel: 'claude-haiku-4-5',`
  - `combo-deep-analysis` (line ~254): `preferredModel: 'gemini-3.1-pro-preview-deep-think',` → `preferredModel: 'claude-opus-4-8',`
  - `combo-general-assistant` (line ~279): `preferredModel: 'gemini-3.5-flash',` → `preferredModel: 'claude-sonnet-4-6',`

- [ ] **Step 3: Update the Deep Analysis description** — `combo-deep-analysis` (line ~256)

```ts
    description: 'Step-by-step reasoning with Opus 4.8',
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
(If no `typecheck` script exists, run `npx tsc --noEmit`.)
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePersonas.ts
git commit -m "feat(phase-a): repoint persona combos to the Claude lineup"
```

---

## Task 9: Model-Defaults dropdown groups Claude + image

**Files:** Modify `src/components/settings/ModelDefaultsSettingsTab.tsx:88,104-110`

- [ ] **Step 1: Replace the filtered list + dropdown options** — at `src/components/settings/ModelDefaultsSettingsTab.tsx:88`, replace the single `geminiModels` line with:

```ts
  const claudeModels = models.filter(m => m.model.startsWith('claude'))
  const imageModels = models.filter(m => m.model.includes('image'))
```

- [ ] **Step 2: Replace the `<optgroup>` block** — `src/components/settings/ModelDefaultsSettingsTab.tsx:104-110`

```tsx
          {claudeModels.length > 0 && (
            <optgroup label="Claude">
              {claudeModels.map(m => (
                <option key={m.model} value={m.model}>{m.name}</option>
              ))}
            </optgroup>
          )}
          {imageModels.length > 0 && (
            <optgroup label="Image">
              {imageModels.map(m => (
                <option key={m.model} value={m.model}>{m.name}</option>
              ))}
            </optgroup>
          )}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/ModelDefaultsSettingsTab.tsx
git commit -m "feat(phase-a): group Claude + image models in default-model picker"
```

---

## Task 10: API Keys settings tab

**Files:**
- Modify: `src/app/actions.ts` (add `getApiKeyStatus`)
- Create: `src/components/settings/ApiKeysSettingsTab.tsx`
- Modify: `src/components/ui/SettingsDialog.tsx`
- Test: `tests/unit/actions/settings-security.test.ts` (extend)

- [ ] **Step 1: Write the failing test** — append to `tests/unit/actions/settings-security.test.ts` inside the `describe` block

```ts
  it('getApiKeyStatus reports which keys are configured', async () => {
    const { getApiKeyStatus, setSetting } = await import('@/app/actions')
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    await setSetting('anthropic-api-key', 'sk-test')
    const status = await getApiKeyStatus()
    expect(status.anthropic).toBe(true)
    expect(status.gemini).toBe(false)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/actions/settings-security.test.ts -t "getApiKeyStatus"`
Expected: FAIL — `getApiKeyStatus` not exported.

- [ ] **Step 3: Implement `getApiKeyStatus`** — append to `src/app/actions.ts` (after `setSettings`)

```ts
export async function getApiKeyStatus(): Promise<{ gemini: boolean; anthropic: boolean }> {
  const rows = await db.select().from(settings)
    .where(inArray(settings.key, ['gemini-api-key', 'anthropic-api-key'])).all()
  const map = new Map(rows.map(r => [r.key, r.value]))
  const has = (dbVal: string | undefined, envVar: string) =>
    Boolean((dbVal && dbVal.trim()) || process.env[envVar])
  return {
    gemini: has(map.get('gemini-api-key'), 'GOOGLE_GENERATIVE_AI_API_KEY'),
    anthropic: has(map.get('anthropic-api-key'), 'ANTHROPIC_API_KEY'),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/actions/settings-security.test.ts`
Expected: PASS (all four).

- [ ] **Step 5: Create the tab component** — `src/components/settings/ApiKeysSettingsTab.tsx`

```tsx
'use client'

import { memo, useState, useEffect } from 'react'
import { Loader2, Check } from 'lucide-react'
import { getApiKeyStatus, setSettings } from '@/app/actions'

interface ApiKeysSettingsTabProps {
  onSettingsChanged?: () => void
}

export const ApiKeysSettingsTab = memo(function ApiKeysSettingsTab({
  onSettingsChanged,
}: ApiKeysSettingsTabProps) {
  const [status, setStatus] = useState<{ gemini: boolean; anthropic: boolean } | null>(null)
  const [anthropicInput, setAnthropicInput] = useState('')
  const [geminiInput, setGeminiInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getApiKeyStatus().then(setStatus)
  }, [])

  const handleSave = async () => {
    const entries: { key: string; value: string }[] = []
    if (anthropicInput.trim()) entries.push({ key: 'anthropic-api-key', value: anthropicInput.trim() })
    if (geminiInput.trim()) entries.push({ key: 'gemini-api-key', value: geminiInput.trim() })
    if (entries.length === 0) return
    setSaving(true)
    try {
      await setSettings(entries)
      setAnthropicInput('')
      setGeminiInput('')
      setStatus(await getApiKeyStatus())
      onSettingsChanged?.()
    } finally {
      setSaving(false)
    }
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Anthropic API Key</label>
          {status.anthropic && (
            <span className="flex items-center gap-1 text-xs text-success">
              <Check className="h-3 w-3" /> Configured
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Powers Claude chat models. Stored securely; never read back into this field.</p>
        <input
          type="password"
          value={anthropicInput}
          onChange={(e) => setAnthropicInput(e.target.value)}
          placeholder={status.anthropic ? 'Enter a new key to replace' : 'sk-ant-...'}
          className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Google Gemini API Key</label>
          {status.gemini && (
            <span className="flex items-center gap-1 text-xs text-success">
              <Check className="h-3 w-3" /> Configured
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Powers image generation (Nano Banana 2) and embeddings.</p>
        <input
          type="password"
          value={geminiInput}
          onChange={(e) => setGeminiInput(e.target.value)}
          placeholder={status.gemini ? 'Enter a new key to replace' : 'AIza...'}
          className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving || (!anthropicInput.trim() && !geminiInput.trim())}
        className="px-4 py-2 text-sm rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-50 flex items-center gap-2"
      >
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Save Keys
      </button>
    </div>
  )
})
```

- [ ] **Step 6: Wire the tab into `SettingsDialog`** — three edits to `src/components/ui/SettingsDialog.tsx`:

Import (after line 8):
```tsx
import { ApiKeysSettingsTab } from '@/components/settings/ApiKeysSettingsTab'
```
Icon import (line 5) — add `KeyRound`:
```tsx
import { X, Palette, SlidersHorizontal, KeyRound } from 'lucide-react'
```
Tab type (line 12):
```tsx
type SettingsTab = 'appearance' | 'defaults' | 'keys'
```
Tabs array (after the `defaults` entry, line 27):
```tsx
  { id: 'keys', label: 'API Keys', icon: KeyRound },
```
Tab content (after the `defaults` block, line 101):
```tsx
              {activeTab === 'keys' && (
                <ApiKeysSettingsTab onSettingsChanged={onSettingsChanged} />
              )}
```

- [ ] **Step 7: Typecheck, lint, build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/actions.ts src/components/settings/ApiKeysSettingsTab.tsx src/components/ui/SettingsDialog.tsx tests/unit/actions/settings-security.test.ts
git commit -m "feat(phase-a): add API Keys settings tab for Gemini + Anthropic"
```

---

## Task 11: Documentation

**Files:** Modify `CLAUDE.md`, `CHANGELOG.md`; create `docs/chatlog-2026-06-07-phase-a-claude-provider.md`

- [ ] **Step 1: Update `CLAUDE.md`** — make these factual edits:
  - Environment Setup: add `ANTHROPIC_API_KEY=your_key_here` and note the app now uses **two** providers (Claude for chat, Gemini for image + embeddings).
  - Provider Routing section: document the `claude-*` branch (web search via `anthropic.tools.webSearch_20250305`), that Gemini text models are retired from the picker, and that housekeeping (title/summarize/classify) runs on internal `gemini-3.5-flash`.
  - AI SDK Gotchas: add an entry — "Claude models route via `@ai-sdk/anthropic`; Opus 4.8 rejects `budget_tokens` (no thinking config in Phase A); embeddings remain Gemini-only (Anthropic has no embeddings API)."
  - Model IDs: replace the Gemini-curated-list gotcha with the current picker (Opus 4.8 default, Sonnet 4.6, Haiku 4.5, Nano Banana 2).

- [ ] **Step 2: Update `CHANGELOG.md`** — add a new version entry summarizing Phase A (Claude provider, web search, Gemini text retired, API Keys tab) with the verification evidence (all gates green).

- [ ] **Step 3: Write the session chatlog** — create `docs/chatlog-2026-06-07-phase-a-claude-provider.md` summarizing the brainstorm decisions, the A→B→C→D roadmap, and Phase A implementation.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md CHANGELOG.md docs/chatlog-2026-06-07-phase-a-claude-provider.md
git commit -m "docs(phase-a): document Claude provider, routing, and roadmap"
```

---

## Task 12: Full verification gate + manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated gate**

Run: `npm install && npm run lint && npm run build && npm test && npm run test:e2e`
Expected: all green, zero warnings. (E2E is key-independent and unchanged, so it passes in CI without secrets.)

- [ ] **Step 2: Manual smoke test** — `npm run dev`, then:
  - Open Settings → API Keys → paste an Anthropic key → Save → "Configured ✓" appears.
  - Start a new chat → confirm it defaults to **Claude Opus 4.8**; picker shows Opus / Sonnet / Haiku / Nano Banana 2, **no Gemini text models**.
  - Send a message that needs current info (e.g. "what's the latest on X") → confirm a reply streams and **web-search source chips render**.
  - Switch to **Nano Banana 2** → "generate an image of …" → confirm an image renders.
  - Reload the page → confirm the chat, messages, and any generated image persist.

- [ ] **Step 3: Tag the phase (after the gate + smoke test pass)**

```bash
git tag -a phase-a -m "Phase A: Claude provider with web search"
```

---

## Self-review (completed by plan author)

**Spec coverage:** Every spec file-change and DoD item maps to a task — settings key (T2), client-read block (T3), provider routing + web search (T4), models route gating + Opus default (T5), chat routing (T6), housekeeping pinning (T7), persona/menu cleanup (T8/T9), key UI (T10), docs (T11), gate (T12). ✅

**Spec corrections folded in (flag to user):**
1. Spec said "add Anthropic field beside the Gemini field" — no key UI existed, so T10 creates a proper **API Keys tab** for both providers.
2. Spec's decision #7 (adaptive thinking ON) — Context7 verification showed AI SDK v6 only exposes budget-based thinking, which Opus 4.8 rejects; Phase A ships **without** a thinking config. Web search remains ON.
3. Spec's E2E "select Opus and stream (provider mocked)" — the real Playwright server can't mock providers and CI has no keys; Claude routing is covered by **unit** tests, E2E stays key-independent.

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✅
**Type consistency:** `getAnthropicApiKey`, `createProvider`, `getApiKeyStatus`, `ProviderResult`, `webSearch_20250305`, model IDs used identically across tasks. ✅
