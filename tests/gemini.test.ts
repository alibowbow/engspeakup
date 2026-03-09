import { describe, it, expect } from 'vitest';
import { extractJsonCandidate } from '../src/lib/gemini';

describe('extractJsonCandidate', () => {
  it('returns "{}" for empty or whitespace strings', () => {
    expect(extractJsonCandidate('')).toBe('{}');
    expect(extractJsonCandidate('   \n\t  ')).toBe('{}');
  });

  it('extracts a JSON object from text', () => {
    const text = 'Here is the JSON you requested: {"name": "Test", "value": 123} End of message.';
    expect(extractJsonCandidate(text)).toBe('{"name": "Test", "value": 123}');
  });

  it('extracts a JSON object spanning multiple lines', () => {
    const text = `
    Some markdown text
    \`\`\`json
    {
      "key": "value"
    }
    \`\`\`
    `;
    expect(extractJsonCandidate(text)).toBe('{\n      "key": "value"\n    }');
  });

  it('returns the trimmed string if no JSON object is found', () => {
    const text = 'This is just some plain text without JSON formatting.';
    expect(extractJsonCandidate(text)).toBe('This is just some plain text without JSON formatting.');
  });

  it('handles nested objects', () => {
    const text = 'Prefix {"outer": {"inner": "value"}} Suffix';
    expect(extractJsonCandidate(text)).toBe('{"outer": {"inner": "value"}}');
  });

});
