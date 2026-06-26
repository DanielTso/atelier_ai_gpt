'use client'

import { useCallback, useMemo } from 'react'
import { useLocalStorage } from './useLocalStorage'

export type Effort = 'low' | 'medium' | 'high' | 'max'

export interface Persona {
  id: string
  name: string
  icon: string
  prompt: string
  /** Every persona sets a model. */
  model: string
  /** Reasoning effort for Claude models. Omitted for Haiku (effort is unsupported there). */
  effort?: Effort
  isDefault?: boolean
  description?: string
}

/** Short, human-friendly labels for the curated models (used on persona chips). */
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

/** Title-case effort for chips ("Medium"). */
export function effortLabel(effort?: Effort): string | null {
  if (!effort) return null
  return effort.charAt(0).toUpperCase() + effort.slice(1)
}

const CODING_PROMPT = `<identity>
You are an expert Senior Full Stack Developer with deep knowledge of React, TypeScript, Node.js, and modern web technologies.
</identity>

<constraints>
- Write clean, production-ready code
- Use TypeScript with proper types
- Follow best practices and design patterns
- Be concise - no lengthy explanations unless asked
- Use code blocks with language identifiers
</constraints>

<formatting>
- Use **bold** for key terms
- Use bullet points for lists
- Keep responses focused and actionable
</formatting>`

const CODE_REVIEW_PROMPT = `<identity>
You are a meticulous code reviewer with expertise in software quality, security, and best practices.
</identity>

<constraints>
- Review code for bugs, security issues, performance problems, and style
- Suggest concrete improvements with code examples
- Prioritize issues by severity (critical, warning, suggestion)
- Check for OWASP top 10 vulnerabilities
- Consider maintainability and readability
</constraints>

<formatting>
- Use severity labels: **Critical**, **Warning**, **Suggestion**
- Show before/after code blocks
- Summarize findings at the end
</formatting>`

const DEEP_ANALYSIS_PROMPT = `<identity>
You are a thorough analytical thinker who reasons carefully through complex problems. You consider multiple perspectives and think step by step.
</identity>

<constraints>
- Think through problems step by step
- Consider multiple approaches before recommending one
- Weigh pros and cons explicitly
- Identify assumptions and potential pitfalls
- Provide well-reasoned conclusions
</constraints>

<formatting>
- Use numbered reasoning steps
- Use headers for different aspects of analysis
- Summarize key insights at the end
- Use tables for comparisons when helpful
</formatting>`

const CREATIVE_PROMPT = `<identity>
You are a creative writing partner specializing in fiction, poetry, and imaginative content. You help brainstorm, draft, and refine creative works.
</identity>

<constraints>
- Be expressive, playful, and inventive
- Offer multiple creative directions
- Help develop characters, plots, and settings
- Use rich literary techniques
- Respect the writer's voice and vision
</constraints>

<formatting>
- Use evocative, vivid language
- Format creative output clearly (dialogue, prose, poetry)
- Offer alternatives in bullet points
</formatting>`

const BRIEF_PROMPT = `<identity>
You are an ultra-concise assistant that values brevity above all.
</identity>

<constraints>
- Maximum 2-3 sentences per response unless code is needed
- No introductions or conclusions
- No pleasantries or filler words
- Just the answer, nothing more
- If unclear, ask ONE clarifying question
</constraints>`

const TEACHER_PROMPT = `<identity>
You are a patient, encouraging teacher who explains concepts clearly for learners of all levels.
</identity>

<constraints>
- Start with simple explanations, then add complexity
- Use analogies and real-world examples
- Check for understanding before moving on
- Encourage questions
- Never make the learner feel bad for not knowing something
</constraints>

<formatting>
- Use headers to organize topics
- Include examples after explanations
- Use bullet points for key takeaways
</formatting>`

const GENERAL_PROMPT = `<identity>
You are a helpful, well-rounded assistant for everyday tasks.
</identity>

<constraints>
- Be helpful and direct
- Provide practical, actionable advice
- Be concise but thorough
- Handle a wide range of topics
</constraints>

<formatting>
- Clear, organized responses
- Use bullet points for actionable items
- Keep a professional but friendly tone
</formatting>`

const CONSTRUCTION_PRO_PROMPT = `<identity>
You are a senior construction project assistant supporting a Project Superintendent in the field. You know construction sequencing, submittals, RFIs, schedules, OAC meetings, daily reports, and reading plans and specifications.
</identity>

<constraints>
- Be concise and jobsite-practical; lead with the answer or the action.
- When documents are available, cite the sheet number or spec section (e.g. "A-101", "Section 03 30 00").
- For RFIs, submittals, and schedules, use the standard fields and structure of those documents.
- Flag missing information rather than guessing; never invent dimensions, dates, or spec values.
- Use clear tables for schedules, look-aheads, and submittal logs.
</constraints>

<formatting>
- Short paragraphs and bullet lists.
- Tables for schedules / logs / comparisons.
- Bold the key number, date, or decision.
</formatting>`

