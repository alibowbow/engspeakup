import { describe, it, expect } from 'vitest';
import { deriveChallengeGrade } from '../src/lib/coaching';

describe('deriveChallengeGrade', () => {
  it.each([
    // Score 97-100: S
    [100, 'S'],
    [98, 'S'],
    [97, 'S'],

    // Score 89-96: A
    [96, 'A'],
    [90, 'A'],
    [89, 'A'],

    // Score 78-88: B
    [88, 'B'],
    [80, 'B'],
    [78, 'B'],

    // Score 66-77: C
    [77, 'C'],
    [70, 'C'],
    [66, 'C'],

    // Score 0-65: D
    [65, 'D'],
    [50, 'D'],
    [0, 'D'],

    // Edge Cases: floating points (in case they are passed, though it's assumed integers)
    [96.9, 'A'], // Below 97
    [65.9, 'D'], // Below 66
    [-1, 'D'],   // Negative fallback
    [101, 'S'],  // Over 100 fallback
  ])('given score %d, returns grade %s', (score, expectedGrade) => {
    expect(deriveChallengeGrade(score)).toBe(expectedGrade);
  });
});
