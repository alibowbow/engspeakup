import type { LearnLanguage } from '../types';

export interface LanguageConfig {
  code: LearnLanguage;
  /** Korean UI label. */
  label: string;
  /** Short chip label. */
  short: string;
  flag: string;
  /** Name used inside English-language AI prompts and TTS instructions. */
  promptLabel: string;
  /** BCP-47 tag for Web Speech recognition + synthesis. */
  speechLang: string;
  composerPlaceholder: string;
  /** Tiny native greeting used in offline openers. */
  hello: string;
}

export const LANGUAGES: Record<LearnLanguage, LanguageConfig> = {
  en: {
    code: 'en',
    label: '영어',
    short: 'EN',
    flag: '🇺🇸',
    promptLabel: 'English',
    speechLang: 'en-US',
    composerPlaceholder: '영어로 다음 문장을 입력해 보세요',
    hello: 'Hi there!',
  },
  ja: {
    code: 'ja',
    label: '일본어',
    short: '日本語',
    flag: '🇯🇵',
    promptLabel: 'Japanese',
    speechLang: 'ja-JP',
    composerPlaceholder: '일본어로 다음 문장을 입력해 보세요 (예: すみません…)',
    hello: 'こんにちは！',
  },
};

export const LANGUAGE_LIST: LanguageConfig[] = [LANGUAGES.en, LANGUAGES.ja];

export function languageConfig(code: LearnLanguage): LanguageConfig {
  return LANGUAGES[code] ?? LANGUAGES.en;
}

export function languageName(code: LearnLanguage): string {
  return languageConfig(code).promptLabel;
}
