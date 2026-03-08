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
}

export type SpeakResult = 'gemini' | 'browser-fallback' | 'browser-fallback-daily' | 'none';

export const GEMINI_TTS_DEFAULT_VOICE = 'Kore';

export const GEMINI_TTS_VOICES: GeminiTtsVoiceOption[] = [
  { name: 'Zephyr', tone: 'Bright' },
  { name: 'Puck', tone: 'Upbeat' },
  { name: 'Charon', tone: 'Informative' },
  { name: 'Kore', tone: 'Firm' },
  { name: 'Fenrir', tone: 'Excitable' },
  { name: 'Leda', tone: 'Youthful' },
  { name: 'Orus', tone: 'Firm' },
  { name: 'Aoede', tone: 'Breezy' },
  { name: 'Callirrhoe', tone: 'Easy-going' },
  { name: 'Autonoe', tone: 'Bright' },
  { name: 'Enceladus', tone: 'Breathy' },
  { name: 'Iapetus', tone: 'Clear' },
  { name: 'Umbriel', tone: 'Easy-going' },
  { name: 'Algieba', tone: 'Smooth' },
  { name: 'Despina', tone: 'Smooth' },
  { name: 'Erinome', tone: 'Clear' },
  { name: 'Algenib', tone: 'Gravelly' },
  { name: 'Rasalgethi', tone: 'Informative' },
  { name: 'Laomedeia', tone: 'Upbeat' },
  { name: 'Achernar', tone: 'Soft' },
  { name: 'Alnilam', tone: 'Firm' },
  { name: 'Schedar', tone: 'Even' },
  { name: 'Gacrux', tone: 'Mature' },
  { name: 'Pulcherrima', tone: 'Forward' },
  { name: 'Achird', tone: 'Friendly' },
  { name: 'Zubenelgenubi', tone: 'Casual' },
  { name: 'Vindemiatrix', tone: 'Gentle' },
  { name: 'Sadachbia', tone: 'Lively' },
  { name: 'Sadaltager', tone: 'Knowledgeable' },
  { name: 'Sulafat', tone: 'Warm' },
];

const GEMINI_TTS_BLOCKED_DATE_KEY = 'speakup-studio-gemini-tts-blocked-date';
const GEMINI_TTS_SAMPLE_RATE = 24000;

let activeAudioContext: AudioContext | null = null;
let activeAudioSource: AudioBufferSourceNode | null = null;

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

export async function speakText({
  text,
  apiKey,
  voiceName,
  rate = 1,
}: {
  text: string;
  apiKey: string;
  voiceName: string;
  rate?: number;
}): Promise<SpeakResult> {
  if (!text.trim()) {
    return 'none';
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

export function stopSpeaking(): void {
  window.speechSynthesis?.cancel?.();
  void stopAudioPlayback();
}
