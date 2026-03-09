import { describe, it, expect } from 'vitest';
import { normalizeVocabularyList } from '../src/lib/coaching';
import type { VocabularyCard } from '../src/types';

describe('normalizeVocabularyList', () => {
  it('should return empty array for empty input', () => {
    expect(normalizeVocabularyList([])).toEqual([]);
  });

  it('should normalize valid cards by trimming whitespace', () => {
    const input: VocabularyCard[] = [
      {
        phrase: ' hello ',
        meaningKo: ' 안녕 ',
        example: ' hello world ',
      },
    ];
    const expected: VocabularyCard[] = [
      {
        phrase: 'hello',
        meaningKo: '안녕',
        example: 'hello world',
      },
    ];
    expect(normalizeVocabularyList(input)).toEqual(expected);
  });

  it('should fall back to empty string for missing fields except phrase and meaningKo', () => {
    const input = [
      {
        phrase: 'test',
        meaningKo: '테스트',
      } as VocabularyCard,
    ];
    const expected = [
      {
        phrase: 'test',
        meaningKo: '테스트',
        example: '',
      },
    ];
    expect(normalizeVocabularyList(input)).toEqual(expected);
  });

  it('should filter out cards missing phrase or meaningKo', () => {
    const input = [
      { phrase: 'valid', meaningKo: '유효함', example: 'this is valid' },
      { phrase: '', meaningKo: '의미만 있음', example: '' },
      { phrase: '단어만 있음', meaningKo: '', example: '' },
      { phrase: undefined, meaningKo: undefined, example: '' } as unknown as VocabularyCard,
      { phrase: '   ', meaningKo: '공백 구문', example: '' },
      { phrase: '공백 의미', meaningKo: '   ', example: '' },
    ];
    const expected = [
      { phrase: 'valid', meaningKo: '유효함', example: 'this is valid' },
    ];
    expect(normalizeVocabularyList(input)).toEqual(expected);
  });

  it('should limit the output to a maximum of 8 cards', () => {
    const input = Array.from({ length: 10 }).map((_, i) => ({
      phrase: `word${i}`,
      meaningKo: `단어${i}`,
      example: `예문${i}`,
    }));
    const result = normalizeVocabularyList(input);
    expect(result.length).toBe(8);
    expect(result[7].phrase).toBe('word7');
  });
});
