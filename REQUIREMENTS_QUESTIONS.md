# Clarification Questions & Recommendations

To ensure we finish this project **today** while hitting your goals (Glassmorphism, Folders, History), I have prepared the following questions and a recommended path.

## 1. Tech Stack Recommendation (For Speed & Features)
**Recommendation:** **Next.js (App Router) + Tailwind CSS + Lucide React (Icons)**
*   **Why?**
    *   **Speed:** fast setup with `create-next-app`.
    *   **Backend:** Built-in API routes allow us to easily proxy requests to Ollama (avoiding CORS issues) and save files to your disk.
    *   **Styling:** Tailwind is excellent for creating custom Glassmorphism effects (`backdrop-blur`, `bg-opacity`, etc.).

**Question:** Do you approve this stack? (If not, we can fall back to React+Vite, but persistence to disk is harder).

## 2. Data Persistence (History & Folders)
Since this is a local tool, we need to decide where to save your "Projects" and "Chats".

*   **Option A: Browser Storage (IndexedDB/LocalStorage)**
    *   *Pros:* Easiest to build.
    *   *Cons:* Data lives in the browser. Clearing cache deletes your chats.
*   **Option B: Local File System (JSON files)** (Recommended for a "Developer Tool")
    *   *Pros:* Your chats are real files. You can back them up or sync them.
    *   *Cons:* Requires a tiny bit more code in the Next.js API layer.

**Question:** Which storage option do you prefer? (I recommend **Option B** for a robust personal tool).

## 3. Ollama Configuration
*   **Question:** Do you currently have Ollama running? (Usually at `http://localhost:11434`).
*   **Question:** Which model do you want to use as the default? (e.g., `llama3`, `mistral`, `gemma`).

## 4. Visual Design (Glassmorphism)
Glassmorphism relies heavily on background images or gradients to show the "blur" effect.
*   **Question:** Do you have a preferred color scheme (e.g., Dark Mode with Neon accents, Soft Pastels, or specific Wallpaper)?

---

## Resolved Outcomes

The above questions were addressed during development. Key decisions:

1. **Tech Stack:** Next.js App Router approved and implemented (now Next.js 16).
2. **Data Persistence:** Neither Option A nor B — chose **SQLite with Drizzle ORM** for robust local storage. Settings use a **hybrid approach**: server-accessible config (API keys, provider URLs) in SQLite with env-var fallback, client-only preferences (theme, font size, sidebar state) in localStorage.
3. **AI Providers:** Ollama was removed in v1.7.0. The app now uses cloud providers only — Google Gemini and Alibaba Cloud Qwen (DashScope). API keys are configurable via the Settings dialog or `.env.local`.
4. **Visual Design:** Dark mode with glassmorphism aesthetic implemented. Theme switching (Dark/Light/System) available in the Settings Appearance tab via `next-themes`.
