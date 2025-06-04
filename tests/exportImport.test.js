import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

test('export and import conversation JSON', async () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  let html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  html = html.replace(/<script[^>]*tailwindcss[^>]*><\/script>/, '');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost' });
  await new Promise(r => dom.window.document.addEventListener('DOMContentLoaded', r));
  const { window } = dom;
  const appState = window.eval('appState');
  appState.currentMessages = [{ sender: 'user', text: 'hi', timestamp: '2024-01-01T00:00:00Z' }];
  appState.currentScenario = window.findScenarioById('cafe');
  const json = window.exportConversationToJson(true);
  appState.currentMessages = [];
  const file = new window.File([json], 'conv.json', { type: 'application/json' });
  await window.importConversationFromJson(file);
  expect(appState.currentMessages.length).toBe(1);
});
