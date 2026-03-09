import { test, expect } from 'vitest';
import { parseImportFile, createExportBundle, defaultSettings } from '../src/lib/storage.ts';

test('export and import conversation JSON', async () => {
  const mockSettings = { ...defaultSettings, apiKey: 'secret' };
  const mockSessions = [{ id: '1', title: 'test', messages: [{ sender: 'user', text: 'hi', timestamp: '2024-01-01T00:00:00Z' }], createdAt: 123 }];

  const bundle = createExportBundle(mockSettings, mockSessions, [], []);

  // API key shouldn't be exported
  expect(bundle.settings.apiKey).toBeUndefined();

  const json = JSON.stringify(bundle);
  const file = new File([json], 'conv.json', { type: 'application/json' });

  const imported = await parseImportFile(file);

  expect(imported.sessions.length).toBe(1);
  expect(imported.sessions[0].messages.length).toBe(1);
  expect(imported.sessions[0].messages[0].text).toBe('hi');
});
