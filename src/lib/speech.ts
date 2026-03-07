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

export function speakText(text: string, voiceName: string, rate = 1): void {
  if (!window.speechSynthesis || !text.trim()) {
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = loadVoices().find((item) => item.name === voiceName);
  if (voice) {
    utterance.voice = voice;
  }
  utterance.rate = rate;
  utterance.lang = voice?.lang ?? 'en-US';
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  window.speechSynthesis?.cancel?.();
}
