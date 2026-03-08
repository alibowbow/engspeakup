import { generateSpeechAudio, GeminiSpeechError } from './gemini';

interface RecognitionOptions {
  lang?: string;
  onResult: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}

type RecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export interface GeminiTtsVoiceOption {
  name: string;
  tone: string;
  group: 'female' | 'male';
  sampleText: string;
}

interface CachedGeminiAudio {
  key: string;
  data: string;
  mimeType?: string;
  createdAt: number;
}

export type SpeakResult = 'gemini' | 'browser-fallback' | 'browser-fallback-daily' | 'none';

export const GEMINI_TTS_DEFAULT_VOICE = 'Kore';

export const GEMINI_TTS_VOICES: GeminiTtsVoiceOption[] = [
  { name: 'Aoede', tone: 'Breezy', group: 'female', sampleText: "Hi, I'm Aoede. Let's practice relaxed everyday English together." },
  { name: 'Autonoe', tone: 'Bright', group: 'female', sampleText: "Hi, I'm Autonoe. I'll help you sound brighter and more confident in English." },
  { name: 'Callirrhoe', tone: 'Easy-going', group: 'female', sampleText: "Hi, I'm Callirrhoe. Let's keep this English conversation easy and natural." },
  { name: 'Despina', tone: 'Smooth', group: 'female', sampleText: "Hi, I'm Despina. Let's make your English sound smoother and clearer." },
  { name: 'Erinome', tone: 'Clear', group: 'female', sampleText: "Hi, I'm Erinome. I'll read in a clear voice so you can shadow each sentence." },
  { name: 'Laomedeia', tone: 'Upbeat', group: 'female', sampleText: "Hi, I'm Laomedeia. Let's practice lively English with good energy." },
  { name: 'Leda', tone: 'Youthful', group: 'female', sampleText: "Hi, I'm Leda. Let's practice friendly and youthful English conversation." },
  { name: 'Pulcherrima', tone: 'Forward', group: 'female', sampleText: "Hi, I'm Pulcherrima. I'll give your English a more confident speaking rhythm." },
  { name: 'Sulafat', tone: 'Warm', group: 'female', sampleText: "Hi, I'm Sulafat. Let's practice English in a warm and encouraging tone." },
  { name: 'Vindemiatrix', tone: 'Gentle', group: 'female', sampleText: "Hi, I'm Vindemiatrix. Let's slow down and shape gentle, natural English." },
  { name: 'Achernar', tone: 'Soft', group: 'male', sampleText: "Hi, I'm Achernar. Let's practice English with a softer, calmer delivery." },
  { name: 'Achird', tone: 'Friendly', group: 'male', sampleText: "Hi, I'm Achird. Let's practice casual English that still sounds friendly and clean." },
  { name: 'Algenib', tone: 'Gravelly', group: 'male', sampleText: "Hi, I'm Algenib. Let's try a deeper English voice with a stronger texture." },
  { name: 'Algieba', tone: 'Smooth', group: 'male', sampleText: "Hi, I'm Algieba. I'll help you hear smoother English pacing and intonation." },
  { name: 'Alnilam', tone: 'Firm', group: 'male', sampleText: "Hi, I'm Alnilam. Let's practice firm and direct English responses." },
  { name: 'Charon', tone: 'Informative', group: 'male', sampleText: "Hi, I'm Charon. Let's practice informative English with steady delivery." },
  { name: 'Enceladus', tone: 'Breathy', group: 'male', sampleText: "Hi, I'm Enceladus. This voice is softer, lighter, and a little more airy." },
  { name: 'Fenrir', tone: 'Excitable', group: 'male', sampleText: "Hi, I'm Fenrir. Let's practice energetic English with stronger momentum." },
  { name: 'Gacrux', tone: 'Mature', group: 'male', sampleText: "Hi, I'm Gacrux. Let's practice mature, grounded English conversation." },
  { name: 'Iapetus', tone: 'Clear', group: 'male', sampleText: "Hi, I'm Iapetus. I'll keep the English pronunciation clear and steady." },
  { name: 'Kore', tone: 'Firm', group: 'male', sampleText: "Hi, I'm Kore. Let's train clear and confident English for real conversations." },
  { name: 'Orus', tone: 'Firm', group: 'male', sampleText: "Hi, I'm Orus. Let's practice stronger and more structured English replies." },
  { name: 'Puck', tone: 'Upbeat', group: 'male', sampleText: "Hi, I'm Puck. Let's keep your English upbeat, quick, and easy to follow." },
  { name: 'Rasalgethi', tone: 'Informative', group: 'male', sampleText: "Hi, I'm Rasalgethi. I'll read in a clear explanatory style for study." },
  { name: 'Sadachbia', tone: 'Lively', group: 'male', sampleText: "Hi, I'm Sadachbia. Let's make your English sound more lively and active." },
  { name: 'Sadaltager', tone: 'Knowledgeable', group: 'male', sampleText: "Hi, I'm Sadaltager. Let's practice polished English with a knowledgeable tone." },
  { name: 'Schedar', tone: 'Even', group: 'male', sampleText: "Hi, I'm Schedar. This voice keeps English balanced and even." },
  { name: 'Umbriel', tone: 'Easy-going', group: 'male', sampleText: "Hi, I'm Umbriel. Let's practice easy-going English that still sounds natural." },
  { name: 'Zephyr', tone: 'Bright', group: 'male', sampleText: "Hi, I'm Zephyr. Let's practice bright and clean English conversation together." },
  { name: 'Zubenelgenubi', tone: 'Casual', group: 'male', sampleText: "Hi, I'm Zubenelgenubi. Let's practice casual English you can actually use." },
];

