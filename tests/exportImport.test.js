import { test, expect } from 'vitest';
import { createExportBundle, parseImportFile, defaultSettings } from '../src/lib/storage.ts';

test('export and import conversation JSON', async () => {
  const mockSettings = { ...defaultSettings };
  const mockSessions = [
    {
      id: 'session-123',
      createdAt: '2024-01-01T00:00:00Z',
      scenarioId: 'cafe',
      focusSkill: 'Fluency',
      roleplayMode: 'normal',
      customScenario: '',
      notes: '',
      status: 'active',
      messages: [{ id: 'msg-1', role: 'user', text: 'hi', timestamp: 1234567890 }],
    }
  ];
  const mockAnalyses = [];
  const mockVocabulary = [];

  const bundle = createExportBundle(mockSettings, mockSessions, mockAnalyses, mockVocabulary);
  const json = JSON.stringify(bundle);

  const file = new File([json], 'conv.json', { type: 'application/json' });
  const importedBundle = await parseImportFile(file);

  expect(importedBundle.sessions.length).toBe(1);
  expect(importedBundle.sessions[0].id).toBe('session-123');
  expect(importedBundle.sessions[0].messages[0].text).toBe('hi');
});
