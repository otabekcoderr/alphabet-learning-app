export interface AssetManifestEntry {
  id: string;
  nameUz: string;
  path: string;
  kind: 'vector_svg' | 'asr_model' | 'audio';
  originUz: string;
  license: string;
}

export const ASSET_LICENSE_MANIFEST: AssetManifestEntry[] = [
  {
    id: 'mascot_zukko_tulki',
    nameUz: 'Zukko Tulki maskoti va Alifbo logotipi',
    path: 'public/images/zukko.webp, public/images/logo.webp',
    kind: 'vector_svg',
    originUz: 'Alifbo loyihasi uchun maxsus tayyorlangan shaffof WebP maskot va brend logotipi',
    license: 'First-Party Original Asset (Loyiha mulki / MIT)',
  },
  {
    id: 'custom_uzbek_word_svgs',
    nameUz: 'Maxsus o‘zbekcha so‘z illustratsiyalari (29 ta)',
    path: 'public/images/words/*.svg',
    kind: 'vector_svg',
    originUz: 'Alifbo 2.2 uchun maxsus chizilgan bolalarbop SVG rasmlar (anor, doska, dasturxon, paxta va boshqalar)',
    license: 'First-Party Original Asset (Loyiha mulki / MIT)',
  },
  {
    id: 'local_twemoji_svgs',
    nameUz: 'Lokal Twemoji vektor kutubxonasi (121 ta)',
    path: 'public/images/emoji/*.svg',
    kind: 'vector_svg',
    originUz: 'jdecked/twemoji v15.1.0 lokal saqlangan SVG ikonkalari (tizim emojilarisiz barcha qurilmalarda bir xil ko‘rinish)',
    license: 'CC-BY 4.0 (Twitter / jdecked Twemoji)',
  },
  {
    id: 'sfx_howler_wavs',
    nameUz: 'Interaktiv o‘yin tovush effektlari (Howler.js)',
    path: 'public/audio/sfx/*.wav',
    kind: 'audio',
    originUz: 'Taktil tugma bosilishi, marimba, yutuq qo‘ng‘irog‘i va g‘alaba fanfarasi uchun lokal WAV effektlari',
    license: 'First-Party Original Asset (Loyiha mulki / MIT)',
  },
  {
    id: 'asr_fastconformer_uz',
    nameUz: 'Lokal ovoz aniqlash modeli (ixtiyoriy lokal server)',
    path: 'backend/server.py',
    kind: 'asr_model',
    originUz: 'uzinfocom-edu-ai/asr-uz-fastconformer-large va OpenVoiceOS/asr-uz-fastconformer-large-onnx',
    license: 'Apache-2.0 (asosiy model: nvidia/stt_uz_fastconformer_hybrid_large_pc — CC-BY-4.0)',
  },
  {
    id: 'audio_voicelab_malika',
    nameUz: 'VoiceLab Lison v2 (Malika) offline ovozli to‘plam',
    path: 'public/audio/*.mp3',
    kind: 'audio',
    originUz: 'Yagona VoiceLab Lison v2 (Malika) ovoz modeli orqali oldindan generatsiya qilingan statik MP3 audiolari',
    license: 'Alifbo 2.3.1 VoiceLab Lison v2 (Malika) yagona ovoz paketi',
  },
];
