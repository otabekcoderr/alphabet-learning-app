# Alifbo MVP — Review Implementation Report

## 1. Files Changed or Created in This Round

### Modified Files
- `src/logic/pedagogy.ts` — Added `MAX_UNVERIFIED_AHEAD = 3`, `getUnverifiedAheadCount`, `isBlockedByUnverifiedCap`, and updated `getNextRecommendedItem` to return `null` when capped.
- `src/logic/pin.ts` — Added per-install random salt (`generateInstallSalt`), 10-character recovery code (`generateRecoveryCode` via `crypto.getRandomValues` excluding `0/O/1/I/L`), `hashPin`/`hashRecoveryCode`, 5-attempt 30-second lockout (`MAX_PIN_ATTEMPTS = 5`, `PIN_LOCKOUT_MS = 30_000`), and `resetPinWithRecoveryCode`.
- `src/storage/progressStorage.ts` — Bumped `schemaVersion` to `3`, storing `pinSalt`, `recoveryCodeHash`, and `pinLockout` (strict validation, no `parentSessionActive` persisted).
- `src/utils/audioRecorder.ts` — Integrated `stepMicAutoStop` inside `startMicRecording` with manual stop support and idempotent cleanup.
- `src/components/ChildHome.tsx` — Added `"Ota-onang bilan ko'rib chiqamiz"` child-friendly pause card when `blockedByUnverifiedCap === true`.
- `src/components/PinModal.tsx` — Added one-time 10-character recovery code screen on PIN creation, 30-second lockout timer UI, recovery-code PIN reset without data loss, 2-second press-and-hold progress-erase reset with explicit warning, and child-lock notice.
- `src/components/LessonPlayer.tsx` — Added visible listening indicator (`"🎧 Tinglayapman... gapiring"`), `"Yana bir marta"` on 5s no-speech auto-stop, and non-blocking `unverified` continuation.
- `src/components/ParentCorner.tsx` — Updated PIN change flow for per-install salt & lockout state, added `limit: X/3` indicator on unverified items, and added child-lock note.
- `src/App.tsx` — Enforced in-memory-only `"Ota-ona yonida"` session auto-off (3-minute inactivity timer, lesson completion/exit, `visibilitychange: hidden`, and `window.blur`), plus unverified cap navigation back to `ChildHome`.
- `src/index.css` — Added styling for `.recovery-code-box`, `.btn-hold-erase`, `.listening-indicator`, `.pulse-dot`, and `.child-pause-*` with `>= 44px` tap targets.
- `src/logic/__tests__/pin.test.ts` — Expanded to 6 tests covering `crypto.getRandomValues` alphabet, per-install salt, 5-attempt 30s lockout, recovery-code reset, and PIN change.
- `src/logic/__tests__/pedagogy.test.ts` — Expanded to 10 tests covering curriculum decodability, 3-lesson unverified cap & parent unblock, mastery/spaced-repetition isolation, and `"Ota-ona yonida"` auto-off & non-persistence.
- `backend/generate_tts.py` — Removed the 6 `kamola_*`/`jasur_*` substituted duplicates, generated 3 `experiment_nnn_<voice>.mp3` clips, and updated `audio_review.csv` statuses.
- `package.json` — Added `"check:release": "node scripts/check_release.mjs"`.

### Created Files
- `src/logic/micAutoStop.ts` — Pure adaptive room-noise calibration & microphone auto-stop state machine (`MIC_AUTO_STOP_CONFIG`).
- `src/logic/parentSession.ts` — Pure `"Ota-ona yonida"` timeout & close-event helpers (`PARENT_SESSION_TIMEOUT_MS = 180_000`).
- `src/logic/__tests__/micAutoStop.test.ts` — 4 unit tests on synthetic RMS level streams.
- `letter_sound_recording_checklist.csv` — 14-letter recording sheet (`A, O, I, U, N, M, L, S, R, V, B, T, D, K`) with empty `teacher_says_it_as` for teacher input.
- `scripts/check_release.mjs` — Release gate script failing with exit code `1` while temporary audio files exist under `public/audio/`.
- `public/audio/voice_samples/experiment_nnn_shoira.mp3`, `experiment_nnn_lola.mp3`, `experiment_nnn_sevinch.mp3`.
- `REPORT.md` — This report.

---

## 2. `voice_samples/` Explanation (Why 15 Files Existed & Current 12 Files)