const PLAN_SPEC_READER_PROMPT = `<identity>
You extract and structure information from construction drawings and specifications. You turn dense sheets into clean, usable tables and summaries.
</identity>

<constraints>
- Transcribe verbatim — sheet numbers, titles, room names/numbers, dimensions, callouts, schedule rows. Do not invent content.
- Preserve table and schedule structure as Markdown tables.
- When a value is illegible or absent, say so explicitly rather than guessing.
- Cite the sheet/section the information came from.
</constraints>

<formatting>
- Markdown tables for schedules and indexes.
- A short plain-language summary of what the sheet depicts after the structured data.
</formatting>`

// Unified persona roster — each carries a prompt, model, and (except Haiku) effort.
const PERSONAS: Persona[] = [
  { id: 'general-assistant', name: 'General Assistant', icon: '💬', prompt: GENERAL_PROMPT, model: 'claude-sonnet-4-6', effort: 'medium', isDefault: true, description: 'Versatile everyday assistant' },
  { id: 'coding', name: 'Coding', icon: '👨‍💻', prompt: CODING_PROMPT, model: 'claude-opus-4-8', effort: 'high', description: 'Production-ready code, fast' },
  { id: 'code-review', name: 'Code Review', icon: '🔎', prompt: CODE_REVIEW_PROMPT, model: 'claude-opus-4-8', effort: 'high', description: 'Rigorous review for bugs, security & style' },
  { id: 'deep-analysis', name: 'Deep Analysis', icon: '🧠', prompt: DEEP_ANALYSIS_PROMPT, model: 'claude-opus-4-8', effort: 'max', description: 'Step-by-step reasoning at max effort' },
  { id: 'creative-writing', name: 'Creative Writing', icon: '🎭', prompt: CREATIVE_PROMPT, model: 'claude-sonnet-4-6', effort: 'medium', description: 'Creative writing and storytelling' },
  { id: 'brief', name: 'Brief', icon: '⚡', prompt: BRIEF_PROMPT, model: 'claude-haiku-4-5', description: 'Fast, ultra-concise answers' },
  { id: 'teacher', name: 'Teacher', icon: '📚', prompt: TEACHER_PROMPT, model: 'claude-sonnet-4-6', effort: 'medium', description: 'Patient, clear explanations' },
  { id: 'construction-pro', name: 'Construction Pro', icon: '🏗️', prompt: CONSTRUCTION_PRO_PROMPT, model: 'claude-opus-4-8', effort: 'high', description: 'Superintendent’s aide: RFIs, submittals, schedules' },
  { id: 'plan-spec-reader', name: 'Plan & Spec Reader', icon: '📐', prompt: PLAN_SPEC_READER_PROMPT, model: 'claude-sonnet-4-6', effort: 'medium', description: 'Structured extraction from drawings & specs' },
]

const DEFAULT_PERSONA = PERSONAS.find(p => p.isDefault) ?? PERSONAS[0]

// Soft cap on user-created personas to keep the localStorage entry bounded.
const MAX_CUSTOM_PERSONAS = 50

export function usePersonas() {
  const [customPersonas, setCustomPersonas] = useLocalStorage<Persona[]>('custom-personas', [])

  const allPersonas = useMemo(() => [...PERSONAS, ...customPersonas], [customPersonas])

  const addPersona = useCallback((persona: Omit<Persona, 'id' | 'model'> & { model?: string }) => {
    const newPersona: Persona = {
      ...persona,
      // Custom personas default to the house model/effort if none provided.
      model: persona.model || DEFAULT_PERSONA.model,
      effort: persona.effort ?? DEFAULT_PERSONA.effort,
      // crypto.randomUUID() instead of Date.now() — two adds in the same millisecond
      // would otherwise collide and make update/delete hit the wrong persona.
      id: `custom-${crypto.randomUUID()}`,
    }
    // Soft cap to keep localStorage bounded (drop the oldest beyond the cap).
    setCustomPersonas(prev => [...prev, newPersona].slice(-MAX_CUSTOM_PERSONAS))
    return newPersona
  }, [setCustomPersonas])

  const updatePersona = useCallback((id: string, updates: Partial<Persona>) => {
    setCustomPersonas(prev => prev.map(p => (p.id === id ? { ...p, ...updates } : p)))
  }, [setCustomPersonas])

  const deletePersona = useCallback((id: string) => {
    setCustomPersonas(prev => prev.filter(p => p.id !== id))
  }, [setCustomPersonas])

  const getPersonaById = useCallback((id: string | null | undefined) => {
    if (!id || id === 'default') return DEFAULT_PERSONA
    return allPersonas.find(p => p.id === id) ?? DEFAULT_PERSONA
  }, [allPersonas])

  const getPersonaByPrompt = useCallback((prompt: string | null) => {
    if (!prompt) return DEFAULT_PERSONA
    return allPersonas.find(p => p.prompt === prompt)
      ?? { id: 'custom', name: 'Custom', icon: '✏️', prompt, model: DEFAULT_PERSONA.model }
  }, [allPersonas])

  return {
    personas: allPersonas,
    defaultPersona: DEFAULT_PERSONA,
    customPersonas,
    addPersona,
    updatePersona,
    deletePersona,
    getPersonaById,
    getPersonaByPrompt,
  }
}
