# Alifbo MVP — Project Rules

## Scope
- Implement only what the approved specification defines. Do not add unrequested features, UI extras, or unverified claims.
- Keep `AGENTS.md` workflow: plan first before major changes, work in verified steps, never claim checks passed without running them.

## Curriculum & Claims
- Curriculum decodability invariant: every `syllable` and `word` in `src/data/curriculum.ts` must use only letters introduced in an earlier (or same) `kind === 'letter'` lesson. Enforced by Vitest (`validateCurriculumDecodability`).
- Do not include unverified academic citations or effectiveness claims in UI text. Describe only what the app does and accurately note when local voice AI is vs is not available (static Netlify builds do not include the local ASR server).

## Child UX, PIN & Privacy
- Child home screen shows a Duolingo-style gamified adventure map (5 themed islands with S-curve lesson nodes locked ahead of the child's current progress, plus mascot hero card and primary "Davom etamiz" button), large tap targets (>= 44px), minimal text, and no technical status.
- Parent area is protected by a user-created 4-digit PIN (no default PIN, no math-question lock, SHA-256 hashed in `localStorage`).
- When AI is unavailable, child attempts save as `unverified` with effort stars only; `mastered` status and spaced-repetition state update only on AI acceptance or PIN-authenticated parent confirmation.
- `backend/server.py` processes child audio strictly in memory, never writes child audio to disk, and never logs or persists transcripts.
- All 102 child-facing audio clips under `public/audio/` are pre-generated statically (`voicelab:gulya` primary, with `voicelab:safiya` and `uzbekvoice:lola` fallback after credit limit); runtime `/api/tts` is disabled by default (`ALIFBO_DEV_TTS=1` dev-only).

## Code & Secrets
- TypeScript strict mode (`no `any``, no unsafe assertions). Pure business logic outside React components.
- UI text in Uzbek (Latin script); code, comments, identifiers in English.
- Secrets (`UZBEKVOICE_API_KEY`, `VOICELAB_API_KEY`) live only in `.env` or environment variables, read only by backend scripts, and `.env` must remain in `.gitignore`.
