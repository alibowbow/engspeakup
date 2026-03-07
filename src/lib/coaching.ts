import type {
  AnalysisEntry,
  CoachMode,
  Message,
  Scenario,
  Session,
  SessionSummary,
  Settings,
  SuggestionBundle,
  VocabularyCard,
} from '../types';

const coachModeGuide: Record<CoachMode, string> = {
  gentle: 'Be warm, encouraging, and low-pressure. Prefer confidence building over correction density.',
  balanced: 'Balance realism and encouragement. Correct selectively when it helps progress.',
  push: 'Coach at a high standard. Challenge vague language, weak logic, and unnatural phrasing.',
};

export function resolveScenarioDetails(scenario: Scenario, session: Session): Scenario {
  if (!scenario.isCustom) {
    return scenario;
  }
  const customBrief = session.customScenario.trim();
  if (!customBrief) {
    return {
      ...scenario,
      description: '사용자 정의 상황 설명이 아직 없습니다. 먼저 어떤 상황을 연습할지 적어 주세요.',
    };
  }
  return {
    ...scenario,
    subtitle: '사용자가 직접 정의한 실전 상황',
    description: customBrief,
  };
}

export function buildConversationSystemPrompt(
  scenario: Scenario,
  session: Session,
  settings: Settings,
): string {
  const resolved = resolveScenarioDetails(scenario, session);
  const userRole = session.roleplayMode === 'normal' ? resolved.userRole : resolved.aiRole;
  const aiRole = session.roleplayMode === 'normal' ? resolved.aiRole : resolved.userRole;
  const learnerName = settings.userName.trim() || 'the learner';
  return `
You are SpeakUp Studio, an elite English speaking coach and roleplay partner.
The learner name is ${learnerName}.
Respond in English unless the learner explicitly asks for Korean.
Stay fully inside the scenario and move the conversation forward naturally.
Keep each reply to 1-3 short paragraphs or 1-4 concise sentences.
Ask at most one follow-up question at a time.
If the learner makes a mistake, model the correct form naturally inside your response instead of turning the chat into a grammar lecture.

Scenario title: ${resolved.title}
Scenario category: ${resolved.category}
Scenario description: ${resolved.description}
Difficulty: ${resolved.difficulty}
Learner role: ${userRole}
Your role: ${aiRole}
Conversation goals: ${resolved.goals.join(' | ')}
Mission steps: ${resolved.missionSteps.join(' | ')}
Important expressions to encourage: ${resolved.keyExpressions.join(' | ')}
Focus skill: ${session.focusSkill}
Learner notes: ${session.notes || 'none'}
Scenario tone: ${resolved.systemTone}
Coach mode instruction: ${coachModeGuide[settings.coachMode]}

If the learner seems hesitant, make the next turn easier.
If the learner is doing well, raise the realism and detail.
`.trim();
}

export function buildSuggestionPrompt(scenario: Scenario, session: Session): string {
  const resolved = resolveScenarioDetails(scenario, session);
  const lastTurns = session.messages
    .slice(-6)
    .map((message) => `${message.role.toUpperCase()}: ${message.text}`)
    .join('\n');
  return `
You are helping an English learner produce the next reply in a roleplay.
Return strict JSON with this shape:
{
  "suggestions": ["", "", ""],
  "coachTip": "",
  "focusPoint": ""
}

Scenario: ${resolved.title}
Description: ${resolved.description}
Focus skill: ${session.focusSkill}
Mission steps: ${resolved.missionSteps.join(' | ')}
Recent turns:
${lastTurns || 'No conversation yet.'}

Rules:
- Give exactly 3 suggestions.
- Make each suggestion sound natural and sayable aloud.
- Keep them short to medium length.
- Make the learner sound competent, not robotic.
`.trim();
}

export function buildAnalysisPrompt(
  scenario: Scenario,
  session: Session,
  sentence: string,
): string {
  const resolved = resolveScenarioDetails(scenario, session);
  return `
You are an English speaking coach for a Korean learner.
Analyze one learner sentence in context and return strict JSON with this shape:
{
  "overview": "",
  "strengths": ["", ""],
  "grammar": ["", ""],
  "naturalness": ["", ""],
  "revision": "",
  "koreanSummary": "",
  "vocabulary": [
    {
      "phrase": "",
      "meaningKo": "",
      "example": ""
    }
  ]
}

Scenario: ${resolved.title}
Scenario context: ${resolved.description}
Focus skill: ${session.focusSkill}
Learner sentence: ${sentence}

Rules:
- Keep the tone constructive and specific.
- If grammar is solid, say so plainly.
- Revision should be one polished sentence.
- Vocabulary can include up to 3 useful chunks from the improved sentence or scenario.
`.trim();
}