Originally, `generate_tts.py` ran `5` documented voice names (`shoira`, `lola`, `kamola`, `jasur`, `sevinch`) × `3` test items (`n`, `na`, `ona`) = `15` files. Inspecting the API responses revealed that `POST https://uzbekvoice.ai/api/v1/tts` accepted `shoira`, `lola`, and `sevinch` natively (`model_substituted=False`), whereas **`kamola` and `jasur` were silently substituted by the API (`model_substituted=True`, `actual_model=sevinch`)**, producing duplicate `sevinch` audio.

In this round:
- Deleted the 6 duplicate files: `kamola_n.mp3`, `kamola_na.mp3`, `kamola_ona.mp3`, `jasur_n.mp3`, `jasur_na.mp3`, `jasur_ona.mp3`.
- Kept the **9 core samples** (`3 voices × 3 items`):
  - `shoira_n.mp3` (`"n"`), `shoira_na.mp3` (`"na"`), `shoira_ona.mp3` (`"ona"`)
  - `lola_n.mp3` (`"n"`), `lola_na.mp3` (`"na"`), `lola_ona.mp3` (`"ona"`)
  - `sevinch_n.mp3` (`"n"`), `sevinch_na.mp3` (`"na"`), `sevinch_ona.mp3` (`"ona"`)
- Added **3 separate phonetic `"nnn"` experiment files**:
  - `experiment_nnn_shoira.mp3` (`"nnn"` in `shoira`)
  - `experiment_nnn_lola.mp3` (`"nnn"` in `lola`)
  - `experiment_nnn_sevinch.mp3` (`"nnn"` in `sevinch`)

---

## 3. Temporary Microsoft `edge-tts` Audio Files (70 Files — Not for Distribution)

All **70** temporary files generated earlier with `edge-tts` (`uz-UZ-MadinaNeural`) are marked `"temporary, not for distribution"` in `audio_review.csv` and must be replaced (by human-recorded letter sounds via `letter_sound_recording_checklist.csv` and the teacher-chosen UzbekVoice voice for syllables/words/instructions) before any public deployment:

- **14 letter-sound files (to be human-recorded):** `public/audio/sound_a.mp3`, `sound_o.mp3`, `sound_i.mp3`, `sound_u.mp3`, `sound_n.mp3`, `sound_m.mp3`, `sound_l.mp3`, `sound_s.mp3`, `sound_r.mp3`, `sound_v.mp3`, `sound_b.mp3`, `sound_t.mp3`, `sound_d.mp3`, `sound_k.mp3`
- **18 syllable & word files:** `public/audio/sound_na.mp3`, `sound_ma.mp3`, `sound_lo.mp3`, `sound_la.mp3`, `sound_ona.mp3`, `sound_non.mp3`, `sound_lola.mp3`, `sound_olma.mp3`, `sound_sa.mp3`, `sound_ro.mp3`, `sound_suv.mp3`, `sound_ba.mp3`, `sound_bo.mp3`, `sound_bola.mp3`, `sound_ta.mp3`, `sound_ota.mp3`, `sound_da.mp3`, `sound_kitob.mp3`
- **32 lesson instruction files:** `public/audio/item_a.mp3`, `item_o.mp3`, `item_i.mp3`, `item_u.mp3`, `item_n.mp3`, `item_m.mp3`, `item_l.mp3`, `item_na.mp3`, `item_ma.mp3`, `item_lo.mp3`, `item_la.mp3`, `item_ona.mp3`, `item_non.mp3`, `item_lola.mp3`, `item_olma.mp3`, `item_s.mp3`, `item_r.mp3`, `item_v.mp3`, `item_sa.mp3`, `item_ro.mp3`, `item_suv.mp3`, `item_b.mp3`, `item_ba.mp3`, `item_bo.mp3`, `item_bola.mp3`, `item_t.mp3`, `item_ta.mp3`, `item_ota.mp3`, `item_d.mp3`, `item_da.mp3`, `item_k.mp3`, `item_kitob.mp3`
- **6 UI prompt files:** `public/audio/barakalla.mp3`, `qayta_urinib_koring.mp3`, `qaysi_biri.mp3`, `ulab_oqiymiz.mp3`, `mikrofonga_ayting.mp3`, `jimlik_sezildi.mp3`

---

## 4. Privacy Evidence

### In-Memory Audio Decoding & Zero Disk/Log Enforcement in `backend/server.py`
- **`backend/server.py` lines 101–121 (`decode_audio_to_float32`)**:
  - Lines 105–108: Reads 16 kHz mono WAV strictly from `io.BytesIO(raw_bytes)`.
  - Lines 115–121: Otherwise pipes `raw_bytes` into `ffmpeg` via `input=raw_bytes` (`pipe:0`) and reads PCM16 from `proc.stdout` (`pipe:1`, `capture_output=True`) — never creates temp files on disk.
