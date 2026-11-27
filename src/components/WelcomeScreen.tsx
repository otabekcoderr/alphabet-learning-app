import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DYNAMIC_WORD_POOL } from '../data/curriculum';
import { BookOpen, Compass, Mic, Sparkles, Volume2 } from './Icons';
import { CloseIcon } from './Icons';
import { StorybookBackdrop } from './StorybookBackdrop';
import { playAudioClip, playFeedbackChime } from '../utils/audioRecorder';

interface WelcomeScreenProps {
  onStartFree: () => void;
  onTryNow: () => void;
  onLogin: () => void;
  onOpenParents: () => void;
}

type InfoModalTopic = 'games' | 'about' | 'method' | null;

const FLOATING_TILES = [
  { letter: 'A', audio: '/audio/letter_a.mp3', className: 'welcome-cube-a' },
  { letter: "O‘", audio: '/audio/letter_o_apostrophe.mp3', className: 'welcome-cube-oap' },
  { letter: 'K', audio: '/audio/letter_k.mp3', className: 'welcome-cube-k' },
  { letter: 'B', audio: '/audio/letter_b.mp3', className: 'welcome-cube-b' },
] as const;

export function WelcomeScreen({
  onStartFree,
  onTryNow,
  onLogin,
  onOpenParents,
}: WelcomeScreenProps) {
  const [infoTopic, setInfoTopic] = useState<InfoModalTopic>(null);

  return (
    <div className="welcome-page-shell">
      <StorybookBackdrop />

      <header className="welcome-header">
        <div className="welcome-brand">
          <img src="/images/logo.webp" alt="Alifbo" className="brand-logo-img" draggable={false} />
        </div>

        <nav className="welcome-nav-links" aria-label="Asosiy ma’lumot">
          <button
            type="button"
            className="welcome-nav-link"
            onClick={() => {
              playFeedbackChime('pop');
              setInfoTopic('games');
            }}
          >
            O‘yinlar
          </button>
          <button
            type="button"
            className="welcome-nav-link"
            onClick={() => {
              playFeedbackChime('pop');
              setInfoTopic('about');
            }}
          >
            Biz haqimizda
          </button>
          <button
            type="button"
            className="welcome-nav-link"
            onClick={() => {
              playFeedbackChime('pop');
              setInfoTopic('method');
            }}
          >
            Usulimiz
          </button>
        </nav>

        <div className="welcome-header-actions">
          <button
            type="button"
            className="welcome-login-link"
            onClick={() => {
              playFeedbackChime('pop');
              onLogin();
            }}
          >
            Kirish
          </button>
          <button
            type="button"
            className="welcome-parent-pill btn-3d-cream"
            onClick={() => {
              playFeedbackChime('pop');
              onOpenParents();
            }}
          >
            Ota-onalar uchun
          </button>
        </div>
      </header>

      <main className="welcome-hero">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          className="welcome-hero-copy"
        >
          <span className="welcome-age-pill">
            <span>5–7 yoshli bolalar uchun</span>
            <Sparkles size={16} />
          </span>

          <h1 className="welcome-headline">
            O‘qishni o‘yin orqali o‘rganamiz!
          </h1>

          <p className="welcome-subheadline">
            Zukko tulki bilan harflar, bo‘g‘inlar va ravon o‘qish sarguzashti
          </p>

          <div className="welcome-cta-row">
            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="btn-3d-emerald welcome-btn-start"
              onClick={() => {
                playFeedbackChime('pop');
                onStartFree();
              }}
            >
              <span>Bepul boshlash</span>
              <img
                src="/images/zukko.webp"
                alt=""
                aria-hidden="true"
                className="welcome-cta-fox"
                draggable={false}
              />
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="btn-3d-cream welcome-btn-try"
              onClick={() => {
                playFeedbackChime('pop');
                onTryNow();
              }}
            >
              Sinab ko‘rish
            </motion.button>
          </div>

          <div className="welcome-feature-pills">
            <span className="welcome-feature-pill">
              <span className="feature-icon-badge badge-sky">
                <Compass size={16} />
              </span>
              <span>5 ta olam</span>
            </span>
            <span className="welcome-feature-pill">
              <span className="feature-icon-badge badge-orange">
                <Mic size={16} />
              </span>
              <span>Ovozli tekshiruv</span>
            </span>
            <span className="welcome-feature-pill">
              <span className="feature-icon-badge badge-emerald">
                <BookOpen size={16} />
              </span>
              <span>{DYNAMIC_WORD_POOL.length} ta so‘z</span>
            </span>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 22, delay: 0.08 }}
          className="welcome-hero-visual"
          aria-label="Zukko tulki bilan o‘yin namoyishi"
        >
          <div className="welcome-visual-halo" aria-hidden="true" />
          <div className="welcome-dots-grid welcome-dots-top" aria-hidden="true" />
          <div className="welcome-dots-grid welcome-dots-bottom" aria-hidden="true" />

          <motion.img
            src="/images/zukko.webp"
            alt="Zukko Tulki maskoti"
            className="welcome-mascot-hero"
            draggable={false}
            animate={{ y: [0, -9, 0] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
          />

          {FLOATING_TILES.map((tile, idx) => (
            <motion.button
              key={tile.letter}
              type="button"
              aria-label={`${tile.letter} harf tovushini eshitish`}
              className={`welcome-float-cube ${tile.className}`}
              animate={{ y: [0, idx % 2 === 0 ? -7 : 7, 0] }}
              transition={{ duration: 2.8 + idx * 0.35, repeat: Infinity, ease: 'easeInOut' }}
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => {
                playFeedbackChime('marimba');
                void playAudioClip(tile.audio);
              }}
            >
              {tile.letter}
            </motion.button>
          ))}

          <motion.button
            type="button"
            className="welcome-audio-pill welcome-audio-pill-right"
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 3.1, repeat: Infinity, ease: 'easeInOut' }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              playFeedbackChime('pop');
              void playAudioClip('/audio/sound_kitob.mp3', 'Kitob');
            }}
          >
            <span className="syllable-pill-text">KI-TOB</span>
            <span className="syllable-pill-speaker">
              <Volume2 size={16} />
            </span>
          </motion.button>

          <motion.button
            type="button"
            className="welcome-audio-pill welcome-audio-pill-left"
            animate={{ y: [0, 5, 0] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              playFeedbackChime('pop');
              void playAudioClip('/audio/sound_ona.mp3', 'Ona');
            }}
          >
            <span className="syllable-pill-text">O-NA</span>
            <span className="syllable-pill-speaker">
              <Volume2 size={16} />
            </span>
          </motion.button>
        </motion.section>
      </main>

      <AnimatePresence>
        {infoTopic && (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-info-title"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 10 }}
              className="modal-card welcome-info-modal"
            >
              <div className="modal-header-row">
                <h2 id="welcome-info-title" className="modal-title">
                  {infoTopic === 'games'
                    ? '5 ta O‘qish Olami va O‘yinlar'
                    : infoTopic === 'about'
                      ? 'Alifbo haqida'
                      : '3 bosqichli ravon o‘qish usuli'}
                </h2>
                <button
                  type="button"
                  className="btn-circle-close"
                  onClick={() => {
                    playFeedbackChime('pop');
                    setInfoTopic(null);
                  }}
                  aria-label="Yopish"
                >
                  <CloseIcon size={18} />
                </button>
              </div>

              {infoTopic === 'games' && (
                <ul className="welcome-info-list">
                  <li>
                    <strong>Bo‘g‘in konstruktori va Pufakchalar:</strong> Bolalar bo‘g‘inlarni birlashtirib so‘z yasaydi.
                  </li>
                  <li>
                    <strong>So‘z ovchisi:</strong> Rasmga mos bo‘g‘inli so‘zni topib, ovoz chiqarib o‘qiydi.
                  </li>
                  <li>
                    <strong>29 ta harf + tutuq belgisi:</strong> O‘zbek lotin alifbosini tovush va rasm bilan mustahkamlaydi.
                  </li>
                </ul>
              )}

              {infoTopic === 'about' && (
                <p className="welcome-info-copy">
                  Alifbo — 5–8 yoshli bolalarga 1-sinf «Alifbe» ketma-ketligida harflardan bo‘g‘inga va ravon
                  o‘qishga o‘tishda yordam beruvchi o‘zbekcha interaktiv ta’lim o‘yini.
                </p>
              )}

              {infoTopic === 'method' && (
                <ol className="welcome-info-list">
                  <li>
                    <strong>1-bosqich — Qurish:</strong> Bo‘g‘inlar va harf bloklari bilan so‘zni yig‘ish.
                  </li>
                  <li>
                    <strong>2-bosqich — Fonarcha:</strong> Bo‘g‘inlarni yoritib o‘qish va rasmga moslash.
                  </li>
                  <li>
                    <strong>3-bosqich — Mustaqil imtihon:</strong> Rasmsiz mustaqil o‘qish (ovozli yoki 4 rasmli tekshiruv).
                  </li>
                </ol>
              )}

              <button
                type="button"
                className="btn-3d-emerald"
                style={{ width: '100%' }}
                onClick={() => {
                  playFeedbackChime('pop');
                  setInfoTopic(null);
                  onStartFree();
                }}
              >
                Bepul boshlash
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
