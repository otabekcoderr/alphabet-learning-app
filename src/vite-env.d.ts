/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TELEGRAM_BOT_USERNAME?: string;
  readonly VITE_ASR_URL?: string;
  readonly VITE_TG_BOT_TOKEN?: string;
  readonly VITE_TG_CHAT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
