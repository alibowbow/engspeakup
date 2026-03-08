import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent, ReactNode } from 'react';
import { focusSkillOptions, modelPresets, scenarios, spotlightScenarioIds } from './data/scenarios';
import {
  buildAnalysisPrompt,
  buildChallengeReviewPrompt,
  buildConversationSystemPrompt,
  buildOfflineSummary,
  buildRecapPrompt,
  buildSuggestionPrompt,
  deriveChallengeGrade,
  deriveChallengeLevel,
  deriveChallengeMedal,
  deriveChallengeScoreFromSubscores,
  lastUserMessage,
  normalizeAnalysisEntry,
  normalizeChallengeReview,
  normalizeSuggestionBundle,
  normalizeSummary,
  resolveScenarioDetails,
} from './lib/coaching';
import { generateJson, generateText, streamText } from './lib/gemini';
import {
  GEMINI_TTS_DEFAULT_VOICE,
  getGeminiTtsVoices,
  isGeminiTtsVoice,
  isSpeechRecognitionSupported,
  listenOnce,
  loadEnglishVoices,
  previewVoiceSample,
  speakText,
  stopSpeaking,
} from './lib/speech';
import {
  clearWorkspace,
  createExportBundle,
  defaultSettings,
  loadActiveSessionId,
  loadAnalyses,
  loadSessions,
  loadSettings,
  loadVocabulary,
  parseImportFile,
  saveActiveSessionId,
  saveAnalyses,
  saveSessions,
  saveSettings,
  saveVocabulary,
} from './lib/storage';
import type {
  AnalysisEntry,
  ChallengeReview,
  PracticeView,
  RoleplayMode,
  Scenario,
  Session,
  SessionSummary,
  Settings,
  SuggestionBundle,
  ThemeMode,
  VocabularyCard,
} from './types';

type Busy = 'chat' | 'suggestions' | 'analysis' | 'recap' | 'challenge' | null;
type PracticePanelTab = 'guide' | 'challenge' | 'suggestions' | 'analysis' | 'recap';
type IconName =
  | 'chat'
  | 'library'
  | 'bookmark'
  | 'bookmarkFilled'
  | 'chart'
  | 'settings'
  | 'sparkles'
  | 'upload'
  | 'download'
  | 'list'
  | 'mic'
  | 'send'
  | 'copy'
  | 'play'
  | 'close'
  | 'bolt'
  | 'check'
  | 'wave'
  | 'sun'
  | 'moon';

const NAVS: Array<{ id: PracticeView; label: string; mobileLabel: string; icon: IconName }> = [
  { id: 'practice', label: '대화 연습', mobileLabel: '연습', icon: 'chat' },
  { id: 'library', label: '시나리오', mobileLabel: '시나', icon: 'library' },
  { id: 'review', label: '복습', mobileLabel: '복습', icon: 'bookmark' },
  { id: 'analytics', label: '통계', mobileLabel: '통계', icon: 'chart' },
];

const PAGE_META: Record<PracticeView, { title: string; description: string }> = {
  practice: {
    title: '대화 연습',
    description: 'AI와 역할극을 하며 말하기를 몰입해서 훈련하는 공간입니다.',
  },
  library: {
    title: '시나리오 라이브러리',
    description: '상황별 콘텐츠를 고르고 난이도를 비교한 뒤 바로 연습으로 들어갈 수 있습니다.',
  },
  review: {
    title: '복습 허브',
    description: '저장한 문장, 세션 메모, 분석 피드백을 한곳에서 다시 볼 수 있습니다.',
  },
  analytics: {
    title: '학습 통계',
    description: '최근 세션, 말하기 시간, 도전 모드 진행도를 확인할 수 있습니다.',
  },
};

const FOCUS_SKILL_LABELS: Record<string, string> = {
  Fluency: '유창성',
  Accuracy: '정확성',
  Confidence: '자신감',
  'Small Talk': '스몰토크',
  Interview: '면접',
  Pronunciation: '발음',
  Negotiation: '협상',
  Storytelling: '스토리텔링',
};

const CATEGORY_LABELS: Record<string, string> = {
  Everyday: '일상',
  Travel: '여행',
  Career: '커리어',
  Social: '소셜',
  'High Stakes': '고난도',
  Custom: '커스텀',
  'Custom Lab': '커스텀',
};

const DIFFICULTY_LABELS: Record<Scenario['difficulty'], string> = {
  Starter: '입문',
  Builder: '기초 확장',
  Momentum: '실전',
  Mastery: '고급',
};

const ROLEPLAY_MODE_LABELS: Record<RoleplayMode, string> = {
  normal: '기본 역할',
  reverse: '역할 반전',
};

const CHALLENGE_TARGET_OPTIONS = [4, 6, 8, 10, 12];

const id = (prefix: string) =>
  `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10)}`;

