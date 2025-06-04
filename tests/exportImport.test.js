import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

test('export and import conversation JSON', async () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  await new Promise(r => dom.window.document.addEventListener('DOMContentLoaded', r));
  const { window } = dom;
  window.appState.currentMessages = [{ sender: 'user', text: 'hi', timestamp: '2024-01-01T00:00:00Z' }];
  window.appState.currentScenario = window.findScenarioById('cafe');
  const json = window.exportConversationToJson(true);
  window.appState.currentMessages = [];
  const file = new window.File([json], 'conv.json', { type: 'application/json' });
  await window.importConversationFromJson(file);
  expect(window.appState.currentMessages.length).toBe(1);
});

test('save conversation to history', async () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  await new Promise(r => dom.window.document.addEventListener('DOMContentLoaded', r));
  const { window } = dom;
  window.appState.currentMessages = [{ sender: 'user', text: 'hello' }];
  window.appState.currentScenario = window.findScenarioById('cafe');
  window.saveConversationToHistory();
  const history = JSON.parse(window.localStorage.getItem('conversationHistory'));
  expect(Array.isArray(history)).toBe(true);
  expect(history.length).toBe(1);
});
