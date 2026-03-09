import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadSettings, defaultSettings, STORAGE_KEYS } from './storage';

describe('loadSettings', () => {
  const STORAGE_KEY = STORAGE_KEYS.settings;

  beforeEach(() => {
    // Clear localStorage mock before each test
    window.localStorage.clear();
    // Clear all mocks
    vi.clearAllMocks();
  });

  it('returns defaultSettings when localStorage is empty', () => {
    const settings = loadSettings();
    expect(settings).toEqual(defaultSettings);
  });

  it('returns defaultSettings when localStorage has invalid JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, '{ invalid json ]');
    const settings = loadSettings();
    expect(settings).toEqual(defaultSettings);
  });

  it('merges stored settings with defaultSettings for missing properties', () => {
    const partialSettings = {
      themeMode: 'dark',
      speechRate: 1.5,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(partialSettings));
    const settings = loadSettings();
    expect(settings.themeMode).toBe('dark');
    expect(settings.speechRate).toBe(1.5);
    // Other properties should be defaults
    expect(settings.apiKey).toBe(defaultSettings.apiKey);
    expect(settings.coachMode).toBe(defaultSettings.coachMode);
  });

  it('retains apiKey if saveApiKey is true', () => {
    const storedSettings = {
      apiKey: 'my-secret-key',
      saveApiKey: true,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedSettings));
    const settings = loadSettings();
    expect(settings.apiKey).toBe('my-secret-key');
    expect(settings.saveApiKey).toBe(true);
  });

  it('clears apiKey if saveApiKey is false, even if apiKey is stored', () => {
    const storedSettings = {
      apiKey: 'my-secret-key',
      saveApiKey: false,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedSettings));
    const settings = loadSettings();
    expect(settings.apiKey).toBe('');
    expect(settings.saveApiKey).toBe(false);
  });

  it('handles null or undefined apiKey when saveApiKey is true', () => {
    const storedSettings = {
      apiKey: null,
      saveApiKey: true,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedSettings));
    const settings = loadSettings();
    expect(settings.apiKey).toBe('');
    expect(settings.saveApiKey).toBe(true);
  });

  it('resets model to default if stored model does not match default model', () => {
    const storedSettings = {
      model: 'old-gemini-model',
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedSettings));
    const settings = loadSettings();
    expect(settings.model).toBe(defaultSettings.model);
  });

  it('keeps model if stored model matches default model', () => {
    const storedSettings = {
      model: defaultSettings.model,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedSettings));
    const settings = loadSettings();
    expect(settings.model).toBe(defaultSettings.model);
  });

  it('keeps voiceName if it is a valid Gemini TTS voice', () => {
    const validVoice = 'Aoede'; // from GEMINI_TTS_VOICES
    const storedSettings = {
      voiceName: validVoice,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedSettings));
    const settings = loadSettings();
    expect(settings.voiceName).toBe(validVoice);
  });

  it('resets voiceName to default if it is not a valid Gemini TTS voice', () => {
    const invalidVoice = 'NonExistentVoice123';
    const storedSettings = {
      voiceName: invalidVoice,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedSettings));
    const settings = loadSettings();
    expect(settings.voiceName).toBe(defaultSettings.voiceName);
  });
});
