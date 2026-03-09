import type {
  AnalysisEntry,
  ExportBundle,
  Session,
  Settings,
  VocabularyCard,
} from '../types';
import { GEMINI_TTS_DEFAULT_VOICE, isGeminiTtsVoice } from './speech';

export const STORAGE_KEYS = {
  settings: 'speakup-studio-settings',
  sessions: 'speakup-studio-sessions',
  analyses: 'speakup-studio-analyses',
  vocabulary: 'speakup-studio-vocabulary',
  activeSessionId: 'speakup-studio-active-session-id',
};

export const defaultSettings: Settings = {
  apiKey: '',
  model: 'gemini-3-flash-preview',
  saveApiKey: false,
  themeMode: 'light',
  userName: '',
  coachMode: 'balanced',
  voiceName: GEMINI_TTS_DEFAULT_VOICE,
  speechRate: 1,
  autoSpeakAi: false,
  dailyMinutesGoal: 20,
};

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadSettings(): Settings {
  const settings = safeRead<Settings>(STORAGE_KEYS.settings, defaultSettings);
  return {
    ...defaultSettings,
    ...settings,
    model:
      settings.model === defaultSettings.model
        ? settings.model
        : defaultSettings.model,
    voiceName: isGeminiTtsVoice(settings.voiceName) ? settings.voiceName : defaultSettings.voiceName,
    apiKey: settings.saveApiKey ? settings.apiKey ?? '' : '',
  };
}

export function saveSettings(settings: Settings): void {
  const sanitized = {
    ...settings,
    model: defaultSettings.model,
  };
  const next = sanitized.saveApiKey
    ? sanitized
    : { ...sanitized, apiKey: '' };
  window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(next));
}

export function loadSessions(): Session[] {
  return safeRead<Session[]>(STORAGE_KEYS.sessions, []);
}

export function saveSessions(sessions: Session[]): void {
  window.localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
}

export function loadAnalyses(): AnalysisEntry[] {
  return safeRead<AnalysisEntry[]>(STORAGE_KEYS.analyses, []);
}

export function saveAnalyses(analyses: AnalysisEntry[]): void {
  window.localStorage.setItem(STORAGE_KEYS.analyses, JSON.stringify(analyses));
}

export function loadVocabulary(): VocabularyCard[] {
  return safeRead<VocabularyCard[]>(STORAGE_KEYS.vocabulary, []);
}

export function saveVocabulary(cards: VocabularyCard[]): void {
  window.localStorage.setItem(STORAGE_KEYS.vocabulary, JSON.stringify(cards));
}

export function loadActiveSessionId(): string {
  return window.localStorage.getItem(STORAGE_KEYS.activeSessionId) ?? '';
}

export function saveActiveSessionId(sessionId: string): void {
  if (!sessionId) {
    window.localStorage.removeItem(STORAGE_KEYS.activeSessionId);
    return;
  }
  window.localStorage.setItem(STORAGE_KEYS.activeSessionId, sessionId);
}

export function clearWorkspace(): void {
  Object.values(STORAGE_KEYS).forEach((key) => window.localStorage.removeItem(key));
}

export function createExportBundle(
  settings: Settings,
  sessions: Session[],
  analyses: AnalysisEntry[],
  vocabulary: VocabularyCard[],
): ExportBundle {
  const { apiKey: _apiKey, ...safeSettings } = settings;
  return {
    settings: safeSettings,
    sessions,
    analyses,
    vocabulary,
  };
}

export async function parseImportFile(file: File): Promise<ExportBundle> {
  const raw = await file.text();
  const parsed = JSON.parse(raw) as ExportBundle;
  return {
    settings: {
      ...defaultSettings,
      ...parsed.settings,
    },
    sessions: parsed.sessions ?? [],
    analyses: parsed.analyses ?? [],
    vocabulary: parsed.vocabulary ?? [],
  };
}
