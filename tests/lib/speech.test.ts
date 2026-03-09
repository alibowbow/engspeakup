import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isSpeechRecognitionSupported } from '../../src/lib/speech';

describe('isSpeechRecognitionSupported', () => {
  beforeEach(() => {
    // We don't want to clear the whole window, just ensure these specific properties are removed
    // before each test starts to have a clean slate.
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
  });

  afterEach(() => {
    // Clean up after tests too
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
  });

  it('should return true when SpeechRecognition is available', () => {
    (window as any).SpeechRecognition = class {};
    expect(isSpeechRecognitionSupported()).toBe(true);
  });

  it('should return true when webkitSpeechRecognition is available', () => {
    (window as any).webkitSpeechRecognition = class {};
    expect(isSpeechRecognitionSupported()).toBe(true);
  });

  it('should return true when both SpeechRecognition and webkitSpeechRecognition are available', () => {
    (window as any).SpeechRecognition = class {};
    (window as any).webkitSpeechRecognition = class {};
    expect(isSpeechRecognitionSupported()).toBe(true);
  });

  it('should return false when neither SpeechRecognition nor webkitSpeechRecognition is available', () => {
    expect(isSpeechRecognitionSupported()).toBe(false);
  });
});