const GEMINI_TTS_BLOCKED_DATE_KEY = 'speakup-studio-gemini-tts-blocked-date';
const GEMINI_TTS_SAMPLE_RATE = 24000;
const GEMINI_TTS_CACHE_DB = 'speakup-studio-audio-cache';
const GEMINI_TTS_CACHE_STORE = 'gemini-tts-previews';
const STATIC_VOICE_PREVIEW_BASE = '/voice-previews';

let activeAudioContext: AudioContext | null = null;
let activeAudioSource: AudioBufferSourceNode | null = null;
let activePreviewAudio: HTMLAudioElement | null = null;

function getRecognitionCtor(): RecognitionCtor | null {
  const recognition = (window as Window & {
    webkitSpeechRecognition?: RecognitionCtor;
    SpeechRecognition?: RecognitionCtor;
  }).SpeechRecognition ?? (window as Window & { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;
  return recognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return Boolean(getRecognitionCtor());
}

export function listenOnce({
  lang = 'en-US',
  onResult,
  onError,
  onEnd,
}: RecognitionOptions): (() => void) | null {
  const Recognition = getRecognitionCtor();
  if (!Recognition) {
    onError?.('이 브라우저는 음성 입력을 지원하지 않습니다.');
    return null;
  }

  const recognition = new Recognition();
  recognition.lang = lang;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim();
    if (transcript) {
      onResult(transcript);
    }
  };
  recognition.onerror = (event) => {
    onError?.(event.error || '음성 입력 중 오류가 발생했습니다.');
  };
  recognition.onend = () => {
    onEnd?.();
  };
  recognition.start();
  return () => recognition.stop();
}

export function loadVoices(): SpeechSynthesisVoice[] {
  return window.speechSynthesis?.getVoices?.() ?? [];
}

export function loadEnglishVoices(): SpeechSynthesisVoice[] {
  return loadVoices().filter((voice) => /^en(?:-|_|$)/i.test(voice.lang));
}

export function isGeminiTtsVoice(voiceName: string): boolean {
  return GEMINI_TTS_VOICES.some((voice) => voice.name === voiceName);
}

export function getGeminiTtsVoices(): GeminiTtsVoiceOption[] {
  return GEMINI_TTS_VOICES;
}

function getPacificDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function readBlockedDate(): string {
  try {
    return window.localStorage.getItem(GEMINI_TTS_BLOCKED_DATE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeBlockedDate(value: string): void {
  try {
    if (!value) {
      window.localStorage.removeItem(GEMINI_TTS_BLOCKED_DATE_KEY);
      return;
    }
    window.localStorage.setItem(GEMINI_TTS_BLOCKED_DATE_KEY, value);
  } catch {
    // Ignore storage failures. Audio fallback still works for the current tab.
  }
}

function isDailyQuotaBlocked(): boolean {
  const today = getPacificDateKey();
  const blockedDate = readBlockedDate();
  if (blockedDate && blockedDate !== today) {
    writeBlockedDate('');
    return false;
  }
  return blockedDate === today;
}

function openAudioCache(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const request = indexedDB.open(GEMINI_TTS_CACHE_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(GEMINI_TTS_CACHE_STORE)) {
        database.createObjectStore(GEMINI_TTS_CACHE_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readCachedAudio(key: string): Promise<CachedGeminiAudio | null> {
  const database = await openAudioCache();
  if (!database) {
    return null;
  }

  return new Promise((resolve) => {
    const transaction = database.transaction(GEMINI_TTS_CACHE_STORE, 'readonly');
    const store = transaction.objectStore(GEMINI_TTS_CACHE_STORE);
    const request = store.get(key);
    request.onsuccess = () => resolve((request.result as CachedGeminiAudio | undefined) ?? null);
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
  });
}

async function writeCachedAudio(entry: CachedGeminiAudio): Promise<void> {
  const database = await openAudioCache();
  if (!database) {
    return;
  }

  await new Promise<void>((resolve) => {
    const transaction = database.transaction(GEMINI_TTS_CACHE_STORE, 'readwrite');
    const store = transaction.objectStore(GEMINI_TTS_CACHE_STORE);
    store.put(entry);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      resolve();
    };
  });
}

async function deleteCachedAudio(key: string): Promise<void> {
  const database = await openAudioCache();
  if (!database) {
    return;
  }

  await new Promise<void>((resolve) => {
    const transaction = database.transaction(GEMINI_TTS_CACHE_STORE, 'readwrite');
    const store = transaction.objectStore(GEMINI_TTS_CACHE_STORE);
    store.delete(key);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      resolve();
    };
  });
}

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodePcm16(data: string): Float32Array {
  const bytes = base64ToBytes(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const pcm = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    pcm[index] = view.getInt16(index * 2, true) / 32768;
  }
  return pcm;
}

async function stopAudioPlayback(): Promise<void> {
  if (activeAudioSource) {
    try {
      activeAudioSource.stop();
    } catch {
      // Playback may already be stopped.
    }
    activeAudioSource.disconnect();
    activeAudioSource = null;
  }
  if (activeAudioContext) {
    const context = activeAudioContext;
    activeAudioContext = null;
    await context.close().catch(() => undefined);
  }
}

function stopPreviewPlayback(): void {
  if (!activePreviewAudio) {
    return;
  }
  activePreviewAudio.pause();
  activePreviewAudio.currentTime = 0;
  activePreviewAudio = null;
}

async function playGeminiAudio(data: string): Promise<void> {
  const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('Web Audio is not supported in this browser.');
  }

  await stopAudioPlayback();
  const context = new AudioContextCtor({ sampleRate: GEMINI_TTS_SAMPLE_RATE });
  activeAudioContext = context;
  await context.resume();

  const samples = decodePcm16(data);
  const buffer = context.createBuffer(1, samples.length, GEMINI_TTS_SAMPLE_RATE);
  buffer.getChannelData(0).set(samples);

  await new Promise<void>((resolve) => {
    const source = context.createBufferSource();
    activeAudioSource = source;
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      if (activeAudioSource === source) {
        activeAudioSource = null;
      }
      resolve();
    };
    source.start(0);
  });

  if (activeAudioContext === context) {
    activeAudioContext = null;
  }
  await context.close().catch(() => undefined);
}

function speakWithBrowser(text: string, rate = 1): Promise<'browser' | 'none'> {
  if (!window.speechSynthesis || !text.trim()) {
    return Promise.resolve('none');
  }

  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = loadEnglishVoices()[0];
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = 'en-US';
    }
    utterance.rate = rate;
    utterance.onend = () => resolve('browser');
    utterance.onerror = () => resolve('none');
    window.speechSynthesis.speak(utterance);
  });
}

