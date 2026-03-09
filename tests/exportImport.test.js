import { describe, test, expect } from 'vitest';
import { createExportBundle, parseImportFile, defaultSettings } from '../src/lib/storage';

describe('export and import JSON', () => {
  test('createExportBundle removes apiKey and bundles data', () => {
    const settings = { ...defaultSettings, apiKey: 'secret', userName: 'TestUser' };
    const sessions = [{ id: '1', scenarioId: 'cafe', timestamp: '2024', messages: [] }];

    const bundle = createExportBundle(settings, sessions, [], []);

    expect(bundle.settings.apiKey).toBeUndefined();
    expect(bundle.settings.userName).toBe('TestUser');
    expect(bundle.sessions).toHaveLength(1);
    expect(bundle.sessions[0].id).toBe('1');
  });

  test('parseImportFile parses valid JSON file correctly', async () => {
    const json = JSON.stringify({
      settings: { userName: 'ImportedUser' },
      sessions: [{ id: '2', scenarioId: 'office', timestamp: '2025', messages: [] }],
      analyses: [],
      vocabulary: []
    });

    const file = new File([json], 'conv.json', { type: 'application/json' });
    const bundle = await parseImportFile(file);

    expect(bundle.settings.userName).toBe('ImportedUser');
    expect(bundle.settings.model).toBe(defaultSettings.model); // Fallback to default
    expect(bundle.sessions).toHaveLength(1);
    expect(bundle.sessions[0].id).toBe('2');
  });
});
