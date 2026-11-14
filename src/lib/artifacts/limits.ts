// src/lib/artifacts/limits.ts
// Output-token cap for any Claude call that writes a whole artifact. A
// generate_artifact HTML page is written as tool-call input tokens, so
// /api/chat needs room for a large page plus prose; artifact regenerate
// rewrites the same source in full and must not be capped lower, or a big
// artifact is cut off mid-document (audit B6). 32k fits every Claude model
// in the picker.
export const ARTIFACT_MAX_OUTPUT_TOKENS = 32000
