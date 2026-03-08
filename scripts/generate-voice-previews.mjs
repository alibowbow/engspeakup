import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash-preview-tts';
const SAMPLE_RATE = 24000;

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const speechModulePath = path.join(rootDir, 'src', 'lib', 'speech.ts');
const outputDir = path.join(rootDir, 'public', 'voice-previews');
const force = process.argv.includes('--force');
const REQUEST_SPACING_MS = 21000;

function buildSpeechPrompt(text) {
  return `Read the following text verbatim in clear, natural English.
Speak at a natural conversation pace.
Text:
${text}`.trim();
}

function extractInlineAudio(payload) {
  const candidate = payload?.candidates?.[0];
  const audioPart = candidate?.content?.parts?.find((part) => part?.inlineData?.data);
  return {
    data: audioPart?.inlineData?.data ?? '',
    mimeType: audioPart?.inlineData?.mimeType,
  };
}

function pcm16ToWavBuffer(pcmBytes, sampleRate) {
  const headerSize = 44;
  const wav = Buffer.alloc(headerSize + pcmBytes.length);

  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(headerSize + pcmBytes.length - 8, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(pcmBytes.length, 40);
  pcmBytes.copy(wav, headerSize);

  return wav;
}

function parseVoices(source) {
  const match = source.match(/export const GEMINI_TTS_VOICES: GeminiTtsVoiceOption\[\] = (\[[\s\S]*?\r?\n\]);/);
  if (!match) {
    throw new Error('Could not locate GEMINI_TTS_VOICES in src/lib/speech.ts');
  }

  const voices = vm.runInNewContext(match[1]);
  if (!Array.isArray(voices)) {
    throw new Error('Parsed voice list is not an array.');
  }
  return voices;
}

async function fileExists(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readLatestBrowserApiKey() {
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  const levelDbDir = path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Local Storage', 'leveldb');
  const exists = await fileExists(levelDbDir);
  if (!exists) {
    return '';
  }

  const directoryEntries = await readdir(levelDbDir);
  const files = await Promise.all(
    directoryEntries.map(async (name) => {
      const target = path.join(levelDbDir, name);
      const entryStat = await stat(target);
      return { target, mtimeMs: entryStat.mtimeMs, isFile: entryStat.isFile() };
    }),
  );

  const candidates = files
    .filter((entry) => entry.isFile)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 12);

  const pattern = /\{[^\{\}]{0,2000}?"apiKey":"([^"]+)"[^\{\}]{0,2000}?\}/g;

  for (const candidate of candidates) {
    const raw = await readFile(candidate.target, 'utf8').catch(async () => (await readFile(candidate.target)).toString('utf8'));
    for (const match of raw.matchAll(pattern)) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed?.saveApiKey && parsed?.model === 'gemini-3-flash-preview' && typeof parsed.apiKey === 'string') {
          return parsed.apiKey.trim();
        }
      } catch {
        // Ignore malformed fragments and continue.
      }
    }
  }

  return '';
}

async function generateVoicePreview(voice, apiKey) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(
      `${API_ROOT}/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: buildSpeechPrompt(voice.sampleText) }],
            },
          ],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voice.name,
                },
              },
            },
          },
        }),
      },
    );

    if (response.ok) {
      const payload = await response.json();
      const audio = extractInlineAudio(payload);
      if (!audio.data) {
        throw new Error(`${voice.name}: response did not include audio data.`);
      }
      return audio;
    }

    const body = await response.text();
    if (response.status !== 429 || attempt === 6) {
      throw new Error(`${voice.name}: ${response.status} ${body}`);
    }

    const retryMatch = body.match(/\"retryDelay\":\s*\"(\d+)s\"/);
    const retrySeconds = Math.max(retryMatch ? Number(retryMatch[1]) : 35, 20);
    console.log(`wait ${voice.name} ${retrySeconds}s`);
    await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
  }

  throw new Error(`${voice.name}: failed after retries.`);
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || (await readLatestBrowserApiKey());
  if (!apiKey) {
    console.error('GEMINI_API_KEY is required or must be saved in the Chrome app settings.');
    process.exit(1);
  }

  await mkdir(outputDir, { recursive: true });

  const speechModuleSource = await readFile(speechModulePath, 'utf8');
  const voices = parseVoices(speechModuleSource);

  for (const voice of voices) {
    const outputPath = path.join(outputDir, `${voice.name}.wav`);
    if (!force && (await fileExists(outputPath))) {
      console.log(`skip ${voice.name}`);
      continue;
    }

    console.log(`generate ${voice.name}`);
    const audio = await generateVoicePreview(voice, apiKey);
    const pcmBytes = Buffer.from(audio.data, 'base64');
    const wav = pcm16ToWavBuffer(pcmBytes, SAMPLE_RATE);
    await writeFile(outputPath, wav);
    await new Promise((resolve) => setTimeout(resolve, REQUEST_SPACING_MS));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