- **`backend/server.py` lines 152–227 (`handle_stt`)**:
  - Lines 158–185: Reads HTTP payload into RAM (`raw_bytes`), decodes in RAM (`wav`), and runs `trim_silence(wav)`.
  - Lines 206–227: Passes `trimmed` array to `ts_adapter.recognize`, evaluates match, and returns JSON response without calling `open()`, `write()`, `logging`, or `print()`.
- **`backend/server.py` line 272 (`web.run_app`)**:
  - Starts aiohttp with `access_log=None`.

### Repository-Wide Search Output (`backend/`, `src/`, `scripts/`)
Command executed in `d:\Loyihalarim\alifbo`:
```powershell
Get-ChildItem -Path backend, src, scripts -Recurse -File | Select-String -Pattern "open\(|write_text|write_bytes|writeFile|appendFile|save\("
Get-ChildItem -Path backend, src, scripts -Recurse -File | Select-String -Pattern "transcript|logging\.|print\(|console\.log"
Get-ChildItem -Path src, dist -Recurse -File -ErrorAction SilentlyContinue | Select-String -Pattern "4779485c|UZBEKVOICE_API_KEY"
```

Observed results:
```text
=== 1. Search disk writes across server/client/scripts ===
generate_tts.py:183: await comm.save(str(out_path))
generate_tts.py:235: with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
server.py:105: with wave.open(io.BytesIO(raw_bytes), "rb") as wf:
server.py:245: await comm.save(str(out_file))
App.tsx:227: setPinModalOpen(true);
App.tsx:390: setPinModalOpen(false);
App.tsx:394: onClose={() => setPinModalOpen(false)}
=== 2. Search transcript / logging across server/client/scripts ===
generate_tts.py:252: print(f"Removed substituted duplicate: {f.name}")
generate_tts.py:275: print(
generate_tts.py:287: print(f"  FAIL experiment_nnn_{voice}.mp3 -> HTTP {res['http_status']}: {res['error']}")
generate_tts.py:291: print(f"\nReview manifest updated: {csv_path}")
generate_tts.py:303: print(f"  sound_{item_id}.mp3 -> {'OK' if res['ok'] else res.get('error')}")
generate_tts.py:306: print(f"  item_{item_id}.mp3  -> {'OK' if res_t['ok'] else res_t.get('error')}")
generate_tts.py:311: print(f"  {key}.mp3 -> {'OK' if res['ok'] else res.get('error')}")
generate_tts.py:315: print(f"Full regeneration done with '{voice}'. Manifest: {csv_path}")
server.py:7: - No child audio, transcript, or normalized recognition output is ever logged
server.py:124: def evaluate_match(expected: str, accept_raw: str, transcript: str, is_silence: bool) -> bool:
server.py:125: if is_silence or not transcript.strip():
server.py:132: norm_tr = normalize_uzbek(transcript)
server.py:153: """In-memory speech recognition endpoint; zero disk writes, zero transcript logging."""
server.py:192: "transcript": "",
server.py:209: transcript = (res.text or "").strip()
server.py:210: is_silence = len(transcript) == 0
server.py:213: accepted = evaluate_match(expected, accept_raw, transcript, is_silence)
server.py:218: "transcript": transcript,
server.py:219: "normalized": normalize_uzbek(transcript),
server.py:251: print("Loading Uzinfocom FastConformer RNNT model...", flush=True)
server.py:256: print(f"Uzinfocom RNNT ready in {time.perf_counter() - t0:.2f}s", flush=True)
server.cpython-314.pyc:72: transcript
LessonPlayer.tsx:135: const evaluation = evaluateSpeechResult(item.text, item.accept, resp.transcript, resp.is_silence, nextAttempt);
pedagogy.ts:93: transcript: string,
pedagogy.ts:97: const normTranscript = normalizeUzbek(transcript);
pedagogy.ts:98: if (isSilence || !normTranscript) {
pedagogy.ts:114: if (acceptedSet.has(normTranscript)) {
audioRecorder.ts:215: transcript: string;
check_release.mjs:77: console.log('RELEASE CHECK PASSED: no temporary audio files exist under public/audio/.');
=== 3. Search secrets across src and dist ===
(0 matches)
```
*(Note: `server.py:245` is inside `handle_dev_tts`, which is not registered unless `ALIFBO_DEV_TTS=1` and handles TTS prompt text only, never child audio.)*

---

## 5. Real Command Output (`typecheck`, `test`, `build`, `check:release`)