export function buildRecapPrompt(scenario: Scenario, session: Session): string {
  const resolved = resolveScenarioDetails(scenario, session);
  const transcript = session.messages
    .map((message) => `${message.role.toUpperCase()}: ${message.text}`)
    .join('\n');
  return `
You are summarizing an English speaking practice session for a Korean learner.
Return strict JSON with this shape:
{
  "summary": "",
  "wins": ["", ""],
  "nextFocus": ["", ""],
  "homework": ["", ""],
  "notableVocabulary": [
    {
      "phrase": "",
      "meaningKo": "",
      "example": ""
    }
  ]
}

Scenario: ${resolved.title}
Focus skill: ${session.focusSkill}
Mission steps: ${resolved.missionSteps.join(' | ')}
Transcript:
${transcript}

Rules:
- Summary should be short and concrete.
- Wins should point to what the learner did well.
- Next focus should identify specific improvement targets.
- Homework should be practical speaking drills.
`.trim();
}

export function buildOfflineSummary(scenario: Scenario, session: Session): SessionSummary {
  const userTurns = session.messages.filter((message) => message.role === 'user').length;
  const fallbackVocabulary = scenario.vocabulary.slice(0, 3);
  return {
    summary: `${scenario.title} 세션에서 총 ${userTurns}번 영어로 말했습니다. 다음에는 ${session.focusSkill.toLowerCase()}에 더 집중하면 좋습니다.`,
    wins: [
      `${scenario.title} 맥락을 끝까지 유지했습니다.`,
      `실전 표현을 직접 말해 보는 흐름을 만들었습니다.`,
    ],
    nextFocus: [
      `${session.focusSkill} 중심으로 문장을 더 짧고 선명하게 다듬기`,
      `질문을 받았을 때 핵심부터 답하고 근거를 붙이기`,
    ],
    homework: [
      `시나리오 핵심 표현 ${scenario.keyExpressions[0]}를 포함해 3문장 다시 말하기`,
      `${scenario.challenge}`,
    ],
    notableVocabulary: fallbackVocabulary,
  };
}

export function normalizeSuggestionBundle(
  payload: Partial<SuggestionBundle>,
  fallback: Scenario,
): SuggestionBundle {
  const suggestions = (payload.suggestions ?? []).filter(Boolean).slice(0, 3);
  return {
    suggestions: suggestions.length ? suggestions : fallback.warmups.slice(0, 3),
    coachTip:
      payload.coachTip?.trim() ||
      `${fallback.goals[0]}에 맞춰 한 문장씩 또렷하게 말해 보세요.`,
    focusPoint: payload.focusPoint?.trim() || fallback.challenge,
  };
}

export function normalizeAnalysisEntry(
  payload: Partial<AnalysisEntry>,
  fallbackSentence: string,
  fallbackScenarioTitle: string,
  sessionId: string,
): Omit<AnalysisEntry, 'id' | 'createdAt'> {
  return {
    sessionId,
    sentence: payload.sentence?.trim() || fallbackSentence,
    scenarioTitle: payload.scenarioTitle?.trim() || fallbackScenarioTitle,
    overview:
      payload.overview?.trim() ||
      '핵심 메시지는 전달됐지만 조금 더 자연스럽게 다듬을 수 있습니다.',
    strengths: (payload.strengths ?? []).filter(Boolean).slice(0, 3),
    grammar: (payload.grammar ?? []).filter(Boolean).slice(0, 3),
    naturalness: (payload.naturalness ?? []).filter(Boolean).slice(0, 3),
    revision: payload.revision?.trim() || fallbackSentence,
    koreanSummary:
      payload.koreanSummary?.trim() ||
      '의도는 잘 전달됐고, 더 자연스러운 표현 선택이 핵심 포인트입니다.',
    vocabulary: normalizeVocabularyList(payload.vocabulary ?? []),
  };
}

export function normalizeSummary(
  payload: Partial<SessionSummary>,
  fallback: SessionSummary,
): SessionSummary {
  const wins = (payload.wins ?? []).filter(Boolean).slice(0, 4);
  const nextFocus = (payload.nextFocus ?? []).filter(Boolean).slice(0, 4);
  const homework = (payload.homework ?? []).filter(Boolean).slice(0, 4);
  return {
    summary: payload.summary?.trim() || fallback.summary,
    wins: wins.length ? wins : fallback.wins,
    nextFocus: nextFocus.length ? nextFocus : fallback.nextFocus,
    homework: homework.length ? homework : fallback.homework,
    notableVocabulary: normalizeVocabularyList(
      payload.notableVocabulary ?? fallback.notableVocabulary,
    ),
  };
}

export function normalizeVocabularyList(cards: VocabularyCard[]): VocabularyCard[] {
  return cards
    .map((card) => ({
      phrase: card.phrase?.trim() ?? '',
      meaningKo: card.meaningKo?.trim() ?? '',
      example: card.example?.trim() ?? '',
    }))
    .filter((card) => card.phrase && card.meaningKo)
    .slice(0, 8);
}

export function lastUserMessage(messages: Message[]): Message | undefined {
  return [...messages].reverse().find((message) => message.role === 'user');
}
