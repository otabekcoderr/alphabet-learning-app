import { useState, type FormEvent } from 'react';
import { CURRICULUM_ITEMS, type CurriculumItem } from '../data/curriculum';
import { getUnverifiedAheadCount, MAX_UNVERIFIED_AHEAD } from '../logic/pedagogy';
import { changePin, type PinLockoutState } from '../logic/pin';
import type { AlifboState } from '../storage/progressStorage';
import { verifyAudioWithStt, type SttApiResponse } from '../utils/audioRecorder';
import { StageMap } from './StageMap';

interface ParentCornerProps {
  state: AlifboState;
  aiOnline: boolean;
  parentSessionActive: boolean;
  reviewQueue: CurriculumItem[];
  onToggleParentSession: () => void;
  onConfirmUnverified: (itemId: string) => void;
  onSelectItem: (item: CurriculumItem) => void;
  onStartReview: () => void;
  onUpdatePinHash: (newHash: string, lockout: PinLockoutState) => void;
  onUpdateLockout: (lockout: PinLockoutState) => void;
  onResetProgress: () => void;
  onLockParentArea: () => void;
}

export function ParentCorner({
  state,
  aiOnline,
  parentSessionActive,
  reviewQueue,
  onToggleParentSession,
  onConfirmUnverified,
  onSelectItem,
  onStartReview,
  onUpdatePinHash,
  onUpdateLockout,
  onResetProgress,
  onLockParentArea,
}: ParentCornerProps) {
  const [diagResult, setDiagResult] = useState<SttApiResponse | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinMsg, setPinMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const masteredItems = CURRICULUM_ITEMS.filter((i) => state.progressByItem[i.id]?.mastered);
  const unverifiedAheadCount = getUnverifiedAheadCount(CURRICULUM_ITEMS, state.progressByItem);
  const unverifiedItems = CURRICULUM_ITEMS.filter((i) => {
    const p = state.progressByItem[i.id];
    return p && p.status === 'unverified' && !p.mastered;
  });

  const avgLatency =
    state.recentLatenciesMs.length > 0
      ? Math.round(state.recentLatenciesMs.reduce((a, b) => a + b, 0) / state.recentLatenciesMs.length)
      : null;

  const runDiagnosticSample = async () => {
    setDiagBusy(true);
    setDiagError(null);
    setDiagResult(null);
    try {
      const sampleRes = await fetch('/audio/sound_ona.mp3');
      const blob = await sampleRes.blob();
      const sttRes = await verifyAudioWithStt(blob, 'ONA', ['ona']);
      setDiagResult(sttRes);
    } catch (err) {
      setDiagError(err instanceof Error ? err.message : 'Lokal AI serveriga ulanib bo‘lmadi');
    } finally {
      setDiagBusy(false);
    }
  };

  const handlePinChange = (e: FormEvent) => {
    e.preventDefault();
    const res = changePin({
      salt: state.pinSalt,
      storedHash: state.pinHash,
      currentPin: currentPin.trim(),
      newPin: newPin.trim(),
      confirmPin: confirmPin.trim(),
      lockout: state.pinLockout,
      nowMs: Date.now(),
    });
    onUpdateLockout(res.lockout);

    if (!res.ok) {
      setPinMsg({ ok: false, text: res.errorUz });
      return;
    }
    onUpdatePinHash(res.pinHash, res.lockout);
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setPinMsg({ ok: true, text: 'PIN-kod muvaffaqiyatli yangilandi.' });
  };

  return (
    <div className="parent-corner">
      <section className="parent-card">
        <div className="parent-header-row">
          <div>
            <h2>👨‍👩‍👧 Ota-ona hududi</h2>
            <p className="muted-text">
              Darslar xaritasi, tasdiqlash, PIN sozlamalari va texnik holat. (PIN-kod bolalar uchun oddiy
              cheklovdir, kuchli kriptografik himoya emas.)
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={onLockParentArea}>
            🔒 Bolalar ekraniga qaytish
          </button>
        </div>

        <div className="parent-session-box">
          <div>
            <strong>👨‍👩‍👧 Ota-ona yonida rejimi: {parentSessionActive ? 'Yoqilgan' : 'O‘chiq'}</strong>
            <p className="muted-text">
              Yoqilganda darsning 4-qadamida «To‘g‘ri o‘qidi (Ota-ona tasdig‘i)» tugmasi ochiladi. Dars
              tugaganda, ilova fonga o‘tganda yoki 3 daqiqa harakatsizlikda avtomatik o‘chadi va saqlanmaydi.
            </p>
          </div>
          <button
            type="button"
            className={parentSessionActive ? 'btn-primary' : 'btn-secondary'}
            onClick={onToggleParentSession}
          >
            {parentSessionActive ? '✅ Yoqilgan (O‘chirish)' : 'Yoqish'}
          </button>
        </div>
      </section>

      {unverifiedItems.length > 0 && (
        <section className="parent-card">
          <h3>
            ⏳ Tasdiqlashni kutayotgan darslar ({unverifiedItems.length} ta · limit: {unverifiedAheadCount}/
            {MAX_UNVERIFIED_AHEAD})
          </h3>
          <p className="muted-text">
            Bola AI serverisiz mashq qilgan darslar «tasdiqlanmagan» holatida saqlangan. Oxirgi tasdiqlangan
            darsdan keyin ko‘pi bilan {MAX_UNVERIFIED_AHEAD} ta tasdiqlanmagan darsga ruxsat beriladi.
          </p>
          <div className="unverified-list">
            {unverifiedItems.map((item) => (
              <div key={item.id} className="unverified-row">
                <div>
                  <strong>{item.text}</strong>{' '}
                  <span className="muted-text">
                    ({item.stage}-bosqich · harakat yulduzi: {state.progressByItem[item.id]?.effortStars ?? 1})
                  </span>
                </div>
                <button type="button" className="btn-primary" onClick={() => onConfirmUnverified(item.id)}>
                  ✅ Tasdiqlash (O‘zlashtirdi)
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="parent-card">
        <h3>📊 Ko‘rsatkichlar va Texnik holat</h3>
        <div className="stats-row">
          <div className="stat-pill">
            <span className="stat-num">
              {masteredItems.length} / {CURRICULUM_ITEMS.length}
            </span>
            <span className="stat-label">Tasdiqlangan darslar</span>
          </div>
          <div className="stat-pill">
            <span className="stat-num">⭐ {state.totalStars}</span>
            <span className="stat-label">O‘zlashtirish yulduzlari</span>
          </div>
          <div className="stat-pill">
            <span className="stat-num">🌟 {state.totalEffortStars}</span>
            <span className="stat-label">Harakat yulduzlari</span>
          </div>
          <div className="stat-pill">
            <span className="stat-num">{state.practiceDates.length} kun</span>
            <span className="stat-label">Mashg‘ulot kunlari</span>
          </div>
          <div className="stat-pill">
            <span className="stat-num">{avgLatency !== null ? `${avgLatency} ms` : '—'}</span>
            <span className="stat-label">O‘rtacha AI tezligi</span>
          </div>
        </div>

        <div className="tech-status-bar">
          <span className={`ai-badge ${aiOnline ? 'ai-ready' : 'ai-offline'}`}>
            {aiOnline ? '🟢 Uzinfocom AI serveri tayyor' : '🔴 Lokal AI server ulanmagan'}
          </span>
          <button
            type="button"
            disabled={!aiOnline || diagBusy}
            className="btn-test-ai"
            onClick={() => void runDiagnosticSample()}
          >
            {diagBusy ? '⏳ Tekshirilmoqda...' : '🧪 Sinov ovoz (AI ni tekshirish)'}
          </button>
        </div>

        {diagResult && (
          <div className="feedback-banner feedback-success" style={{ marginTop: 12 }}>
            Sinov ovoz («ONA») natijasi: <strong>{diagResult.accepted ? 'Qabul qilindi' : 'Rad etildi'}</strong> ·
            Tezlik: <strong>{diagResult.latency_ms} ms</strong> · Qisqartirilgan audio:{' '}
            <strong>
              {diagResult.trimmed_ms} ms / {diagResult.orig_ms} ms
            </strong>
          </div>
        )}
        {diagError && (
          <div className="feedback-banner feedback-gentle" style={{ marginTop: 12 }}>
            {diagError}
          </div>
        )}

        <h4 className="history-title">Darslar tarixi</h4>
        {Object.keys(state.progressByItem).length === 0 ? (
          <p className="muted-text">Hali mashqlar bajarilmagan.</p>
        ) : (
          <div className="history-table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Dars</th>
                  <th>Holat</th>
                  <th>Yulduzlar</th>
                  <th>Urinishlar</th>
                  <th>Tezlik</th>
                </tr>
              </thead>
              <tbody>
                {CURRICULUM_ITEMS.filter((i) => state.progressByItem[i.id]).map((item) => {
                  const p = state.progressByItem[item.id]!;
                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.text}</strong>
                      </td>
                      <td>
                        {p.mastered
                          ? p.parentVerified
                            ? '👨‍👩‍👧 Ota-ona tasdiqlagan'
                            : '⭐ AI tasdiqlagan'
                          : '⏳ Tasdiqlanmagan'}
                      </td>
                      <td>
                        ⭐ {p.stars} · 🌟 {p.effortStars}
                      </td>
                      <td>{p.voiceAttempts}</td>
                      <td>{p.lastLatencyMs !== null ? `${p.lastLatencyMs} ms` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="parent-card">
        <StageMap
          progressByItem={state.progressByItem}
          reviewQueue={reviewQueue}
          onSelectItem={onSelectItem}
          onStartReview={onStartReview}
        />
      </section>

      <section className="parent-card">
        <h3>ℹ️ Ilova qanday ishlaydi</h3>
        <div className="methodology-grid">
          <div className="method-box">
            <h4>1. Rangli ko‘rinish</h4>
            <p>
              Unli harflar (A, O, I, U) qizil rangda, undosh harflar (N, M, L, S, R, V, B, T, D, K) ko‘k rangda
              ko‘rsatiladi.
            </p>
          </div>
          <div className="method-box">
            <h4>2. Darslar tartibi</h4>
            <p>
              Darslar avval A, O, I, U, N, M, L harflari va bo‘g‘inlaridan boshlanadi, keyin S, R, V hamda B, T, D, K
              harflari va so‘zlariga o‘tiladi.
            </p>
          </div>
          <div className="method-box">
            <h4>3. Harflar ketma-ketligi</h4>
            <p>
              Har bir bo‘g‘in va so‘z faqat avvalgi darslarda alohida harf darsi sifatida tanishtirilgan harflardan
              tuzilgan.
            </p>
          </div>
          <div className="method-box">
            <h4>4. Ovoz tekshiruvi va Netlify</h4>
            <p>
              Lokal ovoz serveri (<code>server.py</code>) ishga tushirilgan bo‘lsa, ovoz tekshiruvi shu qurilmadagi lokal
              model (<code>OpenVoiceOS/asr-uz-fastconformer-large-onnx</code>) orqali bajariladi. Statik (Netlify)
              versiyada lokal model bo‘lmaydi.
            </p>
          </div>
        </div>

        <p className="muted-text" style={{ marginTop: 14, fontSize: 13 }}>
          Model litsenziyalari: <code>uzinfocom-edu-ai/asr-uz-fastconformer-large</code> va{' '}
          <code>OpenVoiceOS/asr-uz-fastconformer-large-onnx</code> (Apache-2.0); asosiy model{' '}
          <code>nvidia/stt_uz_fastconformer_hybrid_large_pc</code> (CC-BY-4.0). Lokal ovoz serveri audioni faqat
          tezkor xotirada qayta ishlaydi, diskka yozmaydi va transkriptlarni saqlamaydi.
        </p>
      </section>

      <section className="parent-card">
        <h3>🔑 PIN-kodni o‘zgartirish</h3>
        <form onSubmit={handlePinChange} className="pin-change-form">
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="Amaldagi PIN"
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="pin-input-sm"
          />
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="Yangi PIN (4 raqam)"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="pin-input-sm"
          />
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="Yangi PIN tasdig‘i"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="pin-input-sm"
          />
          <button type="submit" className="btn-secondary">
            PIN-kodni yangilash
          </button>
        </form>
        {pinMsg && (
          <div className={`feedback-banner ${pinMsg.ok ? 'feedback-success' : 'feedback-gentle'}`} style={{ marginTop: 10 }}>
            {pinMsg.text}
          </div>
        )}

        <div className="danger-zone">
          <button type="button" className="btn-reset" onClick={onResetProgress}>
            Barcha natijalarni tozalash
          </button>
        </div>
      </section>
    </div>
  );
}