```text
=== npm run typecheck ===

> alifbo@0.1.0 typecheck
> tsc --noEmit

EXIT:0
=== npm test ===

> alifbo@0.1.0 test
> vitest run


 RUN  v2.1.9 D:/Loyihalarim/alifbo

 ✓ src/logic/__tests__/micAutoStop.test.ts (4 tests) 4ms
 ✓ src/logic/__tests__/pin.test.ts (6 tests) 14ms
 ✓ src/logic/__tests__/pedagogy.test.ts (10 tests) 8ms

 Test Files  3 passed (3)
      Tests  20 passed (20)
   Start at  07:48:19
   Duration  693ms (transform 221ms, setup 0ms, collect 314ms, tests 27ms, environment 1ms, prepare 564ms)

EXIT:0
=== npm run build ===

> alifbo@0.1.0 build
> tsc --noEmit && vite build

vite v5.4.21 building for production...
transforming...
✓ 44 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.44 kB │ gzip:  0.31 kB
dist/assets/index-N4GIzIxh.css   13.74 kB │ gzip:  3.20 kB
dist/assets/index-D-DkVyrY.js   196.14 kB │ gzip: 62.02 kB
✓ built in 710ms
EXIT:0
=== npm run check:release ===

> alifbo@0.1.0 check:release
> node scripts/check_release.mjs

RELEASE CHECK FAILED: 70 temporary audio file(s) still present under public/audio/:
  - public/audio/sound_a.mp3
  - public/audio/item_a.mp3
  - public/audio/sound_o.mp3
  - public/audio/item_o.mp3
  - public/audio/sound_i.mp3
  - public/audio/item_i.mp3
  - public/audio/sound_u.mp3
  - public/audio/item_u.mp3
  - public/audio/sound_n.mp3
  - public/audio/item_n.mp3
  - public/audio/sound_m.mp3
  - public/audio/item_m.mp3
  - public/audio/sound_l.mp3
  - public/audio/item_l.mp3
  - public/audio/sound_na.mp3
  ... and 55 more.
EXIT:1
```

---

## 6. Decisions Made Beyond the Plan

1. **Press-and-hold timing & lockout propagation:** Used a `2000 ms` hold timer in `PinModal.tsx` with `touch-action: none` so mobile touch scrolling does not accidentally cancel or trigger the destructive progress reset; also shared the 5-attempt lockout counter across PIN entry, recovery code entry, and PIN change (`changePin` & `resetPinWithRecoveryCode`).
2. **State `schemaVersion: 3`:** Bumped `progressStorage.ts` `schemaVersion` from `2` to `3` because `AlifboState` added `pinSalt`, `recoveryCodeHash`, and `pinLockout`; any pre-existing v2 localStorage blob is preserved under `alifbo_app_state_backup_<timestamp>` without crashing.
3. **Rejection sampling for recovery codes:** `generateRecoveryCode` in `src/logic/pin.ts` uses rejection sampling (`byte < 256 - (256 % 31)`) on `crypto.getRandomValues` output so every character in the 31-character alphabet is uniformly distributed.
4. **`maxSpeechThreshold` cap in `micAutoStop.ts`:** Added `maxSpeechThreshold: 0.25` to `MIC_AUTO_STOP_CONFIG` so if calibration occurs during a momentary loud sound, the adapted threshold does not exceed `0.25` and lock out normal speech.
5. **Direct post-unverified lesson advance:** In `App.tsx`, completing an `unverified` lesson in `LessonPlayer` automatically closes `"Ota-ona yonida"` mode and advances directly to the next recommended lesson (or returns to `ChildHome` showing `"Ota-onang bilan ko'rib chiqamiz"` as soon as the 3-lesson cap is reached).

---

## 7. Open Questions

1. **UzbekVoice voice selection:** Listen to `shoira`, `lola`, and `sevinch` (and the 3 `experiment_nnn_*.mp3` files) in `public/audio/voice_samples/` — which voice should be used to regenerate the 56 non-letter-sound `.mp3` files (18 syllable/word `sound_*`, 32 `item_*`, and 6 UI clips)?
2. **Human-recorded isolated letter sounds:** When will a teacher fill `teacher_says_it_as` and record the 14 isolated letter sound files listed in `letter_sound_recording_checklist.csv` (`sound_a.mp3` .. `sound_k.mp3`) to replace the temporary TTS files?
3. **UzbekVoice commercial distribution permission:** Because `uzbekvoice.ai` does not publish a public Terms of Service / Ommaviy oferta page, written confirmation from UzbekVoice support regarding bundling generated static TTS `.mp3` files in a commercial app is still pending.
4. **Live child microphone accuracy:** The interactive web app microphone path (`LessonPlayer` + adaptive `micAutoStop` + `server.py`) has not yet been tested end-to-end with a real 6–7 year old child speaking into a live browser microphone.
