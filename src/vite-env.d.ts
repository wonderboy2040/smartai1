/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TG_TOKEN: string;
  readonly VITE_TG_CHAT_ID: string;
  readonly VITE_API_URL: string;
  readonly VITE_GROQ_API_KEY: string;
  readonly VITE_GEMINI_API_KEY: string;
  readonly VITE_CLAUDE_API_KEY: string;
  readonly VITE_TAVILY_API_KEY: string;
  readonly VITE_ENCRYPTION_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