function staticVoicePreviewUrl(voiceName: string): string {
  return `${STATIC_VOICE_PREVIEW_BASE}/${encodeURIComponent(voiceName)}.wav`;
}

async function playStaticVoicePreview(voiceName: string): Promise<boolean> {
  if (typeof Audio === 'undefined') {
    return false;
  }

  stopPreviewPlayback();
  window.speechSynthesis?.cancel?.();
  await stopAudioPlayback();

  return new Promise((resolve) => {
    const audio = new Audio(staticVoicePreviewUrl(voiceName));
    let finished = false;
    activePreviewAudio = audio;

    const done = (success: boolean) => {
      if (finished) {
        return;
      }
      finished = true;
      if (activePreviewAudio === audio) {
        activePreviewAudio = null;
      }
      resolve(success);
    };

    audio.onended = () => done(true);
    audio.onerror = () => done(false);
    audio.play().catch(() => done(false));
  });
}

export async function speakText({
  text,
  apiKey,
  voiceName,
  rate = 1,
  cacheKey,
}: {
  text: string;
  apiKey: string;
  voiceName: string;
  rate?: number;
  cacheKey?: string;
}): Promise<SpeakResult> {
  if (!text.trim()) {
    return 'none';
  }

  if (cacheKey) {
    const cached = await readCachedAudio(cacheKey);
    if (cached?.data) {
      try {
        window.speechSynthesis?.cancel?.();
        await playGeminiAudio(cached.data);
        return 'gemini';
      } catch {
        await deleteCachedAudio(cacheKey);
      }
    }
  }

  if (!apiKey.trim() || isDailyQuotaBlocked()) {
    const fallbackResult = await speakWithBrowser(text, rate);
    return fallbackResult === 'browser'
      ? isDailyQuotaBlocked()
        ? 'browser-fallback-daily'
        : 'browser-fallback'
      : 'none';
  }

  try {
    window.speechSynthesis?.cancel?.();
    const audio = await generateSpeechAudio({
      apiKey,
      text,
      voiceName: isGeminiTtsVoice(voiceName) ? voiceName : GEMINI_TTS_DEFAULT_VOICE,
      rate,
    });
    if (cacheKey && audio.data) {
      await writeCachedAudio({
        key: cacheKey,
        data: audio.data,
        mimeType: audio.mimeType,
        createdAt: Date.now(),
      });
    }
    await playGeminiAudio(audio.data);
    return 'gemini';
  } catch (error) {
    const isDailyQuotaError = error instanceof GeminiSpeechError && error.kind === 'quota-daily';
    if (isDailyQuotaError) {
      writeBlockedDate(getPacificDateKey());
    }
    const fallbackResult = await speakWithBrowser(text, rate);
    if (fallbackResult === 'browser') {
      return isDailyQuotaError ? 'browser-fallback-daily' : 'browser-fallback';
    }
    return 'none';
  }
}

export async function previewVoiceSample({
  text,
  apiKey,
  voiceName,
  rate = 1,
  cacheKey,
}: {
  text: string;
  apiKey: string;
  voiceName: string;
  rate?: number;
  cacheKey?: string;
}): Promise<SpeakResult | 'static-file'> {
  const staticPreviewPlayed = await playStaticVoicePreview(voiceName);
  if (staticPreviewPlayed) {
    return 'static-file';
  }

  return speakText({
    text,
    apiKey,
    voiceName,
    rate,
    cacheKey,
  });
}

export function stopSpeaking(): void {
  window.speechSynthesis?.cancel?.();
  stopPreviewPlayback();
  void stopAudioPlayback();
}
