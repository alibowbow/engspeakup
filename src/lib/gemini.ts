import type { Message } from '../types';

interface GeminiTextRequest {
  apiKey: string;
  model: string;
  systemInstruction: string;
  history?: Message[];
  userPrompt: string;
  temperature?: number;
  responseMimeType?: 'application/json' | 'text/plain';
}

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';

function toGeminiRole(role: Message['role']): 'user' | 'model' {
  return role === 'assistant' ? 'model' : 'user';
}

function extractText(payload: unknown): string {
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

export async function generateText({
  apiKey,
  model,
  systemInstruction,
  history = [],
  userPrompt,
  temperature = 0.85,
  responseMimeType = 'text/plain',
}: GeminiTextRequest): Promise<string> {
  const response = await fetch(
    `${API_ROOT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
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
          maxOutputTokens: 2048,
          responseMimeType,
        },
      }),
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
  });
  return JSON.parse(extractJsonCandidate(raw)) as T;
}