const sortSessions = (items: Session[]) =>
  [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

const words = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;

const scenarioById = (value: string) => scenarios.find((item) => item.id === value) ?? scenarios[0];

const mergeVocabulary = (current: VocabularyCard[], incoming: VocabularyCard[]) => {
  const map = new Map<string, VocabularyCard>();
  [...current, ...incoming].forEach((card) => map.set(card.phrase.toLowerCase(), card));
  return [...map.values()];
};

const labelCategory = (value: string) => CATEGORY_LABELS[value] ?? value;
const labelDifficulty = (value: Scenario['difficulty']) => DIFFICULTY_LABELS[value] ?? value;
const labelFocusSkill = (value: string) => FOCUS_SKILL_LABELS[value] ?? value;
const labelRoleplayMode = (value: RoleplayMode) => ROLEPLAY_MODE_LABELS[value] ?? value;
const CHALLENGE_SUBSCORE_LABELS: Record<keyof ChallengeReview['subscores'], string> = {
  taskCompletion: '미션 수행',
  interaction: '대화 운영',
  fluency: '유창성',
  accuracy: '정확성',
  vocabulary: '어휘 폭',
  naturalness: '자연스러움',
};
const PRACTICE_PANEL_TABS: Array<{ id: PracticePanelTab; label: string }> = [
  { id: 'guide', label: '상황 가이드' },
  { id: 'challenge', label: '챌린지 결과' },
  { id: 'suggestions', label: '다음 답변' },
  { id: 'analysis', label: '문장 교정' },
  { id: 'recap', label: '대화 요약' },
];
const TTS_VOICE_OPTIONS = getGeminiTtsVoices();
const TTS_VOICE_GROUPS = {
  female: TTS_VOICE_OPTIONS.filter((voice) => voice.group === 'female'),
  male: TTS_VOICE_OPTIONS.filter((voice) => voice.group === 'male'),
};
const CHAT_HISTORY_WINDOW = 12;
const CHAT_MAX_OUTPUT_TOKENS = 320;

function challengeStatsForSession(session: Session, analyses: AnalysisEntry[]) {
  return buildChallengeSnapshot(session, resolveScenarioDetails(scenarioById(session.scenarioId), session), analyses);
}

function legacyChallengeSubscores(score100: number): ChallengeReview['subscores'] {
  const clamped = Math.max(0, Math.min(100, Math.round(score100)));
  return {
    taskCompletion: clamped,
    interaction: Math.max(28, clamped - 6),
    fluency: Math.max(24, clamped - 4),
    accuracy: Math.max(20, clamped - 8),
    vocabulary: Math.max(22, clamped - 6),
    naturalness: Math.max(22, clamped - 7),
  };
}

function resolveChallengeLevelView(review: ChallengeReview | null) {
  const level = deriveChallengeLevel(review?.score100 ?? 0);
  return {
    label: review?.conversationLevel || level.label,
    summary: review?.levelSummary || level.summary,
  };
}

function resolveChallengeSubscores(review: ChallengeReview | null): ChallengeReview['subscores'] {
  return review?.subscores ?? legacyChallengeSubscores(review?.score100 ?? 0);
}

function trimChatHistory(messages: Session['messages']) {
  return messages.slice(-CHAT_HISTORY_WINDOW);
}

function buildChallengeSnapshot(session: Session | null, scenario: Scenario, analyses: AnalysisEntry[]) {
  const enabled = session?.challengeMode ?? false;
  const targetTurns = session?.challengeTargetTurns ?? 8;
  const review = session?.challengeReview ?? null;
  const userMessages = session?.messages.filter((message) => message.role === 'user') ?? [];
  const analysisCount = session ? analyses.filter((entry) => entry.sessionId === session.id).length : 0;
  const expressionHits = userMessages.reduce((sum, message) => {
    const lower = message.text.toLowerCase();
    const hits = scenario.keyExpressions.filter((item) => lower.includes(item.toLowerCase())).length;
    return sum + Math.min(2, hits);
  }, 0);
  const depthBonus = userMessages.reduce((sum, message) => {
    const count = words(message.text);
    if (count >= 14) return sum + 10;
    if (count >= 8) return sum + 5;
    return sum;
  }, 0);
  const baseTurns = userMessages.length * 12;
  const expressionBonus = expressionHits * 6;
  const analysisBonus = Math.min(3, analysisCount) * 8;
  const recapBonus = session?.summary ? 12 : 0;
  const completionBonus = enabled && userMessages.length >= targetTurns ? 20 : 0;
  const heuristicScore = enabled ? baseTurns + depthBonus + expressionBonus + analysisBonus + recapBonus + completionBonus : 0;
  const score = enabled ? review?.score100 ?? Math.min(99, heuristicScore) : 0;

  let rank = '-';
  if (enabled) {
    if (review?.grade) rank = review.grade;
    else rank = deriveChallengeGrade(Math.min(100, heuristicScore));
  }

  return {
    enabled,
    targetTurns,
    userTurns: userMessages.length,
    remainingTurns: Math.max(0, targetTurns - userMessages.length),
    score,
    rank,
    completed: enabled && userMessages.length >= targetTurns,
    analysisCount,
    expressionHits,
    depthBonus,
    recapBonus,
    medal: review?.medal ?? deriveChallengeMedal(Math.min(99, heuristicScore)),
    review,
  };
}

function buildOfflineChallengeReview(
  scenario: Scenario,
  session: Session,
  snapshot: ReturnType<typeof buildChallengeSnapshot>,
): ChallengeReview {
  const userMessages = session.messages.filter((message) => message.role === 'user');
  const totalWords = userMessages.reduce((sum, message) => sum + words(message.text), 0);
  const averageWords = userMessages.length ? totalWords / userMessages.length : 0;
  const turnRatio = snapshot.targetTurns ? Math.min(1, snapshot.userTurns / snapshot.targetTurns) : 0;
  const expressionRatio = Math.min(1, snapshot.expressionHits / Math.max(1, scenario.keyExpressions.length));
  const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
  const longTurnRatio =
    userMessages.filter((message) => words(message.text) >= 8).length / Math.max(1, userMessages.length);
  const shortTurnRatio =
    userMessages.filter((message) => words(message.text) <= 3).length / Math.max(1, userMessages.length);
  const questionTurnRatio =
    userMessages.filter((message) =>
      /[?]|(^|\s)(who|what|when|where|why|how|do|did|are|is|can|could|would|should)\b/i.test(
        message.text.trim(),
      ),
    ).length / Math.max(1, userMessages.length);
  const connectors = ['because', 'so', 'but', 'actually', 'instead', 'maybe', 'probably', 'first', 'then', 'also'];
  const connectorHits = userMessages.reduce((sum, message) => {
    const lower = message.text.toLowerCase();
    return sum + connectors.filter((word) => lower.includes(word)).length;
  }, 0);
  const connectorRatio = Math.min(1, connectorHits / Math.max(1, userMessages.length * 1.5));
  const uniqueWords = new Set(
    userMessages
      .flatMap((message) => message.text.toLowerCase().match(/[a-z']+/g) ?? [])
      .filter((token) => token.length > 1),
  ).size;
  const varietyRatio = totalWords ? uniqueWords / totalWords : 0;
  const repetitionPenalty = Math.max(0, 0.48 - varietyRatio) * 1.8;

  const subscores: ChallengeReview['subscores'] = {
    taskCompletion: clamp(turnRatio * 56 + expressionRatio * 24 + questionTurnRatio * 10 + longTurnRatio * 10),
    interaction: clamp(
      22 +
        questionTurnRatio * 32 +
        longTurnRatio * 16 +
        connectorRatio * 14 +
        (1 - shortTurnRatio) * 18 -
        repetitionPenalty * 22,
    ),
    fluency: clamp(
      20 +
        Math.min(1, averageWords / 11) * 20 +
        longTurnRatio * 24 +
        connectorRatio * 14 -
        shortTurnRatio * 28 -
        repetitionPenalty * 14,
    ),
    accuracy: clamp(
      18 +
        Math.min(1, averageWords / 10) * 14 +
        (1 - shortTurnRatio) * 24 +
        connectorRatio * 12 -
        repetitionPenalty * 18,
    ),
    vocabulary: clamp(
      16 +
        Math.min(1, varietyRatio / 0.62) * 44 +
        expressionRatio * 22 +
        connectorRatio * 8 -
        repetitionPenalty * 18,
    ),
    naturalness: clamp(
      16 +
        connectorRatio * 20 +
        questionTurnRatio * 18 +
        longTurnRatio * 16 +
        Math.min(1, varietyRatio / 0.62) * 14 -
        shortTurnRatio * 24 -
        repetitionPenalty * 20,
    ),
  };

  const score100 = deriveChallengeScoreFromSubscores(subscores);
  const grade = deriveChallengeGrade(score100);
  const medal = deriveChallengeMedal(score100);
  const level = deriveChallengeLevel(score100);
  const strongestSubscore = Object.entries(subscores).sort((left, right) => right[1] - left[1])[0][0] as keyof ChallengeReview['subscores'];
  const weakestSubscore = Object.entries(subscores).sort((left, right) => left[1] - right[1])[0][0] as keyof ChallengeReview['subscores'];
  const nextMissionBySubscore: Record<keyof ChallengeReview['subscores'], string> = {
    taskCompletion: `다음에는 ${scenario.keyExpressions[0] ?? '핵심 표현'}을 포함해 목표 상황을 더 분명하게 끝까지 밀고 가 보세요.`,
    interaction: '다음 챌린지에서는 답만 하지 말고 확인 질문과 되묻기를 섞어 대화 주도권을 가져오세요.',
    fluency: '다음에는 한 턴마다 이유 한 문장, 예시 한 문장을 붙여 끊기지 않는 흐름을 만들어 보세요.',
    accuracy: '다음에는 짧아도 구조가 분명한 문장으로 말하고, 주어와 시제를 끝까지 맞춰 보세요.',
    vocabulary: '다음에는 같은 단어 반복을 줄이고 비슷한 뜻의 표현 두세 개를 번갈아 써 보세요.',
    naturalness: '다음에는 because, actually, maybe 같은 연결 표현을 섞어 말투를 더 자연스럽게 만들어 보세요.',
  };

  return {
    score100,
    grade,
    medal,
    conversationLevel: level.label,
    levelSummary: level.summary,
    subscores,
    summary: `${scenario.title} 챌린지를 ${snapshot.userTurns}턴까지 완주했고, ${session.focusSkill} 기준으로 ${score100}점 수준의 수행을 보였습니다.`,
    verdict:
      grade === 'S'
        ? '핵심 표현과 흐름을 모두 잘 잡은 완성도 높은 챌린지였습니다.'
        : grade === 'A'
          ? '메시지는 충분히 잘 전달됐고, 한두 곳만 더 다듬으면 상위 등급입니다.'
          : grade === 'B'
            ? '상황 대응은 안정적이었지만 문장 밀도와 자연스러움을 더 올릴 여지가 있습니다.'
            : '핵심 의도는 전달됐지만 문장 완성도와 표현 선택을 더 끌어올릴 필요가 있습니다.',
    strengths: [
      `${snapshot.userTurns}턴을 채우며 대화를 끝까지 이어 갔습니다.`,
      `핵심 표현을 ${snapshot.expressionHits}회 사용해 시나리오 미션을 반영했습니다.`,
      `${session.focusSkill}에 맞춰 직접 영어 문장을 만들어 응답했습니다.`,
    ].slice(0, 3),
    improvements: [
      '문장을 한 단계 더 길게 확장해 이유나 근거를 붙여 보세요.',
      '핵심 표현을 문맥에 맞게 더 자연스럽게 변형해서 사용해 보세요.',
      '마지막 턴에서는 질문이나 제안을 덧붙여 주도권을 가져가 보세요.',
    ],
    rewards: [
      `완주 보너스 +${Math.round(turnRatio * 35)}`,
      `표현 활용 보너스 +${Math.round(expressionRatio * 25)}`,
      `유창성 보너스 +${Math.round(Math.min(1, averageWords / 16) * 20)}`,
    ],
    nextMission: `${scenario.keyExpressions[0] ?? '핵심 표현'}을 포함해 같은 상황을 1턴 더 짧고 선명하게 다시 말해 보세요.`,
  };
}

function exportFile(name: string, payload: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function MessageCard({
  message,
  onFavorite,
  onCopy,
  onSpeak,
}: {
  message: Session['messages'][number];
  onFavorite: () => void;
  onCopy: () => void;
  onSpeak?: () => void;
}) {
  return (
    <article className={`message ${message.role === 'assistant' ? 'ai' : 'user'}`}>
      <div className="message-avatar">
        <Icon name={message.role === 'assistant' ? 'sparkles' : 'chat'} />
      </div>
      <div className="message-body">
        <div className="message-sender-row">
          <span className="message-sender">{message.role === 'assistant' ? 'AI 코치' : '나'}</span>
          <span className="message-time">{formatDate(message.createdAt)}</span>
          <div className="message-actions">
            <button type="button" className="btn btn-icon btn-icon-sm" onClick={onFavorite} aria-label="문장 저장">
              <Icon name={message.favorite ? 'bookmarkFilled' : 'bookmark'} />
            </button>
            <button type="button" className="btn btn-icon btn-icon-sm" onClick={onCopy} aria-label="문장 복사">
              <Icon name="copy" />
            </button>
            {onSpeak ? (
              <button type="button" className="btn btn-icon btn-icon-sm" onClick={onSpeak} aria-label="문장 재생">
                <Icon name="play" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="message-bubble">{message.text}</div>
      </div>
    </article>
  );
}

function ScenarioCatalog({
  groups,
  selectedId,
  onSelect,
}: {
  groups: Record<string, Scenario[]>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="catalog">
      {Object.entries(groups).map(([category, items]) => (
        <section key={category} className="catalog-section">
          <div className="catalog-header">
            <strong>{labelCategory(category)}</strong>
            <span>{items.length}</span>
          </div>
          <div className="catalog-list">
            {items.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                className={`catalog-row ${scenario.id === selectedId ? 'selected' : ''}`}
                onClick={() => onSelect(scenario.id)}
              >
                <div className="catalog-main">
                  <strong>{scenario.title}</strong>
                  <p>{scenario.subtitle}</p>
                </div>
                <div className="catalog-meta">
                  <span>{labelDifficulty(scenario.difficulty)}</span>
                  <span>핵심 표현 {scenario.keyExpressions.length}개</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function StatCard({ value, label, suffix }: { value: string; label: string; suffix?: string }) {
  return (
    <div className="stat-card animate-in">
      <div className="stat-value">
        {value}
        {suffix ? <span>{suffix}</span> : null}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <div className="toggle-info">
        <div className="toggle-label">{label}</div>
        <div className="toggle-desc">{description}</div>
      </div>
      <button
        type="button"
        className={`toggle ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      <div className="empty-desc">{description}</div>
      {action}
    </div>
  );
}

function difficultyValue(value: Scenario['difficulty']) {
  switch (value) {
    case 'Starter':
      return 1;
    case 'Builder':
      return 2;
    case 'Momentum':
      return 3;
    case 'Mastery':
      return 4;
    default:
      return 1;
  }
}

function Icon({ name }: { name: IconName }) {
  switch (name) {
    case 'chat':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 10h10M7 14h6" />
          <path d="M5 19l1.5-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-6 3Z" />
        </svg>
      );
    case 'library':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
        </svg>
      );
    case 'bookmark':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 4h12v16l-6-4-6 4V4Z" />
        </svg>
      );
    case 'bookmarkFilled':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4-6 4V4Z" />
        </svg>
      );
    case 'chart':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18" />
          <path d="M7 14l4-4 3 3 5-7" />
        </svg>
      );
    case 'settings':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Z" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.4a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9.02 4a1.7 1.7 0 0 0 1.04-1.56V2.5a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.1 4.15a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 8.5c0 .69.41 1.31 1.04 1.56H21a2 2 0 1 1 0 4h-.09c-.63.25-1.04.87-1.04 1.56Z" />
        </svg>
      );
    case 'sparkles':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="m12 3 1.8 4.7L18.5 9l-4.7 1.3L12 15l-1.8-4.7L5.5 9l4.7-1.3L12 3Z" />
          <path d="m18.5 14 1 2.5L22 17.5 19.5 18.5 18.5 21l-1-2.5L15 17.5l2.5-1 1-2.5Z" />
          <path d="m5.5 14 .8 2L8.5 17l-2.2.9L5.5 20l-.8-2.1L2.5 17l2.2-1 .8-2Z" />
        </svg>
      );
    case 'upload':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M20 16.5v2.5A2 2 0 0 1 18 21H6a2 2 0 0 1-2-2v-2.5" />
        </svg>
      );
    case 'download':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4v12" />
          <path d="m7 11 5 5 5-5" />
          <path d="M20 19.5V17a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2.5" />
        </svg>
      );
    case 'list':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 6h13M8 12h13M8 18h13" />
          <path d="M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      );
    case 'mic':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
          <path d="M19 11a7 7 0 0 1-14 0" />
          <path d="M12 19v3" />
        </svg>
      );
    case 'send':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M3.4 20.4 21 12 3.4 3.6l1.8 6.5L15 12l-9.8 1.9-1.8 6.5Z" />
        </svg>
      );
    case 'copy':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="10" height="10" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      );
    case 'play':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="m8 5 11 7-11 7V5Z" />
        </svg>
      );
    case 'close':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      );
    case 'bolt':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
        </svg>
      );
    case 'check':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m20 6-11 11-5-5" />
        </svg>
      );
    case 'wave':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12c2 0 2-6 4-6s2 12 4 12 2-12 4-12 2 6 4 6 2-6 4-6" />
        </svg>
      );
    case 'sun':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77" />
        </svg>
      );
    case 'moon':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      );
    default:
      return null;
  }
}

function streak(sessions: Session[]) {
  const days = [...new Set(sessions.map((session) => new Date(session.updatedAt).toISOString().slice(0, 10)))].sort().reverse();
  if (!days.length) return 0;
  let total = 1;
  let cursor = new Date(`${days[0]}T00:00:00`);
  for (let i = 1; i < days.length; i += 1) {
    const previous = new Date(cursor);
    previous.setDate(previous.getDate() - 1);
    if (previous.toISOString().slice(0, 10) !== days[i]) break;
    total += 1;
    cursor = previous;
  }
  return total;
}

function inferToastTone(notice: string) {
  const lower = notice.toLowerCase();
  if (
    lower.includes('fail') ||
    lower.includes('error') ||
    lower.includes('required') ||
    lower.includes('실패') ||
    lower.includes('오류') ||
    lower.includes('필요')
  ) {
    return 'error';
  }
  if (
    lower.includes('ready') ||
    lower.includes('saved') ||
    lower.includes('copied') ||
    lower.includes('imported') ||
    lower.includes('준비') ||
    lower.includes('저장') ||
    lower.includes('복사') ||
    lower.includes('불러') ||
    lower.includes('완료')
  ) {
    return 'success';
  }
  return 'info';
}

export default function App() {
  const [view, setView] = useState<PracticeView>('practice');
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [sessions, setSessions] = useState<Session[]>(() => sortSessions(loadSessions()));
  const [analyses, setAnalyses] = useState<AnalysisEntry[]>(() => loadAnalyses());
  const [vocabulary, setVocabulary] = useState<VocabularyCard[]>(() => loadVocabulary());
  const [activeSessionId, setActiveSessionId] = useState(() => loadActiveSessionId());
  const [selectedScenarioId, setSelectedScenarioId] = useState(
    () => loadSessions().find((item) => item.id === loadActiveSessionId())?.scenarioId ?? spotlightScenarioIds[0],
  );
  const [focusSkill, setFocusSkill] = useState('Fluency');
  const [roleplayMode, setRoleplayMode] = useState<RoleplayMode>('normal');
  const [challengeMode, setChallengeMode] = useState(false);
  const [challengeTargetTurns, setChallengeTargetTurns] = useState(8);
  const [notes, setNotes] = useState('');
  const [customBrief, setCustomBrief] = useState('');
  const [composer, setComposer] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState('Gemini API 키를 입력하면 바로 실전 회화를 시작할 수 있습니다.');
  const [bundle, setBundle] = useState<SuggestionBundle | null>(null);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [previewingVoiceName, setPreviewingVoiceName] = useState('');
  const [streamingReply, setStreamingReply] = useState('');
  const [listening, setListening] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [practicePanelTab, setPracticePanelTab] = useState<PracticePanelTab>('guide');
  const [showSettings, setShowSettings] = useState(false);
  const [toastVisible, setToastVisible] = useState(true);
  const deferredSearch = useDeferredValue(search);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const activeSession = sessions.find((item) => item.id === activeSessionId) ?? null;
  const selectedScenario = scenarioById(selectedScenarioId);
  const currentScenario =
    activeSession?.scenarioId === selectedScenarioId ? resolveScenarioDetails(selectedScenario, activeSession) : selectedScenario;
  const filteredScenarios = scenarios.filter((item) => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return true;
    return [item.title, item.subtitle, item.description, item.category, item.tags.join(' ')].join(' ').toLowerCase().includes(q);
  });
  const groupedScenarios = filteredScenarios.reduce<Record<string, Scenario[]>>((acc, item) => {
    acc[item.category] = [...(acc[item.category] ?? []), item];
    return acc;
  }, {});
  const favoriteMessages = sortSessions(sessions).flatMap((session) =>
    session.messages.filter((message) => message.favorite).map((message) => ({ session, message })),
  );
  const activeSessionAnalyses = activeSession
    ? [...analyses]
        .filter((entry) => entry.sessionId === activeSession.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [];
  const latestUserSentence = activeSession ? lastUserMessage(activeSession.messages) : null;
  const currentSessionAnalysis =
    (latestUserSentence &&
      activeSessionAnalyses.find((entry) => entry.sentence.trim().toLowerCase() === latestUserSentence.text.trim().toLowerCase())) ||
    activeSessionAnalyses[0] ||
    null;
  const weeklySessions = sessions.filter((session) => Date.now() - new Date(session.updatedAt).getTime() < 7 * 24 * 60 * 60 * 1000);
  const totalTurns = sessions.reduce((sum, session) => sum + session.messages.length, 0);
  const weeklyMinutes = Math.round(
    weeklySessions.reduce(
      (sum, session) =>
        sum +
        session.messages
          .filter((message) => message.role === 'user')
          .reduce((inner, message) => inner + words(message.text), 0),
      0,
    ) / 110,
  );
  const goalProgress = Math.min(100, Math.round((weeklyMinutes / Math.max(1, settings.dailyMinutesGoal)) * 100));
  const spotlightScenario = scenarioById(spotlightScenarioIds[new Date().getDate() % spotlightScenarioIds.length]);
  const pageMeta = PAGE_META[view];
  const hasCurrentScenarioSession = Boolean(activeSession && activeSession.scenarioId === selectedScenarioId);
  const hasCurrentMessages = Boolean(hasCurrentScenarioSession && activeSession?.messages.length);
  const suggestionChips = (bundle?.suggestions.length ? bundle.suggestions : currentScenario.warmups).slice(0, 3);
  const openPracticePanel = (tab: PracticePanelTab) => {
    setPracticePanelTab(tab);
    setShowTools(true);
  };
  const togglePracticePanel = (tab: PracticePanelTab) => {
    if (showTools && practicePanelTab === tab) {
      setShowTools(false);
      return;
    }
    openPracticePanel(tab);
  };
  const recentSessions = sortSessions(sessions).slice(0, 8);
  const sessionChallengeSnapshots = sessions.map((session) => ({
    session,
    challenge: challengeStatsForSession(session, analyses),
  }));
  const challengeSessions = sessionChallengeSnapshots.filter((item) => item.challenge.enabled);
  const reviewedChallengeSessions = challengeSessions.filter((item) => item.challenge.review);
  const clearedChallenges = reviewedChallengeSessions;
  const bestChallengeScore = reviewedChallengeSessions.reduce(
    (max, item) => Math.max(max, item.challenge.review?.score100 ?? 0),
    0,
  );
  const totalChallengeScore = reviewedChallengeSessions.reduce(
    (sum, item) => sum + (item.challenge.review?.score100 ?? 0),
    0,
  );
  const challengeStatsBySession = new Map(sessionChallengeSnapshots.map((item) => [item.session.id, item.challenge]));
  const activeChallengeReview = hasCurrentScenarioSession ? activeSession?.challengeReview ?? null : null;
  const activeChallenge = buildChallengeSnapshot(
    activeSession && activeSession.scenarioId === selectedScenarioId
      ? activeSession
      : {
          id: '',
          scenarioId: selectedScenarioId,
          scenarioTitle: currentScenario.title,
          startedAt: '',
          updatedAt: '',
          messages: [],
          focusSkill,
          customScenario: customBrief,
          roleplayMode,
          challengeMode,
          challengeTargetTurns,
          challengeReview: null,
          notes,
          completedMissionSteps: [],
          summary: null,
        },
    currentScenario,
    analyses,
  );
  const activeChallengeLevel = resolveChallengeLevelView(activeChallengeReview);
  const activeChallengeSubscores = resolveChallengeSubscores(activeChallengeReview);
  const practiceToolNav: Array<{ id: PracticePanelTab; label: string; icon: IconName; ready: boolean }> = [
    {
      id: 'guide',
      label: '상황 가이드',
      icon: 'list',
      ready: true,
    },
    {
      id: 'challenge',
      label: '챌린지 결과',
      icon: 'bolt',
      ready: Boolean(activeChallenge.enabled || activeChallengeReview),
    },
    {
      id: 'analysis',
      label: '문장 교정',
      icon: 'check',
      ready: Boolean(currentSessionAnalysis),
    },
    {
      id: 'suggestions',
      label: '다음 답변',
      icon: 'sparkles',
      ready: Boolean(bundle),
    },
    {
      id: 'recap',
      label: '대화 요약',
      icon: 'wave',
      ready: Boolean(activeSession?.summary),
    },
  ];
  const readyPracticeToolCount = practiceToolNav.filter((item) => item.ready && item.id !== 'guide').length;
  const selectedTtsVoice =
    TTS_VOICE_OPTIONS.find((voice) => voice.name === settings.voiceName) ??
    TTS_VOICE_OPTIONS.find((voice) => voice.name === GEMINI_TTS_DEFAULT_VOICE) ??
    TTS_VOICE_OPTIONS[0];

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveSessions(sessions), [sessions]);
  useEffect(() => saveAnalyses(analyses), [analyses]);
  useEffect(() => saveVocabulary(vocabulary), [vocabulary]);
  useEffect(() => saveActiveSessionId(activeSessionId), [activeSessionId]);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.themeMode;
    document.documentElement.style.colorScheme = settings.themeMode;
  }, [settings.themeMode]);
  useEffect(() => {
    const applyVoices = () =>
      setBrowserVoices(loadEnglishVoices().sort((left, right) => left.name.localeCompare(right.name, 'en')));
    applyVoices();
    window.speechSynthesis?.addEventListener?.('voiceschanged', applyVoices);
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', applyVoices);
  }, []);
  useEffect(() => {
    if (isGeminiTtsVoice(settings.voiceName)) return;
    setSettings((current) => ({ ...current, voiceName: GEMINI_TTS_DEFAULT_VOICE }));
  }, [settings.voiceName]);
  useEffect(() => {
    if (!activeSession) return;
    setSelectedScenarioId(activeSession.scenarioId);
    setFocusSkill(activeSession.focusSkill);
    setRoleplayMode(activeSession.roleplayMode);
    setChallengeMode(activeSession.challengeMode ?? false);
    setChallengeTargetTurns(activeSession.challengeTargetTurns ?? 8);
    setNotes(activeSession.notes);
    setCustomBrief(activeSession.customScenario);
  }, [activeSession]);
  useEffect(() => {
    const node = chatScrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [activeSession?.messages.length, busy, streamingReply]);
  useEffect(() => () => {
    stopRef.current?.();
    stopSpeaking();
  }, []);
  useEffect(() => {
    if (!notice) return;
    setToastVisible(true);
    const timer = window.setTimeout(() => setToastVisible(false), 3400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const upsert = (session: Session) => {
    setSessions((current) => sortSessions([session, ...current.filter((item) => item.id !== session.id)]));
    setActiveSessionId(session.id);
    return session;
  };

  const patchActive = (patch: Partial<Session>) => {
    if (!activeSession || activeSession.scenarioId !== selectedScenarioId) return;
    upsert({ ...activeSession, ...patch, updatedAt: new Date().toISOString() });
  };

  const handleScenarioSelect = (nextScenarioId: string) => {
    if (nextScenarioId === selectedScenarioId) return;
    setSelectedScenarioId(nextScenarioId);
    setActiveSessionId('');
    setComposer('');
    setStreamingReply('');
    setNotes('');
    setCustomBrief('');
    setChallengeMode(false);
    setChallengeTargetTurns(8);
    setBundle(null);
    setShowCatalog(false);
    setShowTools(false);
    setNotice('새 상황으로 전환했습니다. 이 상황은 새 세션으로 시작됩니다.');
  };

  const makeSession = (
    scenario: Scenario,
    overrides?: Partial<Pick<Session, 'focusSkill' | 'customScenario' | 'roleplayMode' | 'challengeMode' | 'challengeTargetTurns' | 'notes'>>,
  ): Session => {
    const now = new Date().toISOString();
    return {
      id: id('session'),
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      startedAt: now,
      updatedAt: now,
      messages: [],
      focusSkill: overrides?.focusSkill ?? focusSkill,
      customScenario: overrides?.customScenario ?? customBrief,
      roleplayMode: overrides?.roleplayMode ?? roleplayMode,
      challengeMode: overrides?.challengeMode ?? challengeMode,
      challengeTargetTurns: overrides?.challengeTargetTurns ?? challengeTargetTurns,
      challengeReview: null,
      notes: overrides?.notes ?? notes,
      completedMissionSteps: [],
      summary: null,
    };
  };

  const buildStarterBundle = (session: Session) => {
    const sessionScenario = resolveScenarioDetails(selectedScenario, session);
    return {
      suggestions: sessionScenario.warmups.slice(0, 3),
      coachTip: `이번 목표: ${sessionScenario.goals[0]}.`,
      focusPoint: sessionScenario.challenge,
    };
  };

  const startFreshSession = ({
    challenge = false,
    noticeMessage,
  }: {
    challenge?: boolean;
    noticeMessage?: string;
  } = {}) => {
    if (selectedScenario.isCustom && !customBrief.trim()) {
      openPracticePanel('guide');
      setNotice('커스텀 상황은 먼저 브리프를 입력해야 시작할 수 있습니다.');
      return null;
    }
    const session = makeSession(selectedScenario, {
      challengeMode: challenge,
      challengeTargetTurns,
      focusSkill,
      customScenario: customBrief,
      roleplayMode,
      notes,
    });
    setChallengeMode(challenge);
    setComposer('');
    setStreamingReply('');
    setShowCatalog(false);
    setShowTools(false);
    upsert(session);
    setBundle(buildStarterBundle(session));
    setNotice(
      noticeMessage ?? (challenge ? `${challengeTargetTurns}턴 챌린지를 시작합니다.` : '새 말하기 세션이 준비되었습니다.'),
    );
    return session;
  };

  const evaluateChallengeSession = async (session: Session) => {
    const resolvedScenario = resolveScenarioDetails(selectedScenario, session);
    const snapshot = buildChallengeSnapshot(session, resolvedScenario, analyses);
    const fallback = buildOfflineChallengeReview(resolvedScenario, session, snapshot);

    try {
      const payload = await generateJson<Partial<ChallengeReview>>({
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim(),
        systemInstruction: 'Return only valid JSON.',
        userPrompt: buildChallengeReviewPrompt(resolvedScenario, session, snapshot.targetTurns),
        temperature: 0.2,
      });
      const challengeReview = normalizeChallengeReview(payload, fallback);
      const reviewedSession = upsert({
        ...session,
        challengeReview,
        updatedAt: new Date().toISOString(),
      });
      return { reviewedSession, challengeReview, usedFallback: false };
    } catch (error) {
      const reviewedSession = upsert({
        ...session,
        challengeReview: fallback,
        updatedAt: new Date().toISOString(),
      });
      return {
        reviewedSession,
        challengeReview: fallback,
        usedFallback: true,
        error,
      };
    }
  };

  const ensureSession = () => {
    if (selectedScenario.isCustom && !customBrief.trim()) {
      openPracticePanel('guide');
      setNotice('커스텀 상황은 먼저 브리프를 입력해야 시작할 수 있습니다.');
      return null;
    }
    if (hasCurrentScenarioSession && activeSession) return activeSession;
    return startFreshSession({ challenge: challengeMode, noticeMessage: '새 말하기 세션이 준비되었습니다.' });
  };

  const restartConversation = () => {
    if (hasCurrentMessages && !window.confirm('현재 대화 내용을 비우고 같은 상황으로 다시 시작할까요?')) return;
    startFreshSession({
      challenge: activeChallenge.enabled,
      noticeMessage: activeChallenge.enabled
        ? `${challengeTargetTurns}턴 챌린지를 처음부터 다시 시작합니다.`
        : '대화 내용을 비우고 같은 상황으로 다시 시작했습니다.',
    });
  };

  const startChallenge = () => {
    setPracticePanelTab('challenge');
    startFreshSession({
      challenge: true,
      noticeMessage: `${challengeTargetTurns}턴 챌린지를 시작합니다. 첫 사용자 문장부터 점수가 계산됩니다.`,
    });
  };

  const retryChallenge = () => {
    if (hasCurrentMessages && !window.confirm('현재 챌린지를 버리고 같은 조건으로 다시 도전할까요?')) return;
    startFreshSession({
      challenge: true,
      noticeMessage: `${challengeTargetTurns}턴 챌린지를 다시 시작합니다.`,
    });
  };

  const stopChallenge = () => {
    setChallengeMode(false);
    if (hasCurrentScenarioSession && activeSession) {
      upsert({
        ...activeSession,
        challengeMode: false,
        updatedAt: new Date().toISOString(),
      });
    }
    setNotice('챌린지 모드를 정지하고 일반 연습으로 전환했습니다.');
  };

  const playAssistantAudio = async (text: string, voiceName = settings.voiceName, cacheKey?: string) => {
    const result = await speakText({
      text,
      apiKey: settings.apiKey.trim(),
      voiceName,
      rate: settings.speechRate,
      cacheKey,
    });

    if (result === 'browser-fallback-daily') {
      setNotice('Gemini 2.5 Flash TTS 일일 한도를 모두 사용해 기본 브라우저 영어 음성으로 전환했습니다.');
      return;
    }

    if (result === 'browser-fallback') {
      setNotice('Gemini TTS를 사용할 수 없어 이번 재생은 기본 브라우저 영어 음성으로 전환했습니다.');
      return;
    }

    if (result === 'none') {
      setNotice('음성을 재생할 수 없습니다.');
    }
  };

  const previewVoice = async (voiceName: string, sampleText: string) => {
    setPreviewingVoiceName(voiceName);
    try {
      await previewVoiceSample({
        text: sampleText,
        apiKey: settings.apiKey.trim(),
        voiceName,
        rate: settings.speechRate,
        cacheKey: `preview-v1:${voiceName}:${sampleText}`,
      });
    } finally {
      setPreviewingVoiceName((current) => (current === voiceName ? '' : current));
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    if (!composer.trim() || busy === 'chat' || busy === 'challenge') {
      return;
    }
    void send();
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = composer.trim();
    if (!text) return;
    if (!settings.apiKey.trim()) {
      setShowSettings(true);
      setNotice('메시지를 보내기 전에 설정에서 Gemini API 키를 입력해 주세요.');
      return;
    }
    const session = ensureSession();
    if (!session) return;
    const previousUserTurns = session.messages.filter((message) => message.role === 'user').length;
    const pending = upsert({
      ...session,
      focusSkill,
      roleplayMode,
      challengeMode,
      challengeTargetTurns,
      notes,
      customScenario: customBrief,
      updatedAt: new Date().toISOString(),
      messages: [...session.messages, { id: id('msg'), role: 'user', text, createdAt: new Date().toISOString() }],
    });
    setComposer('');
    setStreamingReply('');
    setBusy('chat');
    try {
      const chatRequest = {
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim(),
        systemInstruction: buildConversationSystemPrompt(selectedScenario, pending, settings),
        history: trimChatHistory(pending.messages.slice(0, -1)),
        userPrompt: text,
        maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
      };
      let reply = '';
      try {
        reply = await streamText(chatRequest, (partial) => setStreamingReply(partial));
      } catch {
        setStreamingReply('');
        reply = await generateText(chatRequest);
      }
      const finalReply = reply.trim();
      if (!finalReply) {
        throw new Error('Gemini response did not contain text.');
      }
      setStreamingReply('');
      const completedSession = upsert({
        ...pending,
        updatedAt: new Date().toISOString(),
        messages: [...pending.messages, { id: id('msg'), role: 'assistant', text: finalReply, createdAt: new Date().toISOString() }],
      });
      if (settings.autoSpeakAi) void playAssistantAudio(finalReply);
      if (challengeMode && previousUserTurns < challengeTargetTurns && previousUserTurns + 1 >= challengeTargetTurns) {
        setBusy('challenge');
        openPracticePanel('challenge');
        const result = await evaluateChallengeSession(completedSession);
        if (result.usedFallback) {
          setNotice(
            result.error instanceof Error
              ? `챌린지 AI 채점이 실패해 로컬 결과를 표시합니다. ${result.challengeReview.grade} · ${result.challengeReview.score100}점`
              : `챌린지 AI 채점이 실패해 로컬 결과를 표시합니다. ${result.challengeReview.grade} · ${result.challengeReview.score100}점`,
          );
        } else {
          setNotice(
            `챌린지 결과가 나왔습니다. ${result.challengeReview.medal} ${result.challengeReview.grade} · ${result.challengeReview.score100}점`,
          );
        }
      } else {
        setNotice('AI 응답이 도착했습니다.');
      }
    } catch (error) {
      setNotice(error instanceof Error ? `응답 생성 실패: ${error.message}` : '응답 생성에 실패했습니다.');
    } finally {
      setStreamingReply('');
      setBusy(null);
    }
  };

  const suggest = async () => {
    const session = ensureSession();
    if (!session) return;
    if (!settings.apiKey.trim()) {
      setBundle({
        suggestions: selectedScenario.warmups.slice(0, 3),
        coachTip: 'API 키가 없어 기본 워밍업 문장을 보여주고 있습니다.',
        focusPoint: selectedScenario.challenge,
      });
      openPracticePanel('suggestions');
      setNotice('AI 없이 기본 워밍업 문장을 보여주고 있습니다.');
      return;
    }
    setBusy('suggestions');
    try {
      const payload = await generateJson<Partial<SuggestionBundle>>({
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim(),
        systemInstruction: 'Return only valid JSON.',
        userPrompt: buildSuggestionPrompt(selectedScenario, session),
        temperature: 0.4,
      });
      setBundle(normalizeSuggestionBundle(payload, selectedScenario));
      openPracticePanel('suggestions');
      setNotice('다음 답변 후보 3개를 준비했습니다.');
    } catch (error) {
      setNotice(error instanceof Error ? `다음 답변 추천 실패: ${error.message}` : '다음 답변 추천에 실패했습니다.');
    } finally {
      setBusy(null);
    }
  };

  const analyze = async () => {
    if (!activeSession) {
      setNotice('먼저 한 문장을 보내야 분석할 수 있습니다.');
      return;
    }
    const target = lastUserMessage(activeSession.messages);
    if (!target) {
      setNotice('아직 분석할 최근 사용자 문장이 없습니다.');
      return;
    }
    if (!settings.apiKey.trim()) {
      setShowSettings(true);
      setNotice('문장 교정에는 API 키가 필요합니다.');
      return;
    }
    setBusy('analysis');
    try {
      const payload = await generateJson<Partial<AnalysisEntry>>({
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim(),
        systemInstruction: 'Return only valid JSON.',
        userPrompt: buildAnalysisPrompt(selectedScenario, activeSession, target.text),
        temperature: 0.2,
      });
      const entry: AnalysisEntry = {
        id: id('analysis'),
        createdAt: new Date().toISOString(),
        ...normalizeAnalysisEntry(payload, target.text, activeSession.scenarioTitle, activeSession.id),
      };
      setAnalyses((current) => [entry, ...current]);
      setVocabulary((current) => mergeVocabulary(current, entry.vocabulary));
      openPracticePanel('analysis');
      setNotice('최근 문장을 분석했습니다.');
    } catch (error) {
      setNotice(error instanceof Error ? `분석 실패: ${error.message}` : '분석에 실패했습니다.');
    } finally {
      setBusy(null);
    }
  };

  const recap = async () => {
    if (!activeSession) {
      setNotice('요약할 활성 세션이 없습니다.');
      return;
    }
    const fallback = buildOfflineSummary(selectedScenario, activeSession);
    if (!settings.apiKey.trim()) {
      upsert({ ...activeSession, summary: fallback });
      setVocabulary((current) => mergeVocabulary(current, fallback.notableVocabulary));
      openPracticePanel('recap');
      setNotice('API 없이 로컬 대화 요약을 만들었습니다.');
      return;
    }
    setBusy('recap');
    try {
      const payload = await generateJson<Partial<SessionSummary>>({
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim(),
        systemInstruction: 'Return only valid JSON.',
        userPrompt: buildRecapPrompt(selectedScenario, activeSession),
        temperature: 0.25,
      });
      const summary = normalizeSummary(payload, fallback);
      upsert({ ...activeSession, summary });
      setVocabulary((current) => mergeVocabulary(current, summary.notableVocabulary));
      openPracticePanel('recap');
      setNotice('대화 요약이 준비되었습니다.');
    } catch (error) {
      upsert({ ...activeSession, summary: fallback });
      openPracticePanel('recap');
      setNotice(error instanceof Error ? `대화 요약 생성 실패: ${error.message}` : '대화 요약 생성에 실패했습니다.');
    } finally {
      setBusy(null);
    }
  };

  const toggleFavorite = (sessionId: string, messageId: string) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    upsert({
      ...session,
      messages: session.messages.map((message) =>
        message.id === messageId ? { ...message, favorite: !message.favorite } : message,
      ),
    });
  };

  const voiceInput = () => {
    if (!isSpeechRecognitionSupported()) {
      setNotice('이 브라우저에서는 음성 입력을 지원하지 않습니다.');
      return;
    }
    if (listening) {
      stopRef.current?.();
      stopRef.current = null;
      setListening(false);
      setNotice('음성 입력을 중지했습니다.');
      return;
    }
    stopRef.current = listenOnce({
      lang: 'en-US',
      onResult: (transcript) => setComposer((current) => (current ? `${current} ${transcript}` : transcript)),
      onError: setNotice,
      onEnd: () => {
        setListening(false);
        stopRef.current = null;
      },
    });
    if (stopRef.current) {
      setListening(true);
      setNotice('영어 음성을 듣고 있습니다.');
    }
  };

  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = await parseImportFile(file);
      startTransition(() => {
        setSettings((current) => ({ ...current, ...imported.settings, apiKey: current.apiKey }));
        setSessions(sortSessions(imported.sessions));
        setAnalyses(imported.analyses);
        setVocabulary(imported.vocabulary);
        setActiveSessionId(imported.sessions[0]?.id ?? '');
        setView('review');
      });
      setNotice('학습 데이터를 불러왔습니다.');
    } catch (error) {
      setNotice(error instanceof Error ? `가져오기 실패: ${error.message}` : '가져오기에 실패했습니다.');
    } finally {
      event.target.value = '';
    }
  };

  const resetWorkspace = () => {
    if (!window.confirm('이 브라우저에 저장된 세션, 분석, 어휘를 모두 초기화할까요?')) return;
    clearWorkspace();
    setSessions([]);
    setAnalyses([]);
    setVocabulary([]);
    setActiveSessionId('');
    setSelectedScenarioId(spotlightScenarioIds[0]);
    setSettings(defaultSettings);
    setFocusSkill('Fluency');
    setRoleplayMode('normal');
    setChallengeMode(false);
    setChallengeTargetTurns(8);
    setNotes('');
    setCustomBrief('');
    setComposer('');
    setBundle(null);
    setShowCatalog(false);
    setShowTools(false);
    setShowSettings(false);
    setNotice('로컬 워크스페이스를 초기화했습니다.');
  };

  const openReviewSession = (session: Session) => {
    setActiveSessionId(session.id);
    setSelectedScenarioId(session.scenarioId);
    setView('practice');
    setShowCatalog(false);
    setShowTools(false);
  };

  const toggleThemeMode = () => {
    setSettings((current) => ({
      ...current,
      themeMode: current.themeMode === 'dark' ? 'light' : 'dark',
    }));
  };

  return (
    <>
      <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <Icon name="sparkles" />
          </div>
          <div>
            <div className="sidebar-logo-text">SpeakUp Studio</div>
            <p className="sidebar-logo-copy">조용하게 몰입하는 프리미엄 말하기 훈련.</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">워크스페이스</div>
          {NAVS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              onClick={() => setView(item.id)}
            >
              <Icon name={item.icon} />
              <div>
                <div>
                  <span className="nav-label-desktop">{item.label}</span>
                  <span className="nav-label-mobile">{item.mobileLabel}</span>
                </div>
              </div>
            </button>
          ))}

          <div className="nav-section-label">코치 도구</div>
          {practiceToolNav.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item nav-item--tool ${view === 'practice' && showTools && practicePanelTab === item.id ? 'active' : ''}`}
              onClick={() => {
                setView('practice');
                openPracticePanel(item.id);
              }}
            >
              <Icon name={item.icon} />
              <div>
                <div className="nav-item-row">
                  <span>{item.label}</span>
                  {item.ready && <span className="nav-item-status" aria-hidden="true" />}
                </div>
              </div>
            </button>
          ))}

          <div className="nav-section-label">추천</div>
          <button
            type="button"
            className="sidebar-spotlight"
            onClick={() => {
              handleScenarioSelect(spotlightScenario.id);
              setView('practice');
              setShowCatalog(true);
            }}
          >
            <span className="badge badge-accent">오늘 추천</span>
            <strong>{spotlightScenario.title}</strong>
            <p>{spotlightScenario.challenge}</p>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="nav-item" onClick={() => setShowSettings(true)}>
            <Icon name="settings" />
            <div>
              <div>설정</div>
            </div>
          </button>
          <div className="api-status">
            <span className={`api-status-dot ${settings.apiKey.trim() ? 'connected' : ''}`} />
            <span>{settings.apiKey.trim() ? 'Gemini 키 연결됨' : 'Gemini 키 필요'}</span>
          </div>
        </div>
      </aside>

      <div className="main-area">
        <header className="page-header">
          <div className="page-heading">
            <div className="page-title">{pageMeta.title}</div>
            <p className="page-subtitle">{pageMeta.description}</p>
          </div>
          <div className="page-header-actions">
            <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" />
              불러오기
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                exportFile(`speakup-${new Date().toISOString().slice(0, 10)}.json`, createExportBundle(settings, sessions, analyses, vocabulary))
              }
            >
              <Icon name="download" />
              내보내기
            </button>
            <button
              type="button"
              className="btn btn-icon"
              onClick={toggleThemeMode}
              aria-label={settings.themeMode === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
            >
              <Icon name={settings.themeMode === 'dark' ? 'sun' : 'moon'} />
            </button>
            <button type="button" className="btn btn-icon" onClick={() => setShowSettings(true)} aria-label="설정 열기">
              <Icon name="settings" />
            </button>
          </div>
        </header>

        <main className={`main-content ${view === 'practice' ? 'main-content--practice' : ''}`}>
          {view === 'practice' && (
            <div className={`practice-shell ${showTools ? 'practice-shell--tools' : ''}`}>
              <section className="conversation-layout">
                <div className="scenario-bar">
                  <button
                    type="button"
                    className="btn btn-icon"
                    onClick={() => setShowCatalog((current) => !current)}
                    aria-label="시나리오 목록 열기"
                  >
                    <Icon name="list" />
                  </button>
                  <span className="scenario-badge">
                    <Icon name="bolt" />
                    {labelCategory(currentScenario.category)}
                  </span>
                  <div className="scenario-summary">
                    <div className="scenario-title">{currentScenario.title}</div>
                    <div className="scenario-caption">{currentScenario.subtitle}</div>
                  </div>
                  <div className="scenario-meta">
                    <span>{labelDifficulty(currentScenario.difficulty)}</span>
                    <span>{labelRoleplayMode(roleplayMode)}</span>
                    <span>{activeChallenge.enabled ? `챌린지 ${activeChallenge.userTurns}/${activeChallenge.targetTurns}턴` : hasCurrentMessages ? `${activeSession?.messages.length ?? 0}턴 진행` : '새 세션'}</span>
                  </div>
                  <div className="scenario-bar-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => togglePracticePanel('guide')}>
                      {showTools ? '코치 도구 닫기' : readyPracticeToolCount ? `코치 도구 ${readyPracticeToolCount}` : '코치 도구'}
                    </button>
                  </div>
                </div>

                <div className="practice-toolbar">
                  <div className={`session-state-card ${activeChallenge.enabled ? 'session-state-card--challenge' : ''}`}>
                    <div className="session-state-title">
                      {busy === 'challenge'
                        ? 'AI 최종 채점 중'
                        : activeChallenge.enabled
                          ? activeChallenge.completed
                            ? '챌린지 클리어'
                            : '챌린지 진행 중'
                        : hasCurrentMessages
                          ? '일반 연습 진행 중'
                          : '새 연습 준비'}
                    </div>
                    <div className="session-state-copy">
                      {busy === 'challenge'
                        ? '대화 전체를 읽고 100점 만점 최종 점수와 등급을 계산하고 있습니다.'
                        : activeChallengeReview
                          ? `${activeChallengeReview.medal} · ${activeChallengeReview.score100}점 / 100점 · ${activeChallengeReview.grade} 등급`
                        : activeChallenge.enabled
                          ? `${activeChallenge.userTurns}/${activeChallenge.targetTurns}턴 진행 중 · 종료 후 AI가 100점 만점으로 최종 평가합니다.`
                        : hasCurrentMessages
                          ? `현재 대화 ${activeSession?.messages.length ?? 0}턴 · 필요하면 바로 비우고 다시 시작할 수 있습니다.`
                          : `같은 상황으로 일반 연습을 시작하거나 ${challengeTargetTurns}턴 챌린지에 바로 도전할 수 있습니다.`}
                    </div>
                  </div>

                  <div className="practice-toolbar-actions">
                    <label className="toolbar-select">
                      <span>목표</span>
                      <select
                        className="form-select"
                        value={challengeTargetTurns}
                        disabled={busy === 'challenge'}
                        onChange={(event) => {
                          const next = Number(event.target.value) || 8;
                          setChallengeTargetTurns(next);
                          patchActive({ challengeTargetTurns: next });
                        }}
                      >
                        {CHALLENGE_TARGET_OPTIONS.map((turns) => (
                          <option key={turns} value={turns}>
                            {turns}턴
                          </option>
                        ))}
                      </select>
                    </label>

                    {hasCurrentMessages ? (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={restartConversation} disabled={busy === 'challenge'}>
                        대화 비우기
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busy === 'challenge'}
                        onClick={() => startFreshSession({ challenge: false, noticeMessage: '새 말하기 세션이 준비되었습니다.' })}
                      >
                        일반 시작
                      </button>
                    )}

                    {activeChallenge.enabled ? (
                      <>
                        <button type="button" className="btn btn-primary btn-sm" onClick={retryChallenge} disabled={busy === 'challenge'}>
                          재도전
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={stopChallenge} disabled={busy === 'challenge'}>
                          챌린지 정지
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-primary btn-sm" onClick={startChallenge} disabled={busy === 'challenge'}>
                        챌린지 시작
                      </button>
                    )}

                    <button type="button" className="btn btn-ghost btn-sm" onClick={suggest} disabled={busy === 'suggestions' || busy === 'challenge'}>
                      {busy === 'suggestions' ? '생성 중...' : '다음 답변'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={analyze} disabled={busy === 'analysis' || busy === 'challenge'}>
                      {busy === 'analysis' ? '교정 중...' : '문장 교정'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={recap} disabled={busy === 'recap' || busy === 'challenge'}>
                      {busy === 'recap' ? '정리 중...' : '대화 요약'}
                    </button>
                  </div>
                </div>

                {(busy === 'analysis' || currentSessionAnalysis) && (
                  <section className="card analysis-spotlight animate-in">
                    <div className="analysis-spotlight-head">
                      <div>
                        <div className="feedback-label">문장 교정</div>
                        <div className="card-title">
                          {busy === 'analysis' ? '방금 쓴 문장을 다듬는 중입니다' : '방금 쓴 문장을 이렇게 바꾸면 더 자연스럽습니다'}
                        </div>
                        <div className="card-subtitle">
                          {busy === 'analysis'
                            ? '현재 대화 맥락을 반영해 더 정확하고 자연스러운 영어 문장으로 교정하고 있습니다.'
                            : '내 문장과 추천 문장을 바로 비교한 뒤, 필요하면 코치 도구에서 상세 피드백까지 볼 수 있습니다.'}
                        </div>
                      </div>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openPracticePanel('analysis')}>
                        코치 도구에서 자세히 보기
                      </button>
                    </div>

                    {busy === 'analysis' ? (
                      <div className="feedback-card">
                        <div className="feedback-label">교정 준비 중</div>
                        <p>문장 의도, 문법, 자연스러움을 함께 보고 있습니다.</p>
                      </div>
                    ) : currentSessionAnalysis ? (
                      <>
                        <div className="analysis-spotlight-grid">
                          <div className="analysis-spotlight-card">
                            <div className="mini-label">내 문장</div>
                            <p>{currentSessionAnalysis.sentence}</p>
                          </div>
                          <div className="analysis-spotlight-card analysis-spotlight-card--accent">
                            <div className="mini-label">추천 문장</div>
                            <p>{currentSessionAnalysis.revision}</p>
                          </div>
                        </div>
                        <p className="insight-copy">{currentSessionAnalysis.koreanSummary}</p>
                      </>
                    ) : null}
                  </section>
                )}

                {showCatalog && (
                  <section className="card catalog-popover animate-in">
                    <div className="card-header">
                        <div>
                          <div className="card-title">시나리오 목록</div>
                          <div className="card-subtitle">총 {filteredScenarios.length}개 시나리오</div>
                        </div>
                      </div>
                    <label className="form-group">
                      <span className="form-label">검색</span>
                      <input
                        className="form-input"
                        placeholder="제목, 카테고리, 태그 검색"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                    <ScenarioCatalog groups={groupedScenarios} selectedId={selectedScenarioId} onSelect={handleScenarioSelect} />
                  </section>
                )}

                <div ref={chatScrollRef} className="chat-feed">
                  {!activeSession?.messages.length && (
                    <EmptyState
                      icon={<Icon name="chat" />}
                      title="새 대화 연습을 시작해 보세요"
                      description={currentScenario.challenge}
                      action={
                        <div className="empty-actions">
                          <button type="button" className="btn btn-secondary" onClick={() => startFreshSession({ challenge: false })}>
                            일반 시작
                          </button>
                          <button type="button" className="btn btn-primary" onClick={startChallenge}>
                            챌린지 시작
                          </button>
                        </div>
                      }
                    />
                  )}

                  {activeSession?.messages.length ? <div className="chat-divider">현재 세션</div> : null}

                  {activeSession?.messages.map((message) => (
                    <MessageCard
                      key={message.id}
                      message={message}
                      onFavorite={() => toggleFavorite(activeSession.id, message.id)}
                      onCopy={() => navigator.clipboard.writeText(message.text).then(() => setNotice('문장을 복사했습니다.'))}
                      onSpeak={
                        message.role === 'assistant'
                          ? () => void playAssistantAudio(message.text)
                          : undefined
                      }
                    />
                  ))}

                  {busy === 'chat' && (
                    <article className="message ai message-loading">
                      <div className="message-avatar">
                        <Icon name="sparkles" />
                      </div>
                      <div className="message-body">
                        <div className="message-sender-row">
                          <span className="message-sender">AI 코치</span>
                        </div>
                        <div className={`message-bubble ${streamingReply ? 'message-bubble--streaming' : ''}`}>
                          {streamingReply ? (
                            <span>{streamingReply}</span>
                          ) : (
                            <>
                              <span className="typing-dot" />
                              <span className="typing-dot" />
                              <span className="typing-dot" />
                            </>
                          )}
                        </div>
                      </div>
                    </article>
                  )}
                </div>

                <div className="input-area">
                  {!hasCurrentMessages && (
                    <div className="suggestions-row">
                      {suggestionChips.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className="suggestion-chip"
                          onClick={() => setComposer((current) => (current ? `${current} ${item}` : item))}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  )}

                  <form onSubmit={send}>
                    <div className="input-container">
                      <textarea
                        rows={1}
                          value={composer}
                          onChange={(event) => setComposer(event.target.value)}
                          onKeyDown={handleComposerKeyDown}
                          placeholder="영어로 다음 문장을 입력해 보세요"
                        />
                      <div className="input-actions">
                        {listening && (
                          <div className="waveform-bar" aria-hidden="true">
                            <span className="waveform-line" />
                            <span className="waveform-line" />
                            <span className="waveform-line" />
                            <span className="waveform-line" />
                            <span className="waveform-line" />
                          </div>
                        )}
                        <button
                            type="button"
                            className={`record-btn ${listening ? 'recording' : ''}`}
                            onClick={voiceInput}
                            disabled={busy === 'challenge'}
                            aria-label="음성 입력"
                          >
                            <Icon name="mic" />
                          </button>
                          {composer.trim() && (
                            <button type="button" className="btn btn-icon" onClick={() => setComposer('')} disabled={busy === 'challenge'} aria-label="입력 지우기">
                              <Icon name="close" />
                            </button>
                          )}
                          <button type="submit" className="send-btn" disabled={busy === 'chat' || busy === 'challenge' || !composer.trim()} aria-label="메시지 보내기">
                            <Icon name="send" />
                          </button>
                      </div>
                    </div>
                  </form>
                </div>
              </section>

              {showTools && (
                <aside className="practice-panel animate-in">
                  <div className="practice-panel-header">
                    <div>
                      <div className="card-title">코치 도구</div>
                      <div className="card-subtitle">가이드, 교정, 챌린지 결과, 대화 요약을 한 자리에서 확인합니다.</div>
                    </div>
                    <button type="button" className="btn btn-icon" onClick={() => setShowTools(false)} aria-label="패널 닫기">
                      <Icon name="close" />
                    </button>
                  </div>

                  <div className="practice-panel-tabs" role="tablist" aria-label="도구 패널 탭">
                    {PRACTICE_PANEL_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={practicePanelTab === tab.id}
                        className={`practice-panel-tab ${practicePanelTab === tab.id ? 'active' : ''}`}
                        onClick={() => setPracticePanelTab(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="practice-panel-body">
                    {practicePanelTab === 'guide' && (
                      <section className="card practice-panel-section">
                    <div className="card-header">
                      <div>
                        <div className="card-title">상황 가이드</div>
                        <div className="card-subtitle">내 역할: {currentScenario.userRole} · 상대 역할: {currentScenario.aiRole}</div>
                      </div>
                      <span className="badge badge-neutral">{labelFocusSkill(focusSkill)}</span>
                    </div>

                    <div className="form-grid">
                      <label className="form-group">
                        <span className="form-label">집중 스킬</span>
                        <select
                          className="form-select"
                          value={focusSkill}
                          onChange={(event) => {
                            setFocusSkill(event.target.value);
                            patchActive({ focusSkill: event.target.value });
                          }}
                        >
                          {focusSkillOptions.map((option) => (
                            <option key={option}>{labelFocusSkill(option)}</option>
                          ))}
                        </select>
                      </label>

                      <label className="form-group">
                        <span className="form-label">역할 모드</span>
                        <select
                          className="form-select"
                          value={roleplayMode}
                          onChange={(event) => {
                            const next = event.target.value as RoleplayMode;
                            setRoleplayMode(next);
                            patchActive({ roleplayMode: next });
                          }}
                        >
                          <option value="normal">기본 역할</option>
                          <option value="reverse">역할 반전</option>
                        </select>
                      </label>
                    </div>

                    <div className="form-grid">
                      <label className="form-group">
                        <span className="form-label">목표 턴 수</span>
                        <select
                          className="form-select"
                          value={challengeTargetTurns}
                          onChange={(event) => {
                            const next = Number(event.target.value) || 8;
                            setChallengeTargetTurns(next);
                            patchActive({ challengeTargetTurns: next });
                          }}
                        >
                          {CHALLENGE_TARGET_OPTIONS.map((turns) => (
                            <option key={turns} value={turns}>
                              {turns}턴
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="feedback-card feedback-card--compact">
                        <div className="feedback-label">도전 방식</div>
                        <p>상단의 챌린지 시작 버튼으로만 시작됩니다. 재도전과 정지도 같은 위치에서 바로 할 수 있습니다.</p>
                      </div>
                    </div>

                    {selectedScenario.isCustom && (
                      <label className="form-group">
                        <span className="form-label">커스텀 브리프</span>
                        <textarea
                          className="form-input form-input--textarea"
                          value={customBrief}
                          onChange={(event) => {
                            setCustomBrief(event.target.value);
                            patchActive({ customScenario: event.target.value });
                          }}
                          placeholder="상황, 상대 역할, 목표를 한국어로 적어 주세요"
                        />
                      </label>
                    )}

                    <label className="form-group">
                      <span className="form-label">코칭 메모</span>
                      <textarea
                        className="form-input form-input--textarea"
                        value={notes}
                        onChange={(event) => {
                          setNotes(event.target.value);
                          patchActive({ notes: event.target.value });
                        }}
                        placeholder="이번 세션에서 더 집중하고 싶은 포인트를 적어 주세요"
                      />
                    </label>

                    <div className="detail-columns">
                      <div>
                        <div className="mini-label">미션 단계</div>
                        <ul className="bullet-list">
                          {currentScenario.missionSteps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="mini-label">핵심 표현</div>
                        <div className="chip-row">
                          {currentScenario.keyExpressions.map((item) => (
                            <button
                              key={item}
                              type="button"
                              className="suggestion-chip"
                              onClick={() => setComposer((current) => (current ? `${current} ${item}` : item))}
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="mini-label">어휘 세트</div>
                      <div className="vocab-chip-grid">
                        {currentScenario.vocabulary.map((card) => (
                          <button
                            key={card.phrase}
                            type="button"
                            className="vocab-chip"
                            onClick={() => navigator.clipboard.writeText(card.example).then(() => setNotice('예문을 복사했습니다.'))}
                          >
                            <strong>{card.phrase}</strong>
                            <span>{card.meaningKo}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>
                    )}

                    {practicePanelTab === 'challenge' && (
                      <section className="card challenge-result-card practice-panel-section">
                        <div className="challenge-result-head">
                          <div>
                            <div className="card-title">챌린지 결과</div>
                            <div className="card-subtitle">
                              {busy === 'challenge'
                                ? 'AI가 전체 대화를 기준으로 최종 채점을 만들고 있습니다.'
                                : activeChallengeReview?.verdict ?? '챌린지를 완료하면 이 탭에 최종 점수와 상세 평가가 표시됩니다.'}
                            </div>
                          </div>
                          {activeChallengeReview ? (
                            <div className="challenge-score-badge">
                              <strong>{activeChallengeReview.score100}</strong>
                              <span>/100 · {activeChallengeReview.grade}</span>
                            </div>
                          ) : activeChallenge.enabled || busy === 'challenge' ? (
                            <div className="badge badge-accent">{busy === 'challenge' ? '채점 중' : `${activeChallenge.userTurns}/${activeChallenge.targetTurns}턴`}</div>
                          ) : null}
                        </div>

                        {activeChallengeReview ? (
                          <>
                            <div className="challenge-result-meta">
                              <span className="badge badge-accent">{activeChallengeReview.medal}</span>
                              <span className="badge badge-neutral">{activeChallengeLevel.label}</span>
                              {activeChallengeReview.rewards.map((reward) => (
                                <span key={reward} className="badge badge-neutral">
                                  {reward}
                                </span>
                              ))}
                            </div>
                            <p className="insight-copy">{activeChallengeReview.summary}</p>
                            <div className="challenge-level-card">
                              <div className="feedback-label">회화 레벨</div>
                              <strong>{activeChallengeLevel.label}</strong>
                              <p>{activeChallengeLevel.summary}</p>
                            </div>
                            <div className="challenge-breakdown-grid">
                              {Object.entries(activeChallengeSubscores).map(([key, value]) => (
                                <div key={key} className="challenge-breakdown-item">
                                  <span>{CHALLENGE_SUBSCORE_LABELS[key as keyof ChallengeReview['subscores']]}</span>
                                  <strong>{value}</strong>
                                </div>
                              ))}
                            </div>
                            <div className="analysis-grid">
                              <div className="feedback-card">
                                <div className="feedback-label">잘한 플레이</div>
                                <ul className="bullet-list compact">
                                  {activeChallengeReview.strengths.map((item) => (
                                    <li key={item}>{item}</li>
                                  ))}
                                </ul>
                              </div>
                              <div className="feedback-card">
                                <div className="feedback-label">감점 포인트</div>
                                <ul className="bullet-list compact">
                                  {activeChallengeReview.improvements.map((item) => (
                                    <li key={item}>{item}</li>
                                  ))}
                                </ul>
                              </div>
                              <div className="feedback-card">
                                <div className="feedback-label">다음 미션</div>
                                <p>{activeChallengeReview.nextMission}</p>
                              </div>
                            </div>
                          </>
                        ) : activeChallenge.enabled || busy === 'challenge' ? (
                          <div className="feedback-card">
                            <div className="feedback-label">{busy === 'challenge' ? '최종 채점' : '챌린지 진행'}</div>
                            <p>
                              {busy === 'challenge'
                                ? '상황 대응, 자연스러움, 핵심 표현 활용, 대화 주도성을 기준으로 100점 만점 결과를 계산하는 중입니다.'
                                : `현재 ${activeChallenge.userTurns}/${activeChallenge.targetTurns}턴 진행 중이며, 종료 후 AI가 전체 대화를 평가합니다.`}
                            </p>
                            <div className="progress-bar-wrap">
                              <div
                                className="progress-bar-fill"
                                style={{ width: `${Math.min(100, Math.round((activeChallenge.userTurns / activeChallenge.targetTurns) * 100))}%` }}
                              />
                            </div>
                            <p className="insight-copy">
                              {busy === 'challenge'
                                ? '조금만 기다리면 점수, 등급, 세부 코멘트가 정리됩니다.'
                                : `남은 턴 ${activeChallenge.remainingTurns}턴 · 분석 ${activeChallenge.analysisCount}회 · 핵심 표현 사용 ${activeChallenge.expressionHits}회`}
                            </p>
                          </div>
                        ) : (
                          <EmptyState
                            icon={<Icon name="bolt" />}
                            title="아직 챌린지 결과가 없습니다"
                            description="상단에서 챌린지 시작을 누르고 목표 턴을 채우면 여기에서 최종 평가를 확인할 수 있습니다."
                          />
                        )}
                      </section>
                    )}

                    {practicePanelTab === 'suggestions' && (
                      <section className="card practice-panel-section">
                    <div className="card-header">
                      <div>
                        <div className="card-title">다음 답변</div>
                        <div className="card-subtitle">막히지 않도록 바로 이어 말할 수 있는 다음 문장을 추천합니다.</div>
                      </div>
                    </div>
                    {bundle ? (
                      <>
                        <div className="chip-row">
                          {bundle.suggestions.map((item) => (
                            <button key={item} type="button" className="suggestion-chip" onClick={() => setComposer(item)}>
                              {item}
                            </button>
                          ))}
                        </div>
                        <div className="feedback-card">
                          <div className="feedback-label">코치 팁</div>
                          <p>{bundle.coachTip}</p>
                        </div>
                        <div className="feedback-card">
                          <div className="feedback-label">집중 포인트</div>
                          <p>{bundle.focusPoint}</p>
                        </div>
                      </>
                    ) : (
                      <EmptyState
                        icon={<Icon name="sparkles" />}
                        title="아직 다음 답변 추천이 없습니다"
                        description="상단의 다음 답변 버튼을 누르면 현재 흐름에 맞는 문장 후보를 바로 제안합니다."
                      />
                    )}
                  </section>
                    )}

                    {practicePanelTab === 'analysis' && (
                      <section className="card practice-panel-section">
                    <div className="card-header">
                      <div>
                        <div className="card-title">문장 교정</div>
                        <div className="card-subtitle">방금 쓴 문장을 더 정확하고 자연스러운 영어로 바로 다듬습니다.</div>
                      </div>
                    </div>
                    {currentSessionAnalysis ? (
                      <>
                        <div className="analysis-spotlight-grid">
                          <div className="analysis-spotlight-card">
                            <div className="mini-label">내 문장</div>
                            <p>{currentSessionAnalysis.sentence}</p>
                          </div>
                          <div className="analysis-spotlight-card analysis-spotlight-card--accent">
                            <div className="mini-label">추천 문장</div>
                            <p>{currentSessionAnalysis.revision}</p>
                          </div>
                        </div>
                        <p className="insight-copy">{currentSessionAnalysis.overview}</p>
                        <div className="feedback-card">
                          <div className="feedback-label">왜 이렇게 바꾸나요?</div>
                          <p>{currentSessionAnalysis.koreanSummary}</p>
                        </div>
                        <div className="analysis-grid">
                          <div className="feedback-card">
                            <div className="feedback-label">잘한 점</div>
                            <ul className="bullet-list compact">
                              {currentSessionAnalysis.strengths.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="feedback-card">
                            <div className="feedback-label">문법</div>
                            <ul className="bullet-list compact">
                              {currentSessionAnalysis.grammar.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="feedback-card">
                            <div className="feedback-label">자연스러움</div>
                            <ul className="bullet-list compact">
                              {currentSessionAnalysis.naturalness.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </>
                    ) : (
                      <EmptyState
                        icon={<Icon name="check" />}
                        title="아직 문장 교정 결과가 없습니다"
                        description="대화 중 문장 교정 버튼을 누르면 내 문장과 추천 문장을 바로 비교해서 볼 수 있습니다."
                      />
                    )}
                  </section>
                    )}

                    {practicePanelTab === 'recap' && (
                      <section className="card practice-panel-section">
                      <div className="card-header">
                        <div>
                          <div className="card-title">대화 요약</div>
                          <div className="card-subtitle">이번 연습을 한 번에 정리해서 다음 연습으로 바로 이어지게 만듭니다.</div>
                        </div>
                      </div>
                      {activeSession?.summary ? (
                        <>
                          <div className="feedback-card feedback-card--compact">
                            <div className="feedback-label">대화 요약이란?</div>
                            <p>이번 대화에서 무엇을 잘했고, 다음에 무엇을 먼저 고쳐야 하는지 한 번에 정리해 주는 마무리 노트입니다.</p>
                          </div>
                          <p className="insight-copy">{activeSession.summary.summary}</p>
                          <div className="detail-columns">
                            <div>
                              <div className="mini-label">잘한 점</div>
                              <ul className="bullet-list compact">
                                {activeSession.summary.wins.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <div className="mini-label">다음 집중 포인트</div>
                              <ul className="bullet-list compact">
                                {activeSession.summary.nextFocus.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                          <div>
                            <div className="mini-label">숙제</div>
                            <ul className="bullet-list compact">
                              {activeSession.summary.homework.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        </>
                      ) : (
                        <EmptyState
                          icon={<Icon name="wave" />}
                          title="아직 대화 요약이 없습니다"
                          description="상단의 대화 요약 버튼을 누르면 이번 연습의 성과, 다음 집중 포인트, 숙제를 한 번에 정리해 줍니다."
                        />
                      )}
                    </section>
                    )}
                  </div>
                </aside>
              )}
            </div>
          )}

          {view === 'library' && (
            <div className="library-layout">
              <section className="card animate-in">
                <div className="card-header">
                  <div>
                    <div className="card-title">시나리오 라이브러리</div>
                    <div className="card-subtitle">전체 말하기 팩을 둘러보고 다음 연습을 고를 수 있습니다.</div>
                  </div>
                  <span className="badge badge-neutral">총 {filteredScenarios.length}개</span>
                </div>
                <label className="form-group">
                  <span className="form-label">검색</span>
                  <input
                    className="form-input"
                    placeholder="제목, 카테고리, 태그 검색"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <div className="scenario-grid">
                  {filteredScenarios.map((scenario) => (
                    <button
                      key={scenario.id}
                      type="button"
                      className={`card card-clickable scenario-card ${selectedScenarioId === scenario.id ? 'scenario-card--selected' : ''}`}
                      onClick={() => handleScenarioSelect(scenario.id)}
                    >
                      <div className="card-header">
                        <div>
                          <div className="card-title">{scenario.title}</div>
                          <div className="card-subtitle">{scenario.subtitle}</div>
                        </div>
                        <span className="badge badge-neutral">{labelCategory(scenario.category)}</span>
                      </div>
                      <p className="card-copy">{scenario.description}</p>
                      <div className="card-footer">
                        <div className="difficulty-dots" aria-label={labelDifficulty(scenario.difficulty)}>
                          {Array.from({ length: 4 }).map((_, index) => (
                            <span
                              key={`${scenario.id}-${index}`}
                              className={`difficulty-dot ${index < difficultyValue(scenario.difficulty) ? 'filled' : ''}`}
                            />
                          ))}
                        </div>
                        <span className="badge badge-accent">{labelDifficulty(scenario.difficulty)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="card library-detail-card animate-in">
                <div className="card-header">
                  <div>
                    <div className="card-title">{selectedScenario.title}</div>
                    <div className="card-subtitle">{selectedScenario.subtitle}</div>
                  </div>
                  <span className="badge badge-accent">{labelDifficulty(selectedScenario.difficulty)}</span>
                </div>
                <p className="insight-copy">{selectedScenario.description}</p>

                <div className="detail-columns">
                  <div>
                    <div className="mini-label">목표</div>
                    <ul className="bullet-list compact">
                      {selectedScenario.goals.map((goal) => (
                        <li key={goal}>{goal}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mini-label">미션 단계</div>
                    <ul className="bullet-list compact">
                      {selectedScenario.missionSteps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="detail-columns">
                  <div>
                    <div className="mini-label">워밍업</div>
                    <div className="chip-row">
                      {selectedScenario.warmups.map((item) => (
                        <button key={item} type="button" className="suggestion-chip" onClick={() => setComposer(item)}>
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mini-label">핵심 표현</div>
                    <div className="chip-row">
                      {selectedScenario.keyExpressions.map((item) => (
                        <button key={item} type="button" className="suggestion-chip" onClick={() => setComposer(item)}>
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mini-label">어휘 미리보기</div>
                  <div className="vocab-list">
                    {selectedScenario.vocabulary.map((card) => (
                      <div key={card.phrase} className="vocab-item">
                        <div className="session-icon">
                          <Icon name="sparkles" />
                        </div>
                        <div>
                          <div className="vocab-phrase">{card.phrase}</div>
                          <div className="vocab-translation">{card.meaningKo}</div>
                          <div className="vocab-context">{card.example}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="inline-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setView('practice');
                      setShowCatalog(false);
                      setShowTools(false);
                    }}
                  >
                    연습 화면에서 열기
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowSettings(true)}>
                    API 설정 보기
                  </button>
                </div>
              </section>
            </div>
          )}

          {view === 'review' && (
            <div className="review-layout">
              <section className="card animate-in">
                <div className="card-header">
                  <div>
                    <div className="card-title">세션 기록</div>
                    <div className="card-subtitle">이전 연습 세션으로 바로 돌아갈 수 있습니다.</div>
                  </div>
                </div>
                {recentSessions.length ? (
                  <div className="session-list">
                    {recentSessions.map((session) => {
                      const challenge = challengeStatsBySession.get(session.id);
                      return (
                        <button key={session.id} type="button" className="session-item" onClick={() => openReviewSession(session)}>
                          <div className="session-icon">
                            <Icon name="chat" />
                          </div>
                          <div className="session-info">
                            <div className="session-title">{session.scenarioTitle}</div>
                            <div className="session-meta">
                              {session.messages.filter((message) => message.role === 'user').length}개 사용자 턴 · {formatDate(session.updatedAt)}
                            </div>
                          </div>
                          <div className="session-score">
                            {challenge?.review
                              ? `${challenge.review.medal} ${challenge.review.score100}점`
                              : challenge?.enabled
                                ? '챌린지 진행 중'
                                : labelFocusSkill(session.focusSkill)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState icon={<Icon name="chat" />} title="아직 세션이 없습니다" description="대화 연습을 시작하면 최근 세션이 여기에 쌓입니다." />
                )}
              </section>

              <section className="card animate-in">
                <div className="card-header">
                  <div>
                    <div className="card-title">저장한 문장</div>
                    <div className="card-subtitle">복습하려고 표시해 둔 문장을 모아 봅니다.</div>
                  </div>
                  <span className="badge badge-neutral">{favoriteMessages.length}</span>
                </div>
                {favoriteMessages.length ? (
                  <div className="vocab-list">
                    {favoriteMessages.map(({ session, message }) => (
                      <div key={message.id} className="vocab-item">
                        <div className="session-icon">
                          <Icon name="bookmarkFilled" />
                        </div>
                        <div>
                          <div className="vocab-phrase">{message.text}</div>
                          <div className="vocab-translation">{session.scenarioTitle}</div>
                          <div className="vocab-context">{formatDate(message.createdAt)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={<Icon name="bookmark" />} title="아직 저장한 문장이 없습니다" description="채팅 말풍선의 저장 버튼으로 좋은 문장을 따로 모아 둘 수 있습니다." />
                )}
              </section>

              <section className="card animate-in">
                <div className="card-header">
                  <div>
                    <div className="card-title">피드백 아카이브</div>
                    <div className="card-subtitle">최근 AI 교정과 자연스러움 피드백을 모아 봅니다.</div>
                  </div>
                  <span className="badge badge-neutral">{analyses.length}</span>
                </div>
                {analyses.length ? (
                  <div className="analysis-stack">
                    {analyses.slice(0, 10).map((analysis) => (
                      <div key={analysis.id} className="feedback-card">
                        <div className="feedback-label">{analysis.scenarioTitle}</div>
                        <p className="analysis-sentence">{analysis.sentence}</p>
                        <p>{analysis.revision}</p>
                      </div>
                    ))}
                  </div>
                ) : (
              <EmptyState icon={<Icon name="check" />} title="아직 문장 교정 기록이 없습니다" description="세션 안에서 문장 교정을 실행하면 교정 기록이 여기에 쌓입니다." />
                )}
              </section>

              <section className="card animate-in">
                <div className="card-header">
                  <div>
                    <div className="card-title">어휘 뱅크</div>
                    <div className="card-subtitle">문장 교정과 대화 요약에서 모은 표현을 다시 확인합니다.</div>
                  </div>
                  <span className="badge badge-neutral">{vocabulary.length}</span>
                </div>
                {vocabulary.length ? (
                  <div className="vocab-list">
                    {vocabulary.map((card) => (
                      <div key={card.phrase} className="vocab-item">
                        <div className="session-icon">
                          <Icon name="wave" />
                        </div>
                        <div>
                          <div className="vocab-phrase">{card.phrase}</div>
                          <div className="vocab-translation">{card.meaningKo}</div>
                          <div className="vocab-context">{card.example}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
              <EmptyState icon={<Icon name="wave" />} title="어휘 뱅크가 비어 있습니다" description="AI 문장 교정이나 대화 요약을 실행하면 새 카드가 여기에 추가됩니다." />
                )}
              </section>
            </div>
          )}

          {view === 'analytics' && (
            <div className="analytics-layout">
              <section className="stats-grid">
                <StatCard value={String(sessions.length)} label="총 세션 수" />
                <StatCard value={String(totalTurns)} label="전체 대화 턴" />
                <StatCard value={`${streak(sortSessions(sessions))}`} label="현재 연속 학습" suffix="일" />
                <StatCard value={`${weeklyMinutes}`} label="주간 말하기 시간" suffix="분" />
                <StatCard value={String(clearedChallenges.length)} label="챌린지 클리어" />
                <StatCard value={`${bestChallengeScore}`} label="최고 챌린지 점수" suffix="점" />
              </section>
              <section className="card animate-in">
                <div className="card-header">
                  <div>
                    <div className="card-title">주간 목표</div>
                    <div className="card-subtitle">최근 세션의 말한 단어 수를 기준으로 추정합니다.</div>
                  </div>
                  <span className="badge badge-accent">{goalProgress}%</span>
                </div>
                <div className="progress-bar-wrap">
                  <div className="progress-bar-fill" style={{ width: `${goalProgress}%` }} />
                </div>
                <p className="insight-copy">
                  이번 주 {weeklyMinutes}분을 기록했고, 하루 목표 {settings.dailyMinutesGoal}분 기준으로 계산했습니다.
                </p>
              </section>

              <section className="card animate-in">
                <div className="card-header">
                  <div>
                    <div className="card-title">최근 세션</div>
                    <div className="card-subtitle">이번 주 학습 흐름을 만든 최신 연습 기록입니다.</div>
                  </div>
                </div>
                {recentSessions.length ? (
                  <div className="session-list">
                    {recentSessions.map((session) => {
                      const challenge = challengeStatsBySession.get(session.id);
                      return (
                        <button key={session.id} type="button" className="session-item" onClick={() => openReviewSession(session)}>
                          <div className="session-icon">
                            <Icon name="chart" />
                          </div>
                          <div className="session-info">
                            <div className="session-title">{session.scenarioTitle}</div>
                            <div className="session-meta">
                              {session.messages.length}턴 · {formatDate(session.updatedAt)}
                            </div>
                          </div>
                          <div className="session-score">
                            {challenge?.review
                              ? `${challenge.review.medal} ${challenge.review.score100}점`
                              : challenge?.enabled
                                ? '챌린지 진행 중'
                                : labelRoleplayMode(session.roleplayMode)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState icon={<Icon name="chart" />} title="아직 통계가 없습니다" description="세션을 몇 개 완료하면 대시보드가 채워지기 시작합니다." />
                )}
              </section>

              <section className="card animate-in">
                <div className="card-header">
                  <div>
                    <div className="card-title">챌린지 보드</div>
                    <div className="card-subtitle">턴 미션과 누적 점수로 도전 진행도를 확인합니다.</div>
                  </div>
                  <span className="badge badge-accent">{totalChallengeScore}점</span>
                </div>
                {challengeSessions.length ? (
                  <div className="session-list">
                    {challengeSessions.slice(0, 6).map(({ session, challenge }) => (
                      <button key={session.id} type="button" className="session-item" onClick={() => openReviewSession(session)}>
                        <div className="session-icon">
                          <Icon name="bolt" />
                        </div>
                        <div className="session-info">
                          <div className="session-title">{session.scenarioTitle}</div>
                          <div className="session-meta">
                            {challenge.userTurns}/{challenge.targetTurns}턴 · 분석 {challenge.analysisCount}회 · 핵심 표현 {challenge.expressionHits}회
                          </div>
                        </div>
                        <div className="session-score">
                          {challenge.review
                            ? `${challenge.review.medal} ${challenge.review.score100}점`
                            : '평가 대기'}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={<Icon name="bolt" />} title="아직 챌린지 기록이 없습니다" description="챌린지 모드를 켜고 목표 턴을 채우면 점수 기록이 여기에 쌓입니다." />
                )}
              </section>

              <section className="card animate-in">
                <div className="card-header">
                  <div>
                    <div className="card-title">워크스페이스 상태</div>
                    <div className="card-subtitle">기기 지원 여부와 데이터 상태를 빠르게 확인합니다.</div>
                  </div>
                </div>
                <div className="health-grid">
                  <div className="feedback-card">
                    <div className="feedback-label">음성 입력</div>
                    <p>{isSpeechRecognitionSupported() ? '이 브라우저에서 지원됩니다.' : '이 브라우저에서 지원되지 않습니다.'}</p>
                  </div>
                  <div className="feedback-card">
                    <div className="feedback-label">음성 출력</div>
                    <p>
                      {`Gemini 2.5 Flash TTS 보이스 ${TTS_VOICE_OPTIONS.length}개를 선택할 수 있고, 브라우저 영어 음성 ${browserVoices.length}개가 백업으로 대기합니다.`}
                    </p>
                  </div>
                  <div className="feedback-card">
                    <div className="feedback-label">내보내기 안전성</div>
                    <p>API 키는 학습 데이터 내보내기 파일에 포함되지 않습니다.</p>
                  </div>
                </div>
              </section>
            </div>
          )}
        </main>

        <input ref={fileRef} hidden type="file" accept="application/json" onChange={importData} />
      </div>
    </div>

    <div className={`drawer-overlay ${showSettings ? 'open' : ''}`} onClick={() => setShowSettings(false)} />
    <aside className={`drawer-panel ${showSettings ? 'open' : ''}`} aria-hidden={!showSettings}>
      <div className="drawer-header">
        <div className="drawer-title">설정</div>
        <button type="button" className="btn btn-icon" onClick={() => setShowSettings(false)} aria-label="설정 닫기">
          <Icon name="close" />
        </button>
      </div>
      <div className="drawer-body">
        <section className="settings-section">
          <div className="settings-section-title">화면</div>
          <ToggleField
            label="라이트 모드"
            description={settings.themeMode === 'light' ? '밝은 캔버스 화면을 사용 중입니다.' : '어두운 작업 화면에서 밝은 화면으로 전환합니다.'}
            checked={settings.themeMode === 'light'}
            onChange={(checked) =>
              setSettings((current) => ({
                ...current,
                themeMode: (checked ? 'light' : 'dark') as ThemeMode,
              }))
            }
          />
        </section>

        <section className="settings-section">
          <div className="settings-section-title">Gemini</div>
          <label className="form-group">
            <span className="form-label">API 키</span>
            <input
              className="form-input"
              type="password"
              value={settings.apiKey}
              onChange={(event) => setSettings((current) => ({ ...current, apiKey: event.target.value }))}
              placeholder="Gemini API 키를 붙여 넣어 주세요"
            />
            <span className="form-hint">브라우저에서 직접 사용하며, 내보내기 파일에는 포함되지 않습니다.</span>
          </label>

          <label className="form-group">
            <span className="form-label">모델</span>
            <select
              className="form-select"
              value={settings.model}
              onChange={(event) => setSettings((current) => ({ ...current, model: event.target.value }))}
            >
              {modelPresets.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <span className="form-hint">기본 재생은 Gemini 2.5 Flash TTS를 사용하고, 일일 한도 초과 시 브라우저 영어 음성으로 자동 전환됩니다.</span>
          </label>

          <label className="form-group">
            <span className="form-label">코치 모드</span>
            <select
              className="form-select"
              value={settings.coachMode}
              onChange={(event) =>
                setSettings((current) => ({ ...current, coachMode: event.target.value as Settings['coachMode'] }))
              }
            >
              <option value="gentle">부드럽게</option>
              <option value="balanced">균형 있게</option>
              <option value="push">직설적으로</option>
            </select>
          </label>

          <ToggleField
            label="API 키 로컬 저장"
            description="끄면 새로고침 후 로컬 저장소에서 API 키를 지웁니다."
            checked={settings.saveApiKey}
            onChange={(checked) => setSettings((current) => ({ ...current, saveApiKey: checked }))}
          />
        </section>

        <section className="settings-section">
          <div className="settings-section-title">음성</div>
          <label className="form-group">
            <span className="form-label">영어 음성</span>
            <select
              className="form-select"
              value={settings.voiceName}
              onChange={(event) => setSettings((current) => ({ ...current, voiceName: event.target.value }))}
            >
              <optgroup label="Female">
                {TTS_VOICE_GROUPS.female.map((voice) => (
                  <option key={voice.name} value={voice.name}>
                    {voice.name} / {voice.tone}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Male">
                {TTS_VOICE_GROUPS.male.map((voice) => (
                  <option key={voice.name} value={voice.name}>
                    {voice.name} / {voice.tone}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>

          <div className="inline-actions">
            <span className="form-hint">
              {`현재 선택: ${selectedTtsVoice.name} / ${selectedTtsVoice.tone} / ${selectedTtsVoice.group === 'female' ? '여성' : '남성'}`}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void previewVoice(settings.voiceName, selectedTtsVoice.sampleText)}
              disabled={previewingVoiceName === settings.voiceName}
            >
              {previewingVoiceName === settings.voiceName ? '재생 중' : '샘플 듣기'}
            </button>
          </div>
          <label className="form-group">
            <span className="form-label">재생 속도</span>
            <input
              className="form-input"
              type="number"
              min="0.7"
              max="1.3"
              step="0.1"
              value={settings.speechRate}
              onChange={(event) =>
                setSettings((current) => ({ ...current, speechRate: Number(event.target.value) || 1 }))
              }
            />
          </label>

          <ToggleField
            label="AI 응답 자동 재생"
            description="AI 문장이 도착하면 바로 음성으로 읽어 줍니다."
            checked={settings.autoSpeakAi}
            onChange={(checked) => setSettings((current) => ({ ...current, autoSpeakAi: checked }))}
          />
        </section>

        <section className="settings-section">
          <div className="settings-section-title">연습</div>
          <label className="form-group">
            <span className="form-label">표시 이름</span>
            <input
              className="form-input"
              value={settings.userName}
              onChange={(event) => setSettings((current) => ({ ...current, userName: event.target.value }))}
              placeholder="선택 입력"
            />
          </label>

          <label className="form-group">
            <span className="form-label">하루 목표 시간(분)</span>
            <input
              className="form-input"
              type="number"
              value={settings.dailyMinutesGoal}
              onChange={(event) =>
                setSettings((current) => ({ ...current, dailyMinutesGoal: Number(event.target.value) || 20 }))
              }
            />
          </label>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">워크스페이스</div>
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" />
            학습 데이터 불러오기
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() =>
              exportFile(
                `speakup-${new Date().toISOString().slice(0, 10)}.json`,
                createExportBundle(settings, sessions, analyses, vocabulary),
              )
            }
          >
            <Icon name="download" />
            학습 데이터 내보내기
          </button>
          <button type="button" className="btn btn-danger" onClick={resetWorkspace}>
            로컬 워크스페이스 초기화
          </button>
          <p className="form-hint">
            API 키는 내보내기 파일에 포함되지 않습니다. 세션, 분석, 어휘 데이터는 직접 내보내기 전까지 이 기기에만 남습니다.
          </p>
        </section>
      </div>
    </aside>

    <div className="toast-container" aria-live="polite">
      {toastVisible && notice ? (
        <div className={`toast ${inferToastTone(notice)}`}>
          <div className="toast-icon">
            <Icon
              name={
                inferToastTone(notice) === 'error' ? 'close' : inferToastTone(notice) === 'success' ? 'check' : 'sparkles'
              }
            />
          </div>
          <div className="toast-content">
            <div className="toast-title">SpeakUp Studio</div>
            <div className="toast-msg">{notice}</div>
          </div>
        </div>
      ) : null}
    </div>
  </>
  );
}
