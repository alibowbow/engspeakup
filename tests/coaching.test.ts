import { describe, it, expect } from 'vitest';
import { deriveChallengeMedal } from '../src/lib/coaching';

describe('deriveChallengeMedal', () => {
  it('returns 다이아 for scores >= 97', () => {
    expect(deriveChallengeMedal(100)).toBe('다이아');
    expect(deriveChallengeMedal(98)).toBe('다이아');
    expect(deriveChallengeMedal(97)).toBe('다이아');
  });

  it('returns 플래티넘 for scores >= 89 and < 97', () => {
    expect(deriveChallengeMedal(96.9)).toBe('플래티넘');
    expect(deriveChallengeMedal(96)).toBe('플래티넘');
    expect(deriveChallengeMedal(90)).toBe('플래티넘');
    expect(deriveChallengeMedal(89)).toBe('플래티넘');
  });

  it('returns 골드 for scores >= 78 and < 89', () => {
    expect(deriveChallengeMedal(88.9)).toBe('골드');
    expect(deriveChallengeMedal(88)).toBe('골드');
    expect(deriveChallengeMedal(80)).toBe('골드');
    expect(deriveChallengeMedal(78)).toBe('골드');
  });

  it('returns 실버 for scores >= 66 and < 78', () => {
    expect(deriveChallengeMedal(77.9)).toBe('실버');
    expect(deriveChallengeMedal(77)).toBe('실버');
    expect(deriveChallengeMedal(70)).toBe('실버');
    expect(deriveChallengeMedal(66)).toBe('실버');
  });

  it('returns 브론즈 for scores < 66', () => {
    expect(deriveChallengeMedal(65.9)).toBe('브론즈');
    expect(deriveChallengeMedal(65)).toBe('브론즈');
    expect(deriveChallengeMedal(50)).toBe('브론즈');
    expect(deriveChallengeMedal(0)).toBe('브론즈');
    expect(deriveChallengeMedal(-10)).toBe('브론즈');
  });
});
