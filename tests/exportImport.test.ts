import { test, expect } from 'vitest';
import { createExportBundle, parseImportFile } from '../src/lib/storage';

test('export and import conversation JSON via storage layer', async () => {
  // Mock settings, sessions, analyses, vocabulary
  const settings = {
    apiKey: 'secret-key-that-should-be-removed',
    model: 'test-model',
    saveApiKey: false,
    themeMode: 'light',
    userName: 'Tester',
    coachMode: 'balanced',
    voiceName: 'test-voice',
    speechRate: 1,
    autoSpeakAi: false,
    dailyMinutesGoal: 20,
  } as any;
  const sessions = [
    {
      id: 'session-1',
      scenarioId: 'cafe',
      messages: [{ role: 'user', text: 'hi', timestamp: '2024-01-01T00:00:00Z' }]
    }
  ] as any;

  const bundle = createExportBundle(settings, sessions, [], []);
  const json = JSON.stringify(bundle);

  // Make sure apiKey is not exported
  expect(bundle.settings.apiKey).toBeUndefined();

  // Mock File API
  const file = new File([json], 'conv.json', { type: 'application/json' });
  const importedBundle = await parseImportFile(file);

  expect(importedBundle.sessions.length).toBe(1);
  expect(importedBundle.sessions[0].messages[0].text).toBe('hi');
});
