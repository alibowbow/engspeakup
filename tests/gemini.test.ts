import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractText } from '../src/lib/gemini.ts';

describe('extractText', () => {
  it('should extract text from a valid payload', () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [{ text: 'Hello, world!' }],
          },
        },
      ],
    };
    assert.strictEqual(extractText(payload), 'Hello, world!');
  });

  it('should join multiple parts', () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [{ text: 'Hello, ' }, { text: 'world!' }],
          },
        },
      ],
    };
    assert.strictEqual(extractText(payload), 'Hello, world!');
  });

  it('should trim whitespace from the combined text', () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [{ text: '  Hello, ' }, { text: 'world!  ' }],
          },
        },
      ],
    };
    assert.strictEqual(extractText(payload), 'Hello, world!');
  });

  it('should return empty string for null payload', () => {
    assert.strictEqual(extractText(null), '');
  });

  it('should return empty string for undefined payload', () => {
    assert.strictEqual(extractText(undefined), '');
  });

  it('should return empty string for empty payload object', () => {
    assert.strictEqual(extractText({}), '');
  });

  it('should return empty string if candidates array is missing', () => {
    const payload = { someOtherField: true };
    assert.strictEqual(extractText(payload), '');
  });

  it('should return empty string if candidates array is empty', () => {
    const payload = { candidates: [] };
    assert.strictEqual(extractText(payload), '');
  });

  it('should return empty string if candidate is missing content', () => {
    const payload = {
      candidates: [
        {
          otherField: 'data',
        },
      ],
    };
    assert.strictEqual(extractText(payload), '');
  });

  it('should return empty string if content is missing parts', () => {
    const payload = {
      candidates: [
        {
          content: {
            otherField: 'data',
          },
        },
      ],
    };
    assert.strictEqual(extractText(payload), '');
  });

  it('should return empty string if parts array is empty', () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [],
          },
        },
      ],
    };
    assert.strictEqual(extractText(payload), '');
  });

  it('should handle part missing text', () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [{ otherField: 'data' }],
          },
        },
      ],
    };
    assert.strictEqual(extractText(payload), '');
  });

  it('should skip parts without text when combining', () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [{ text: 'Hello, ' }, { otherField: 'data' }, { text: 'world!' }],
          },
        },
      ],
    };
    assert.strictEqual(extractText(payload), 'Hello, world!');
  });
});
