import type { Message } from '../types';

interface GeminiTextRequest {
  apiKey: string;
  model: string;
  systemInstruction: string;
  history?: Message[];
  userPrompt: string;
  temperature?: number;
  responseMimeType?: 'application/json' | 'text/plain';
  maxOutputTokens?: number;
}

interface GeminiSpeechRequest {
  apiKey: string;
  text: string;
  voiceName: string;
  rate?: number;
  model?: string;
}

export type GeminiSpeechErrorKind = 'quota-daily' | 'quota-temporary' | 'unknown';

export class GeminiSpeechError extends Error {
  kind: GeminiSpeechErrorKind;
  status: number;
  payloadText: string;

  constructor(message: string, kind: GeminiSpeechErrorKind, status: number, payloadText: string) {
    super(message);
    this.name = 'GeminiSpeechError';
    this.kind = kind;
    this.status = status;
    this.payloadText = payloadText;
  }
}

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';
export const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';

function toGeminiRole(role: Message['role']): 'user' | 'model' {
  return role === 'assistant' ? 'model' : 'user';
}

export function extractText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const candidate = (payload as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  }).candidates?.[0];
  return candidate?.content?.parts?.map((part) => part.text ?? '').join('')?.trim() ?? '';
}

function extractJsonCandidate(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '{}';
  }
  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }
  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
    return trimmed.slice(arrayStart, arrayEnd + 1);
  }
  return trimmed;
}

function buildGenerateContentBody({
  systemInstruction,
  history = [],
  userPrompt,
  temperature = 0.85,
  responseMimeType = 'text/plain',
  maxOutputTokens = 512,
}: Omit<GeminiTextRequest, 'apiKey' | 'model'>) {
  return {
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      ...history.map((message) => ({
        role: toGeminiRole(message.role),
        parts: [{ text: message.text }],
      })),
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature,
      topP: 0.95,
      maxOutputTokens,
      responseMimeType,
    },
  };
}

function extractInlineAudio(payload: unknown): { data: string; mimeType?: string } {
  const candidate = (payload as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: {
            data?: string;
            mimeType?: string;
          };
        }>;
      };
    }>;
  }).candidates?.[0];

  const audioPart = candidate?.content?.parts?.find((part) => part.inlineData?.data);
  return {
    data: audioPart?.inlineData?.data ?? '',
    mimeType: audioPart?.inlineData?.mimeType,
  };
}

function classifySpeechError(status: number, payloadText: string): GeminiSpeechErrorKind {
  const text = payloadText.toLowerCase();
  if (status === 429 || text.includes('resource_exhausted') || text.includes('quota')) {
    if (
      text.includes('perday') ||
      text.includes('per day') ||
      text.includes('requests per day') ||
      text.includes('requestsperday') ||
      text.includes('inputtokenspermodelperday')
    ) {
      return 'quota-daily';
    }
    return 'quota-temporary';
  }
  return 'unknown';
}

function buildSpeechPrompt(text: string, rate = 1): string {
  const paceInstruction =
    rate < 0.92
      ? 'Speak slightly slower than your normal pace.'
      : rate > 1.08
        ? 'Speak slightly faster than your normal pace.'
        : 'Speak at a natural conversation pace.';

  return `Read the following text verbatim in clear, natural English.
${paceInstruction}
Text:
${text}`.trim();
}

export async function generateText({
  apiKey,
  model,
  ...request
}: GeminiTextRequest): Promise<string> {
  const response = await fetch(
    `${API_ROOT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildGenerateContentBody(request)),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Gemini request failed with ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  const text = extractText(payload);
  if (!text) {
    throw new Error('Gemini response did not contain text.');
  }
  return text;
}

export async function generateJson<T>(request: GeminiTextRequest): Promise<T> {
  const raw = await generateText({
    ...request,
    responseMimeType: 'application/json',
    temperature: request.temperature ?? 0.35,
    maxOutputTokens: request.maxOutputTokens ?? 1024,
  });
  return JSON.parse(extractJsonCandidate(raw)) as T;
}

export async function streamText(
  request: GeminiTextRequest,
  onChunk: (text: string) => void,
): Promise<string> {
  const response = await fetch(
    `${API_ROOT}/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(request.apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildGenerateContentBody({
        ...request,
        maxOutputTokens: request.maxOutputTokens ?? 512,
      })),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Gemini stream request failed with ${response.status}`);
  }

  if (!response.body) {
    throw new Error('Gemini stream response did not include a readable body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let combined = '';

  const flushEvent = (rawEvent: string) => {
    const dataLines = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());

    if (!dataLines.length) {
      return;
    }

    const payloadText = dataLines.join('\n').trim();
    if (!payloadText || payloadText === '[DONE]') {
      return;
    }

    const payload = JSON.parse(payloadText) as unknown;
    const chunkText = extractText(payload);
    if (!chunkText) {
      return;
    }

    combined += chunkText;
    onChunk(combined);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let separatorMatch = buffer.match(/\r?\n\r?\n/);
    while (separatorMatch?.index !== undefined) {
      const separatorIndex = separatorMatch.index;
      const separatorLength = separatorMatch[0].length;
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + separatorLength);
      flushEvent(rawEvent);
      separatorMatch = buffer.match(/\r?\n\r?\n/);
    }

    if (done) {
      const trailing = buffer.trim();
      if (trailing) {
        flushEvent(trailing);
      }
      break;
    }
  }

  return combined.trim();
}

export async function generateSpeechAudio({
  apiKey,
  text,
  voiceName,
  rate = 1,
  model = GEMINI_TTS_MODEL,
}: GeminiSpeechRequest): Promise<{ data: string; mimeType?: string }> {
  const response = await fetch(
    `${API_ROOT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: buildSpeechPrompt(text, rate) }],
          },
        ],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new GeminiSpeechError(
      errorText || `Gemini speech request failed with ${response.status}`,
      classifySpeechError(response.status, errorText),
      response.status,
      errorText,
    );
  }

  const payload = (await response.json()) as unknown;
  const audio = extractInlineAudio(payload);
  if (!audio.data) {
    throw new GeminiSpeechError(
      'Gemini speech response did not contain audio.',
      'unknown',
      response.status,
      JSON.stringify(payload),
    );
  }
  return audio;
}
