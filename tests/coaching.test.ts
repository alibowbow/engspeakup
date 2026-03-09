import { describe, it, expect } from 'vitest';
import { normalizeSubscores } from '../src/lib/coaching';

describe('normalizeSubscores', () => {
  const defaultFallback = {
    taskCompletion: 50,
    interaction: 60,
    fluency: 70,
    accuracy: 80,
    vocabulary: 90,
    naturalness: 100,
  };

  it('should handle undefined payload by returning fallback', () => {
    const result = normalizeSubscores(undefined, defaultFallback);
    expect(result).toEqual(defaultFallback);
  });

  it('should handle full payload', () => {
    const payload = {
      taskCompletion: 55,
      interaction: 65,
      fluency: 75,
      accuracy: 85,
      vocabulary: 95,
      naturalness: 100,
    };
    const result = normalizeSubscores(payload, defaultFallback);
    expect(result).toEqual(payload);
  });

  it('should handle partial payload, falling back to defaults for missing keys', () => {
    const payload = {
      taskCompletion: 55,
      fluency: 75,
    };
    const result = normalizeSubscores(payload, defaultFallback);
    expect(result).toEqual({
      taskCompletion: 55,
      interaction: 60, // from fallback
      fluency: 75,
      accuracy: 80, // from fallback
      vocabulary: 90, // from fallback
      naturalness: 100, // from fallback
    });
  });

  it('should clamp out-of-bounds numbers to 0-100', () => {
    const payload = {
      taskCompletion: -10,
      interaction: 150,
    };
    const result = normalizeSubscores(payload, defaultFallback);
    expect(result.taskCompletion).toBe(0);
    expect(result.interaction).toBe(100);
  });

  it('should use fallback for non-number, infinite, or NaN values', () => {
    const payload = {
      taskCompletion: '50' as any,
      interaction: NaN,
      fluency: Infinity,
      accuracy: null as any,
    };
    const result = normalizeSubscores(payload, defaultFallback);
    expect(result.taskCompletion).toBe(50); // fallback
    expect(result.interaction).toBe(60); // fallback
    expect(result.fluency).toBe(70); // fallback
    expect(result.accuracy).toBe(80); // fallback
  });

  it('should round decimal numbers', () => {
    const payload = {
      taskCompletion: 50.4,
      interaction: 50.5,
    };
    const result = normalizeSubscores(payload, defaultFallback);
    expect(result.taskCompletion).toBe(50);
    expect(result.interaction).toBe(51);
  });
});
