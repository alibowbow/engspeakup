import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, FormEvent, KeyboardEvent, ReactNode } from 'react';
import { focusSkillOptions, scenarios, spotlightScenarioIds } from './data/scenarios';
import { CATEGORY_META, categoryMeta, difficultyMeta } from './data/categories';
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
  Settings,
  SuggestionBundle,
  ThemeMode,
  VocabularyCard,
} from './types';

type Busy = 'chat' | 'suggestions' | 'analysis' | 'recap' | 'challenge' | null;
type ToolTab = 'guide' | 'suggestions' | 'analysis' | 'challenge' | 'recap';
type IconName =
  | 'chat' | 'library' | 'bookmark' | 'bookmarkFilled' | 'chart' | 'settings'
  | 'sparkles' | 'upload' | 'download' | 'list' | 'mic' | 'send' | 'copy'
  | 'play' | 'close' | 'bolt' | 'check' | 'wave' | 'sun' | 'moon' | 'search'
  | 'plus' | 'flame' | 'trophy' | 'target' | 'refresh' | 'grid' | 'clock' | 'star' | 'chevron';

const NAVS: Array<{ id: PracticeView; label: string; mobileLabel: string; icon: IconName }> = [
  { id: 'practice', label: '대화 연습', mobileLabel: '연습', icon: 'chat' },
  { id: 'library', label: '시나리오', mobileLabel: '시나리오', icon: 'library' },
  { id: 'review', label: '복습', mobileLabel: '복습', icon: 'bookmark' },
  { id: 'analytics', label: '통계', mobileLabel: '통계', icon: 'chart' },
];

const PAGE_META: Record<PracticeView, { title: string; description: string }> = {
  practice: { title: '대화 연습', description: 'AI와 역할극을 하며 말하기를 몰입해서 훈련해요.' },
  library: { title: '시나리오 라이브러리', description: '상황을 골라 바로 연습을 시작할 수 있어요.' },
  review: { title: '복습 허브', description: '저장한 문장, 교정, 어휘를 한곳에서 다시 봐요.' },
  analytics: { title: '학습 통계', description: '연속 학습, 말하기 시간, 챌린지 진행도를 확인해요.' },
};

const FOCUS_SKILL_LABELS: Record<string, string> = {
  Fluency: '유창성', Accuracy: '정확성', Confidence: '자신감', 'Small Talk': '스몰토크',
  Interview: '면접', Pronunciation: '발음', Negotiation: '협상', Storytelling: '스토리텔링',
};

const CHALLENGE_TARGET_OPTIONS = [4, 6, 8, 10, 12];

const CHALLENGE_SUBSCORE_LABELS: Record<keyof ChallengeReview['subscores'], string> = {
  taskCompletion: '미션 수행', interaction: '대화 운영', fluency: '유창성',
  accuracy: '정확성', vocabulary: '어휘 폭', naturalness: '자연스러움',
};

const TOOL_TABS: Array<{ id: ToolTab; label: string; icon: IconName }> = [
  { id: 'guide', label: '상황 가이드', icon: 'list' },
  { id: 'suggestions', label: '다음 답변', icon: 'sparkles' },
  { id: 'analysis', label: '문장 교정', icon: 'check' },
  { id: 'challenge', label: '챌린지', icon: 'bolt' },
  { id: 'recap', label: '대화 요약', icon: 'wave' },
];

const TTS_VOICE_OPTIONS = getGeminiTtsVoices();
const TTS_VOICE_GROUPS = {
  female: TTS_VOICE_OPTIONS.filter((voice) => voice.group === 'female'),
  male: TTS_VOICE_OPTIONS.filter((voice) => voice.group === 'male'),
};
const CHAT_HISTORY_WINDOW = 12;
const CHAT_MAX_OUTPUT_TOKENS = 320;

const id = (prefix: string) =>
  `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10)}`;

const sortSessions = (items: Session[]) =>
  [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

const words = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const scenarioById = (value: string) => scenarios.find((item) => item.id === value) ?? scenarios[0];
const labelFocusSkill = (value: string) => FOCUS_SKILL_LABELS[value] ?? value;

const mergeVocabulary = (current: VocabularyCard[], incoming: VocabularyCard[]) => {
  const map = new Map<string, VocabularyCard>();
  [...current, ...incoming].forEach((card) => map.set(card.phrase.toLowerCase(), card));
  return [...map.values()];
};

const gradeColor = (grade: ChallengeReview['grade'] | string) => {
  if (grade === 'S' || grade === 'A') return '#22c55e';
  if (grade === 'B') return '#7c5cff';
  if (grade === 'C') return '#f59e0b';
  return '#ef4444';
};

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
  return { label: review?.conversationLevel || level.label, summary: review?.levelSummary || level.summary };
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
  if (enabled) rank = review?.grade ?? deriveChallengeGrade(Math.min(100, heuristicScore));
  return {
    enabled, targetTurns, userTurns: userMessages.length,
    remainingTurns: Math.max(0, targetTurns - userMessages.length),
    score, rank, completed: enabled && userMessages.length >= targetTurns,
    analysisCount, expressionHits, depthBonus, recapBonus,
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
  const longTurnRatio = userMessages.filter((m) => words(m.text) >= 8).length / Math.max(1, userMessages.length);
  const shortTurnRatio = userMessages.filter((m) => words(m.text) <= 3).length / Math.max(1, userMessages.length);
  const questionTurnRatio = userMessages.filter((m) =>
    /[?]|(^|\s)(who|what|when|where|why|how|do|did|are|is|can|could|would|should)\b/i.test(m.text.trim()),
  ).length / Math.max(1, userMessages.length);
  const connectors = ['because', 'so', 'but', 'actually', 'instead', 'maybe', 'probably', 'first', 'then', 'also'];
  const connectorHits = userMessages.reduce((sum, m) => sum + connectors.filter((w) => m.text.toLowerCase().includes(w)).length, 0);
  const connectorRatio = Math.min(1, connectorHits / Math.max(1, userMessages.length * 1.5));
  const uniqueWords = new Set(
    userMessages.flatMap((m) => m.text.toLowerCase().match(/[a-z']+/g) ?? []).filter((t) => t.length > 1),
  ).size;
  const varietyRatio = totalWords ? uniqueWords / totalWords : 0;
  const repetitionPenalty = Math.max(0, 0.48 - varietyRatio) * 1.8;
  const subscores: ChallengeReview['subscores'] = {
    taskCompletion: clamp(turnRatio * 56 + expressionRatio * 24 + questionTurnRatio * 10 + longTurnRatio * 10),
    interaction: clamp(22 + questionTurnRatio * 32 + longTurnRatio * 16 + connectorRatio * 14 + (1 - shortTurnRatio) * 18 - repetitionPenalty * 22),
    fluency: clamp(20 + Math.min(1, averageWords / 11) * 20 + longTurnRatio * 24 + connectorRatio * 14 - shortTurnRatio * 28 - repetitionPenalty * 14),
    accuracy: clamp(18 + Math.min(1, averageWords / 10) * 14 + (1 - shortTurnRatio) * 24 + connectorRatio * 12 - repetitionPenalty * 18),
    vocabulary: clamp(16 + Math.min(1, varietyRatio / 0.62) * 44 + expressionRatio * 22 + connectorRatio * 8 - repetitionPenalty * 18),
    naturalness: clamp(16 + connectorRatio * 20 + questionTurnRatio * 18 + longTurnRatio * 16 + Math.min(1, varietyRatio / 0.62) * 14 - shortTurnRatio * 24 - repetitionPenalty * 20),
  };
  const score100 = deriveChallengeScoreFromSubscores(subscores);
  const grade = deriveChallengeGrade(score100);
  const medal = deriveChallengeMedal(score100);
  const level = deriveChallengeLevel(score100);
  return {
    score100, grade, medal,
    conversationLevel: level.label, levelSummary: level.summary, subscores,
    summary: `${scenario.title} 챌린지를 ${snapshot.userTurns}턴까지 완주했고, ${session.focusSkill} 기준으로 ${score100}점 수준의 수행을 보였습니다.`,
    verdict:
      grade === 'S' ? '핵심 표현과 흐름을 모두 잘 잡은 완성도 높은 챌린지였습니다.'
      : grade === 'A' ? '메시지는 충분히 잘 전달됐고, 한두 곳만 더 다듬으면 상위 등급입니다.'
      : grade === 'B' ? '상황 대응은 안정적이었지만 문장 밀도와 자연스러움을 더 올릴 여지가 있습니다.'
      : '핵심 의도는 전달됐지만 문장 완성도와 표현 선택을 더 끌어올릴 필요가 있습니다.',
    strengths: [
      `${snapshot.userTurns}턴을 채우며 대화를 끝까지 이어 갔습니다.`,
      `핵심 표현을 ${snapshot.expressionHits}회 사용해 시나리오 미션을 반영했습니다.`,
      `${session.focusSkill}에 맞춰 직접 영어 문장을 만들어 응답했습니다.`,
    ],
    improvements: [
      '문장을 한 단계 더 길게 확장해 이유나 근거를 붙여 보세요.',
      '핵심 표현을 문맥에 맞게 더 자연스럽게 변형해서 사용해 보세요.',
      '마지막 턴에서는 질문이나 제안을 덧붙여 주도권을 가져가 보세요.',
    ],
    rewards: [
      `완주 보너스 +${Math.round(turnRatio * 35)}`,
      `표현 활용 +${Math.round(expressionRatio * 25)}`,
      `유창성 +${Math.round(Math.min(1, averageWords / 16) * 20)}`,
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

function streak(sessions: Session[]) {
  const days = [...new Set(sessions.map((s) => new Date(s.updatedAt).toISOString().slice(0, 10)))].sort().reverse();
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
  if (['fail', 'error', '실패', '오류', '필요', '없'].some((w) => lower.includes(w))) return 'error';
  if (['ready', 'saved', 'copied', '준비', '저장', '복사', '불러', '완료', '시작'].some((w) => lower.includes(w))) return 'success';
  return 'info';
}

function Ring({ value, color = '#7c5cff', stroke = 8 }: { value: number; color?: string; stroke?: number }) {
  const size = 100;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = c * (1 - clamped / 100);
  return (
    <svg className="ring-svg" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.34,1.56,0.64,1)' }}
      />
    </svg>
  );
}

function Msg({
  message, onFavorite, onCopy, onSpeak,
}: {
  message: Session['messages'][number];
  onFavorite: () => void;
  onCopy: () => void;
  onSpeak?: () => void;
}) {
  const ai = message.role === 'assistant';
  return (
    <article className={`msg ${ai ? 'ai' : 'user'}`}>
      <div className="msg-avatar"><Icon name={ai ? 'sparkles' : 'star'} /></div>
      <div className="msg-body">
        <div className="msg-meta">
          <span className="msg-sender">{ai ? 'AI 코치' : '나'}</span>
          <span>{formatDate(message.createdAt)}</span>
          <div className="msg-actions">
            <button type="button" className="btn-icon-sm" onClick={onFavorite} aria-label="문장 저장">
              <Icon name={message.favorite ? 'bookmarkFilled' : 'bookmark'} />
            </button>
            <button type="button" className="btn-icon-sm" onClick={onCopy} aria-label="문장 복사"><Icon name="copy" /></button>
            {onSpeak ? (
              <button type="button" className="btn-icon-sm" onClick={onSpeak} aria-label="문장 재생"><Icon name="play" /></button>
            ) : null}
          </div>
        </div>
        <div className="bubble">{message.text}</div>
      </div>
    </article>
  );
}

function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-ic">{icon}</div>
      <div className="empty-title">{title}</div>
      <div className="empty-desc">{description}</div>
      {action ? <div className="empty-actions">{action}</div> : null}
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="toggle-row">
      <div>
        <div className="t-label">{label}</div>
        <div className="t-desc">{description}</div>
      </div>
      <button type="button" className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} role="switch" aria-checked={checked} aria-label={label}>
        <i />
      </button>
    </div>
  );
}

function DiffPips({ level, color }: { level: number; color: string }) {
  return (
    <div className="diff-pips" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <span key={index} className={`diff-pip ${index < level ? 'on' : ''}`} style={index < level ? { background: color } : undefined} />
      ))}
    </div>
  );
}

function Icon({ name }: { name: IconName }) {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  switch (name) {
    case 'chat': return <svg viewBox="0 0 24 24" {...stroke}><path d="M7 10h10M7 14h6" /><path d="M5 19l1.5-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-6 3Z" /></svg>;
    case 'library': return <svg viewBox="0 0 24 24" {...stroke}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></svg>;
    case 'bookmark': return <svg viewBox="0 0 24 24" {...stroke}><path d="M6 4h12v16l-6-4-6 4V4Z" /></svg>;
    case 'bookmarkFilled': return <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4-6 4V4Z" /></svg>;
    case 'chart': return <svg viewBox="0 0 24 24" {...stroke}><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-7" /></svg>;
    case 'settings': return <svg viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.9 1.7 1.7 0 0 0 4.31 7l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" /></svg>;
    case 'sparkles': return <svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 1.8 4.7L18.5 9l-4.7 1.3L12 15l-1.8-4.7L5.5 9l4.7-1.3L12 3Z" /><path d="m18.5 14 1 2.5L22 17.5l-2.5 1L18.5 21l-1-2.5L15 17.5l2.5-1 1-2.5Z" /></svg>;
    case 'upload': return <svg viewBox="0 0 24 24" {...stroke}><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M20 16.5v2.5A2 2 0 0 1 18 21H6a2 2 0 0 1-2-2v-2.5" /></svg>;
    case 'download': return <svg viewBox="0 0 24 24" {...stroke}><path d="M12 4v12" /><path d="m7 11 5 5 5-5" /><path d="M20 19.5V17a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2.5" /></svg>;
    case 'list': return <svg viewBox="0 0 24 24" {...stroke}><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>;
    case 'mic': return <svg viewBox="0 0 24 24" {...stroke}><path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" /><path d="M19 11a7 7 0 0 1-14 0" /><path d="M12 19v3" /></svg>;
    case 'send': return <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6l1.8 6.5L15 12l-9.8 1.9-1.8 6.5Z" /></svg>;
    case 'copy': return <svg viewBox="0 0 24 24" {...stroke}><rect x="9" y="9" width="10" height="10" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>;
    case 'play': return <svg viewBox="0 0 24 24" fill="currentColor"><path d="m8 5 11 7-11 7V5Z" /></svg>;
    case 'close': return <svg viewBox="0 0 24 24" {...stroke}><path d="M18 6 6 18M6 6l12 12" /></svg>;
    case 'bolt': return <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>;
    case 'check': return <svg viewBox="0 0 24 24" {...stroke}><path d="m20 6-11 11-5-5" /></svg>;
    case 'wave': return <svg viewBox="0 0 24 24" {...stroke}><path d="M2 12c2 0 2-6 4-6s2 12 4 12 2-12 4-12 2 6 4 6 2-6 4-6" /></svg>;
    case 'sun': return <svg viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></svg>;
    case 'moon': return <svg viewBox="0 0 24 24" {...stroke}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>;
    case 'search': return <svg viewBox="0 0 24 24" {...stroke}><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>;
    case 'plus': return <svg viewBox="0 0 24 24" {...stroke}><path d="M12 5v14M5 12h14" /></svg>;
    case 'flame': return <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3-1 5-2.5 6.5C8 10 7 11.5 7 14a5 5 0 0 0 10 0c0-2-1-3.7-2.3-5.2C13 7 13.5 4.5 12 2Zm0 17a3 3 0 0 1-3-3c0-1 .5-2 1.5-2.8.3 1 1 1.6 1.8 1.8 1-.4 1.5-1.3 1.3-2.4 1 .8 1.4 2 1.4 3.4a3 3 0 0 1-3 3Z" /></svg>;
    case 'trophy': return <svg viewBox="0 0 24 24" {...stroke}><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" /><path d="M16 5h3v2a3 3 0 0 1-3 3M8 5H5v2a3 3 0 0 0 3 3M12 13v4M9 21h6M10 17h4" /></svg>;
    case 'target': return <svg viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></svg>;
    case 'refresh': return <svg viewBox="0 0 24 24" {...stroke}><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></svg>;
    case 'grid': return <svg viewBox="0 0 24 24" {...stroke}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>;
    case 'clock': return <svg viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case 'star': return <svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.2l1-5.8L3.5 9.2l5.9-.9L12 3Z" /></svg>;
    case 'chevron': return <svg viewBox="0 0 24 24" {...stroke}><path d="m9 6 6 6-6 6" /></svg>;
    default: return null;
  }
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
  const [notice, setNotice] = useState('Gemini API 키를 입력하면 바로 실전 회화를 시작할 수 있어요.');
  const [bundle, setBundle] = useState<SuggestionBundle | null>(null);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [previewingVoiceName, setPreviewingVoiceName] = useState('');
  const [streamingReply, setStreamingReply] = useState('');
  const [listening, setListening] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [toolTab, setToolTab] = useState<ToolTab>('guide');
  const [showSettings, setShowSettings] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [toastVisible, setToastVisible] = useState(true);

  const deferredSearch = useDeferredValue(search);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const activeSession = sessions.find((item) => item.id === activeSessionId) ?? null;
  const selectedScenario = scenarioById(selectedScenarioId);
  const currentScenario =
    activeSession?.scenarioId === selectedScenarioId ? resolveScenarioDetails(selectedScenario, activeSession) : selectedScenario;
  const cat = categoryMeta(currentScenario.category);
  const diff = difficultyMeta(currentScenario.difficulty);

  const filteredScenarios = scenarios.filter((item) => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return true;
    return [
      item.title, item.subtitle, item.description, item.category,
      categoryMeta(item.category).label, difficultyMeta(item.difficulty).label,
      item.tags.join(' '),
    ].join(' ').toLowerCase().includes(q);
  });
  const favoriteMessages = sortSessions(sessions).flatMap((session) =>
    session.messages.filter((message) => message.favorite).map((message) => ({ session, message })),
  );
  const activeSessionAnalyses = activeSession
    ? [...analyses].filter((entry) => entry.sessionId === activeSession.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [];
  const latestUserSentence = activeSession ? lastUserMessage(activeSession.messages) : null;
  const currentSessionAnalysis =
    (latestUserSentence &&
      activeSessionAnalyses.find((entry) => entry.sentence.trim().toLowerCase() === latestUserSentence.text.trim().toLowerCase())) ||
    activeSessionAnalyses[0] || null;
  const weeklySessions = sessions.filter((session) => Date.now() - new Date(session.updatedAt).getTime() < 7 * 24 * 60 * 60 * 1000);
  const totalTurns = sessions.reduce((sum, session) => sum + session.messages.length, 0);
  const weeklyMinutes = Math.round(
    weeklySessions.reduce(
      (sum, session) => sum + session.messages.filter((m) => m.role === 'user').reduce((inner, m) => inner + words(m.text), 0), 0,
    ) / 110,
  );
  const goalProgress = Math.min(100, Math.round((weeklyMinutes / Math.max(1, settings.dailyMinutesGoal)) * 100));
  const spotlightScenario = scenarioById(spotlightScenarioIds[new Date().getDate() % spotlightScenarioIds.length]);
  const pageMeta = PAGE_META[view];
  const hasCurrentScenarioSession = Boolean(activeSession && activeSession.scenarioId === selectedScenarioId);
  const hasCurrentMessages = Boolean(hasCurrentScenarioSession && activeSession?.messages.length);
  const suggestionChips = (bundle?.suggestions.length ? bundle.suggestions : currentScenario.warmups).slice(0, 3);
  const recentSessions = sortSessions(sessions).slice(0, 8);
  const sessionChallengeSnapshots = sessions.map((session) => ({ session, challenge: challengeStatsForSession(session, analyses) }));
  const challengeSessions = sessionChallengeSnapshots.filter((item) => item.challenge.enabled);
  const reviewedChallengeSessions = challengeSessions.filter((item) => item.challenge.review);
  const bestChallengeScore = reviewedChallengeSessions.reduce((max, item) => Math.max(max, item.challenge.review?.score100 ?? 0), 0);
  const totalChallengeScore = reviewedChallengeSessions.reduce((sum, item) => sum + (item.challenge.review?.score100 ?? 0), 0);
  const challengeStatsBySession = new Map(sessionChallengeSnapshots.map((item) => [item.session.id, item.challenge]));
  const activeChallengeReview = hasCurrentScenarioSession ? activeSession?.challengeReview ?? null : null;
  const activeChallenge = buildChallengeSnapshot(
    activeSession && activeSession.scenarioId === selectedScenarioId
      ? activeSession
      : {
          id: '', scenarioId: selectedScenarioId, scenarioTitle: currentScenario.title, startedAt: '', updatedAt: '',
          messages: [], focusSkill, customScenario: customBrief, roleplayMode, challengeMode, challengeTargetTurns,
          challengeReview: null, notes, completedMissionSteps: [], summary: null,
        },
    currentScenario, analyses,
  );
  const activeChallengeLevel = resolveChallengeLevelView(activeChallengeReview);
  const activeChallengeSubscores = resolveChallengeSubscores(activeChallengeReview);
  const learnerLevel = Math.max(1, Math.floor(totalTurns / 12) + 1);
  const selectedTtsVoice =
    TTS_VOICE_OPTIONS.find((voice) => voice.name === settings.voiceName) ??
    TTS_VOICE_OPTIONS.find((voice) => voice.name === GEMINI_TTS_DEFAULT_VOICE) ?? TTS_VOICE_OPTIONS[0];
  const toolReady: Record<ToolTab, boolean> = {
    guide: true,
    suggestions: Boolean(bundle),
    analysis: Boolean(currentSessionAnalysis),
    challenge: Boolean(activeChallenge.enabled || activeChallengeReview),
    recap: Boolean(activeSession?.summary),
  };

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
    const applyVoices = () => setBrowserVoices(loadEnglishVoices().sort((a, b) => a.name.localeCompare(b.name, 'en')));
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
  useEffect(() => () => { stopRef.current?.(); stopSpeaking(); }, []);
  useEffect(() => {
    if (!notice) return;
    setToastVisible(true);
    const timer = window.setTimeout(() => setToastVisible(false), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const openTools = (tab: ToolTab) => { setToolTab(tab); setShowTools(true); };
  const toggleTools = (tab: ToolTab) => {
    if (showTools && toolTab === tab) { setShowTools(false); return; }
    openTools(tab);
  };

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
    setShowPicker(false);
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
    setShowTools(false);
    setNotice('새 상황으로 전환했어요. 이 상황은 새 세션으로 시작됩니다.');
  };

  // Quiet selection for browsing the library tree (no toast, keeps exploration calm).
  const previewScenario = (nextScenarioId: string) => {
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
    setShowTools(false);
  };

  const makeSession = (
    scenario: Scenario,
    overrides?: Partial<Pick<Session, 'focusSkill' | 'customScenario' | 'roleplayMode' | 'challengeMode' | 'challengeTargetTurns' | 'notes'>>,
  ): Session => {
    const now = new Date().toISOString();
    return {
      id: id('session'), scenarioId: scenario.id, scenarioTitle: scenario.title, startedAt: now, updatedAt: now, messages: [],
      focusSkill: overrides?.focusSkill ?? focusSkill,
      customScenario: overrides?.customScenario ?? customBrief,
      roleplayMode: overrides?.roleplayMode ?? roleplayMode,
      challengeMode: overrides?.challengeMode ?? challengeMode,
      challengeTargetTurns: overrides?.challengeTargetTurns ?? challengeTargetTurns,
      challengeReview: null, notes: overrides?.notes ?? notes, completedMissionSteps: [], summary: null,
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

  const offlineOpening = (session: Session) => {
    const resolved = resolveScenarioDetails(selectedScenario, session);
    return `Hi there! 🙂 We're practicing "${resolved.title}". I'll stay in character the whole time — start whenever you're ready, and I'll react like the real thing. What would you like to say first?`;
  };

  const kickoffConversation = async (session: Session) => {
    if (!settings.apiKey.trim()) {
      const now = new Date().toISOString();
      upsert({ ...session, updatedAt: now, messages: [{ id: id('msg'), role: 'assistant', text: offlineOpening(session), createdAt: now }] });
      return;
    }
    setBusy('chat');
    setStreamingReply('');
    try {
      const request = {
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim(),
        systemInstruction: buildConversationSystemPrompt(selectedScenario, session, settings),
        history: [],
        userPrompt: 'Begin the roleplay now. In character, greet me warmly in one or two short sentences, set the scene, and ask one simple opening question to get me talking. Keep it natural, spoken, and friendly.',
        maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
      };
      let reply = '';
      try { reply = await streamText(request, (partial) => setStreamingReply(partial)); }
      catch { setStreamingReply(''); reply = await generateText(request); }
      const finalReply = reply.trim() || offlineOpening(session);
      setStreamingReply('');
      const now = new Date().toISOString();
      upsert({ ...session, updatedAt: now, messages: [{ id: id('msg'), role: 'assistant', text: finalReply, createdAt: now }] });
      if (settings.autoSpeakAi) void playAssistantAudio(finalReply);
    } catch {
      const now = new Date().toISOString();
      upsert({ ...session, updatedAt: now, messages: [{ id: id('msg'), role: 'assistant', text: offlineOpening(session), createdAt: now }] });
    } finally {
      setBusy(null);
      setStreamingReply('');
    }
  };

  const startFreshSession = ({ challenge = false, greet = false, noticeMessage }: { challenge?: boolean; greet?: boolean; noticeMessage?: string } = {}) => {
    if (selectedScenario.isCustom && !customBrief.trim()) {
      openTools('guide');
      setNotice('커스텀 상황은 먼저 브리프를 입력해야 시작할 수 있어요.');
      return null;
    }
    const session = makeSession(selectedScenario, { challengeMode: challenge, challengeTargetTurns, focusSkill, customScenario: customBrief, roleplayMode, notes });
    setChallengeMode(challenge);
    setComposer('');
    setStreamingReply('');
    setShowPicker(false);
    upsert(session);
    setBundle(buildStarterBundle(session));
    setNotice(noticeMessage ?? (challenge ? `${challengeTargetTurns}턴 챌린지를 시작했어요!` : '새 말하기 세션이 준비됐어요!'));
    if (greet) void kickoffConversation(session);
    return session;
  };

  const evaluateChallengeSession = async (session: Session) => {
    const resolvedScenario = resolveScenarioDetails(selectedScenario, session);
    const snapshot = buildChallengeSnapshot(session, resolvedScenario, analyses);
    const fallback = buildOfflineChallengeReview(resolvedScenario, session, snapshot);
    try {
      const payload = await generateJson<Partial<ChallengeReview>>({
        apiKey: settings.apiKey.trim(), model: settings.model.trim(), systemInstruction: 'Return only valid JSON.',
        userPrompt: buildChallengeReviewPrompt(resolvedScenario, session, snapshot.targetTurns), temperature: 0.2,
      });
      const challengeReview = normalizeChallengeReview(payload, fallback);
      const reviewedSession = upsert({ ...session, challengeReview, updatedAt: new Date().toISOString() });
      return { reviewedSession, challengeReview, usedFallback: false };
    } catch (error) {
      const reviewedSession = upsert({ ...session, challengeReview: fallback, updatedAt: new Date().toISOString() });
      return { reviewedSession, challengeReview: fallback, usedFallback: true, error };
    }
  };

  const ensureSession = () => {
    if (selectedScenario.isCustom && !customBrief.trim()) {
      openTools('guide');
      setNotice('커스텀 상황은 먼저 브리프를 입력해야 시작할 수 있어요.');
      return null;
    }
    if (hasCurrentScenarioSession && activeSession) return activeSession;
    return startFreshSession({ challenge: challengeMode, noticeMessage: '새 말하기 세션이 준비됐어요!' });
  };

  const restartConversation = () => {
    if (hasCurrentMessages && !window.confirm('현재 대화 내용을 비우고 같은 상황으로 다시 시작할까요?')) return;
    startFreshSession({
      challenge: activeChallenge.enabled,
      greet: true,
      noticeMessage: activeChallenge.enabled ? `${challengeTargetTurns}턴 챌린지를 처음부터 다시 시작해요.` : '대화를 비우고 같은 상황으로 다시 시작했어요.',
    });
  };

  const startChallenge = () => {
    openTools('challenge');
    startFreshSession({ challenge: true, greet: true, noticeMessage: `${challengeTargetTurns}턴 챌린지 시작! 첫 문장부터 점수가 계산돼요.` });
  };

  const retryChallenge = () => {
    if (hasCurrentMessages && !window.confirm('현재 챌린지를 버리고 같은 조건으로 다시 도전할까요?')) return;
    startFreshSession({ challenge: true, greet: true, noticeMessage: `${challengeTargetTurns}턴 챌린지를 다시 시작해요.` });
  };

  const stopChallenge = () => {
    setChallengeMode(false);
    if (hasCurrentScenarioSession && activeSession) upsert({ ...activeSession, challengeMode: false, updatedAt: new Date().toISOString() });
    setNotice('챌린지 모드를 정지하고 일반 연습으로 전환했어요.');
  };

  const playAssistantAudio = async (text: string, voiceName = settings.voiceName, cacheKey?: string) => {
    const result = await speakText({ text, apiKey: settings.apiKey.trim(), voiceName, rate: settings.speechRate, cacheKey });
    if (result === 'browser-fallback-daily') setNotice('Gemini TTS 일일 한도를 모두 써서 기본 브라우저 음성으로 전환했어요.');
    else if (result === 'browser-fallback') setNotice('Gemini TTS를 쓸 수 없어 이번 재생은 브라우저 음성으로 전환했어요.');
    else if (result === 'none') setNotice('음성을 재생할 수 없어요.');
  };

  const previewVoice = async (voiceName: string, sampleText: string) => {
    setPreviewingVoiceName(voiceName);
    try {
      await previewVoiceSample({ text: sampleText, apiKey: settings.apiKey.trim(), voiceName, rate: settings.speechRate, cacheKey: `preview-v1:${voiceName}:${sampleText}` });
    } finally {
      setPreviewingVoiceName((current) => (current === voiceName ? '' : current));
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!composer.trim() || busy === 'chat' || busy === 'challenge') return;
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
    const previousUserTurns = session.messages.filter((m) => m.role === 'user').length;
    const pending = upsert({
      ...session, focusSkill, roleplayMode, challengeMode, challengeTargetTurns, notes, customScenario: customBrief,
      updatedAt: new Date().toISOString(),
      messages: [...session.messages, { id: id('msg'), role: 'user', text, createdAt: new Date().toISOString() }],
    });
    setComposer('');
    setStreamingReply('');
    setBusy('chat');
    try {
      const chatRequest = {
        apiKey: settings.apiKey.trim(), model: settings.model.trim(),
        systemInstruction: buildConversationSystemPrompt(selectedScenario, pending, settings),
        history: trimChatHistory(pending.messages.slice(0, -1)), userPrompt: text, maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
      };
      let reply = '';
      try { reply = await streamText(chatRequest, (partial) => setStreamingReply(partial)); }
      catch { setStreamingReply(''); reply = await generateText(chatRequest); }
      const finalReply = reply.trim();
      if (!finalReply) throw new Error('Gemini response did not contain text.');
      setStreamingReply('');
      const completedSession = upsert({
        ...pending, updatedAt: new Date().toISOString(),
        messages: [...pending.messages, { id: id('msg'), role: 'assistant', text: finalReply, createdAt: new Date().toISOString() }],
      });
      if (settings.autoSpeakAi) void playAssistantAudio(finalReply);
      if (challengeMode && previousUserTurns < challengeTargetTurns && previousUserTurns + 1 >= challengeTargetTurns) {
        setBusy('challenge');
        openTools('challenge');
        const result = await evaluateChallengeSession(completedSession);
        setNotice(
          result.usedFallback
            ? `챌린지 AI 채점이 실패해 로컬 결과를 표시합니다. ${result.challengeReview.grade} · ${result.challengeReview.score100}점`
            : `챌린지 결과가 나왔어요! ${result.challengeReview.medal} ${result.challengeReview.grade} · ${result.challengeReview.score100}점`,
        );
      } else {
        setNotice('AI 응답이 도착했어요.');
      }
    } catch (error) {
      setNotice(error instanceof Error ? `응답 생성 실패: ${error.message}` : '응답 생성에 실패했어요.');
    } finally {
      setStreamingReply('');
      setBusy(null);
    }
  };

  const suggest = async () => {
    const session = ensureSession();
    if (!session) return;
    if (!settings.apiKey.trim()) {
      setBundle({ suggestions: selectedScenario.warmups.slice(0, 3), coachTip: 'API 키가 없어 기본 워밍업 문장을 보여주고 있어요.', focusPoint: selectedScenario.challenge });
      openTools('suggestions');
      setNotice('AI 없이 기본 워밍업 문장을 보여주고 있어요.');
      return;
    }
    setBusy('suggestions');
    try {
      const payload = await generateJson<Partial<SuggestionBundle>>({
        apiKey: settings.apiKey.trim(), model: settings.model.trim(), systemInstruction: 'Return only valid JSON.',
        userPrompt: buildSuggestionPrompt(selectedScenario, session), temperature: 0.4,
      });
      setBundle(normalizeSuggestionBundle(payload, selectedScenario));
      openTools('suggestions');
      setNotice('다음 답변 후보 3개를 준비했어요.');
    } catch (error) {
      setNotice(error instanceof Error ? `다음 답변 추천 실패: ${error.message}` : '다음 답변 추천에 실패했어요.');
    } finally {
      setBusy(null);
    }
  };

  const analyze = async () => {
    if (!activeSession) { setNotice('먼저 한 문장을 보내야 분석할 수 있어요.'); return; }
    const target = lastUserMessage(activeSession.messages);
    if (!target) { setNotice('아직 분석할 최근 문장이 없어요.'); return; }
    if (!settings.apiKey.trim()) { setShowSettings(true); setNotice('문장 교정에는 API 키가 필요해요.'); return; }
    setBusy('analysis');
    try {
      const payload = await generateJson<Partial<AnalysisEntry>>({
        apiKey: settings.apiKey.trim(), model: settings.model.trim(), systemInstruction: 'Return only valid JSON.',
        userPrompt: buildAnalysisPrompt(selectedScenario, activeSession, target.text), temperature: 0.2,
      });
      const entry: AnalysisEntry = {
        id: id('analysis'), createdAt: new Date().toISOString(),
        ...normalizeAnalysisEntry(payload, target.text, activeSession.scenarioTitle, activeSession.id),
      };
      setAnalyses((current) => [entry, ...current]);
      setVocabulary((current) => mergeVocabulary(current, entry.vocabulary));
      openTools('analysis');
      setNotice('최근 문장을 교정했어요.');
    } catch (error) {
      setNotice(error instanceof Error ? `분석 실패: ${error.message}` : '분석에 실패했어요.');
    } finally {
      setBusy(null);
    }
  };

  const recap = async () => {
    if (!activeSession) { setNotice('요약할 활성 세션이 없어요.'); return; }
    const fallback = buildOfflineSummary(selectedScenario, activeSession);
    if (!settings.apiKey.trim()) {
      upsert({ ...activeSession, summary: fallback });
      setVocabulary((current) => mergeVocabulary(current, fallback.notableVocabulary));
      openTools('recap');
      setNotice('API 없이 로컬 대화 요약을 만들었어요.');
      return;
    }
    setBusy('recap');
    try {
      const payload = await generateJson<Partial<typeof fallback>>({
        apiKey: settings.apiKey.trim(), model: settings.model.trim(), systemInstruction: 'Return only valid JSON.',
        userPrompt: buildRecapPrompt(selectedScenario, activeSession), temperature: 0.25,
      });
      const summary = normalizeSummary(payload, fallback);
      upsert({ ...activeSession, summary });
      setVocabulary((current) => mergeVocabulary(current, summary.notableVocabulary));
      openTools('recap');
      setNotice('대화 요약이 준비됐어요.');
    } catch (error) {
      upsert({ ...activeSession, summary: fallback });
      openTools('recap');
      setNotice(error instanceof Error ? `대화 요약 생성 실패: ${error.message}` : '대화 요약 생성에 실패했어요.');
    } finally {
      setBusy(null);
    }
  };

  const toggleFavorite = (sessionId: string, messageId: string) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    upsert({ ...session, messages: session.messages.map((m) => (m.id === messageId ? { ...m, favorite: !m.favorite } : m)) });
  };

  const voiceInput = () => {
    if (!isSpeechRecognitionSupported()) { setNotice('이 브라우저에서는 음성 입력을 지원하지 않아요.'); return; }
    if (listening) {
      stopRef.current?.();
      stopRef.current = null;
      setListening(false);
      setNotice('음성 입력을 중지했어요.');
      return;
    }
    stopRef.current = listenOnce({
      lang: 'en-US',
      onResult: (transcript) => setComposer((current) => (current ? `${current} ${transcript}` : transcript)),
      onError: setNotice,
      onEnd: () => { setListening(false); stopRef.current = null; },
    });
    if (stopRef.current) { setListening(true); setNotice('영어 음성을 듣고 있어요.'); }
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
      setNotice('학습 데이터를 불러왔어요.');
    } catch (error) {
      setNotice(error instanceof Error ? `가져오기 실패: ${error.message}` : '가져오기에 실패했어요.');
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
    setShowTools(false);
    setShowSettings(false);
    setNotice('로컬 워크스페이스를 초기화했어요.');
  };

  const openReviewSession = (session: Session) => {
    setActiveSessionId(session.id);
    setSelectedScenarioId(session.scenarioId);
    setView('practice');
    setShowTools(false);
  };

  const toggleThemeMode = () =>
    setSettings((current) => ({ ...current, themeMode: current.themeMode === 'dark' ? 'light' : 'dark' }));

  const onExport = () => exportFile(`speakup-${new Date().toISOString().slice(0, 10)}.json`, createExportBundle(settings, sessions, analyses, vocabulary));

  const aiRole = roleplayMode === 'normal' ? currentScenario.aiRole : currentScenario.userRole;
  const myRole = roleplayMode === 'normal' ? currentScenario.userRole : currentScenario.aiRole;

  return (
    <>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark"><Icon name="sparkles" /></div>
            <div>
              <div className="brand-name">SpeakUp</div>
              <div className="brand-tag">Lv.{learnerLevel} · 즐겁게 말하기 훈련</div>
            </div>
          </div>

          <nav className="nav">
            {NAVS.map((item) => (
              <button key={item.id} type="button" className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)}>
                <Icon name={item.icon} />
                <span className="nav-label-desktop">{item.label}</span>
                <span className="nav-label-mobile">{item.mobileLabel}</span>
              </button>
            ))}
          </nav>

          <button
            type="button"
            className="spotlight"
            onClick={() => { handleScenarioSelect(spotlightScenario.id); setView('practice'); }}
          >
            <span className="spotlight-eyebrow"><Icon name="flame" /> 오늘의 추천</span>
            <strong>{spotlightScenario.title}</strong>
            <p>{spotlightScenario.challenge}</p>
          </button>

          <div className="sidebar-bottom">
            <button type="button" className="nav-item" onClick={() => setShowSettings(true)}>
              <Icon name="settings" /> <span>설정</span>
            </button>
            <div className="api-chip">
              <span className={`dot ${settings.apiKey.trim() ? 'on' : ''}`} />
              {settings.apiKey.trim() ? 'Gemini 연결됨' : 'API 키 필요'}
            </div>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <div>
              <div className="page-h1">{pageMeta.title}</div>
              <div className="page-sub">{pageMeta.description}</div>
            </div>
            <div className="topbar-spacer" />
            <div className="topbar-actions">
              <button type="button" className="btn-icon" onClick={() => fileRef.current?.click()} aria-label="불러오기"><Icon name="upload" /></button>
              <button type="button" className="btn-icon" onClick={onExport} aria-label="내보내기"><Icon name="download" /></button>
              <button type="button" className="btn-icon" onClick={toggleThemeMode} aria-label="테마 전환"><Icon name={settings.themeMode === 'dark' ? 'sun' : 'moon'} /></button>
              <button type="button" className="btn-icon" onClick={() => setShowSettings(true)} aria-label="설정"><Icon name="settings" /></button>
            </div>
          </header>

          {view === 'practice' && (
            <div className="practice" data-tools={showTools ? 'true' : 'false'}>
              <section className="chat-col">
                <div className="ctx-bar">
                  <div className="ctx-emoji" style={{ background: cat.soft, color: cat.color }}>{cat.emoji}</div>
                  <div className="ctx-info">
                    <div className="ctx-title">
                      {currentScenario.title}
                      <span className="pill" style={{ background: diff.soft, color: diff.color }}>{diff.label}</span>
                    </div>
                    <div className="ctx-roles">나: <b>{myRole}</b> · 상대: <b>{aiRole}</b></div>
                  </div>
                  <div className="ctx-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPicker(true)}>
                      <Icon name="grid" /><span className="label-hide">상황 바꾸기</span>
                    </button>
                    {hasCurrentMessages && (
                      <button type="button" className="btn-icon" onClick={restartConversation} aria-label="대화 다시 시작"><Icon name="refresh" /></button>
                    )}
                  </div>
                </div>

                <div ref={chatScrollRef} className="chat-feed">
                  {!activeSession?.messages.length && busy !== 'chat' && (
                    <EmptyState
                      icon={<Icon name="chat" />}
                      title="AI가 먼저 말을 걸어줘요"
                      description={currentScenario.challenge}
                      action={
                        <>
                          <button type="button" className="btn btn-primary" onClick={() => startFreshSession({ greet: true })}>
                            <Icon name="play" /> 대화 시작
                          </button>
                          <button type="button" className="btn btn-soft" onClick={startChallenge}>
                            <Icon name="bolt" /> 챌린지 시작
                          </button>
                        </>
                      }
                    />
                  )}

                  {activeSession?.messages.map((message) => (
                    <Msg
                      key={message.id}
                      message={message}
                      onFavorite={() => toggleFavorite(activeSession.id, message.id)}
                      onCopy={() => navigator.clipboard.writeText(message.text).then(() => setNotice('문장을 복사했어요.'))}
                      onSpeak={message.role === 'assistant' ? () => void playAssistantAudio(message.text) : undefined}
                    />
                  ))}

                  {busy === 'chat' && (
                    <article className="msg ai">
                      <div className="msg-avatar"><Icon name="sparkles" /></div>
                      <div className="msg-body">
                        <div className="msg-meta"><span className="msg-sender">AI 코치</span></div>
                        {streamingReply ? <div className="bubble">{streamingReply}</div> : <div className="bubble typing"><span /><span /><span /></div>}
                      </div>
                    </article>
                  )}
                </div>

                <div className="coach-bar">
                  <button type="button" className={`coach-btn ${showTools && toolTab === 'guide' ? 'is-on' : ''}`} onClick={() => toggleTools('guide')}>
                    <Icon name="list" /> 상황 가이드
                  </button>
                  <button type="button" className="coach-btn" onClick={suggest} disabled={busy === 'suggestions'}>
                    <Icon name="sparkles" /> {busy === 'suggestions' ? '추천 중…' : '다음 답변'}
                  </button>
                  <button type="button" className="coach-btn" onClick={analyze} disabled={busy === 'analysis' || !hasCurrentMessages}>
                    <Icon name="check" /> {busy === 'analysis' ? '교정 중…' : '문장 교정'}
                  </button>
                  <button type="button" className="coach-btn" onClick={recap} disabled={busy === 'recap' || !hasCurrentMessages}>
                    <Icon name="wave" /> {busy === 'recap' ? '요약 중…' : '대화 요약'}
                  </button>
                  {activeChallenge.enabled || activeChallengeReview ? (
                    <button type="button" className="coach-btn accent" onClick={() => openTools('challenge')}>
                      <Icon name="bolt" /> {activeChallengeReview ? `결과 ${activeChallengeReview.score100}점` : `챌린지 ${activeChallenge.userTurns}/${activeChallenge.targetTurns}`}
                    </button>
                  ) : (
                    <button type="button" className="coach-btn accent" onClick={startChallenge}>
                      <Icon name="bolt" /> 챌린지 시작
                    </button>
                  )}
                </div>

                <div className="composer">
                  {!hasCurrentMessages && suggestionChips.length > 0 && (
                    <div className="composer-chips">
                      {suggestionChips.map((item) => (
                        <button key={item} type="button" className="chip" onClick={() => setComposer((current) => (current ? `${current} ${item}` : item))}>{item}</button>
                      ))}
                    </div>
                  )}
                  <form onSubmit={send}>
                    <div className="composer-box">
                      <textarea rows={1} value={composer} onChange={(e) => setComposer(e.target.value)} onKeyDown={handleComposerKeyDown} placeholder="영어로 다음 문장을 입력해 보세요" />
                      {listening && (
                        <div className="wave" aria-hidden="true"><span /><span /><span /><span /></div>
                      )}
                      <button type="button" className={`mic-btn ${listening ? 'live' : ''}`} onClick={voiceInput} disabled={busy === 'challenge'} aria-label="음성 입력"><Icon name="mic" /></button>
                      <button type="submit" className="send-btn" disabled={busy === 'chat' || busy === 'challenge' || !composer.trim()} aria-label="메시지 보내기"><Icon name="send" /></button>
                    </div>
                  </form>
                </div>
              </section>

              {showTools && (
                <aside className="tools">
                  <div className="tools-head">
                    <div className="card-title">코치 도구</div>
                    <button type="button" className="btn-icon" onClick={() => setShowTools(false)} aria-label="패널 닫기"><Icon name="close" /></button>
                  </div>
                  <div className="tools-tabs" role="tablist">
                    {TOOL_TABS.map((tab) => (
                      <button key={tab.id} type="button" role="tab" aria-selected={toolTab === tab.id} className={`tools-tab ${toolTab === tab.id ? 'active' : ''}`} onClick={() => setToolTab(tab.id)}>
                        {tab.label}{toolReady[tab.id] && tab.id !== 'guide' ? ' •' : ''}
                      </button>
                    ))}
                  </div>
                  <div className="tools-body">
                    {toolTab === 'guide' && (
                      <>
                        <div className="field-row">
                          <label className="field">
                            <span className="field-label">집중 스킬</span>
                            <select className="select" value={focusSkill} onChange={(e) => { setFocusSkill(e.target.value); patchActive({ focusSkill: e.target.value }); }}>
                              {focusSkillOptions.map((option) => <option key={option} value={option}>{labelFocusSkill(option)}</option>)}
                            </select>
                          </label>
                          <label className="field">
                            <span className="field-label">역할 모드</span>
                            <select className="select" value={roleplayMode} onChange={(e) => { const next = e.target.value as RoleplayMode; setRoleplayMode(next); patchActive({ roleplayMode: next }); }}>
                              <option value="normal">기본 역할</option>
                              <option value="reverse">역할 반전</option>
                            </select>
                          </label>
                        </div>
                        <label className="field">
                          <span className="field-label">챌린지 목표 턴</span>
                          <select className="select" value={challengeTargetTurns} onChange={(e) => { const next = Number(e.target.value) || 8; setChallengeTargetTurns(next); patchActive({ challengeTargetTurns: next }); }}>
                            {CHALLENGE_TARGET_OPTIONS.map((turns) => <option key={turns} value={turns}>{turns}턴</option>)}
                          </select>
                        </label>
                        {selectedScenario.isCustom && (
                          <label className="field">
                            <span className="field-label">커스텀 브리프</span>
                            <textarea className="textarea" value={customBrief} onChange={(e) => { setCustomBrief(e.target.value); patchActive({ customScenario: e.target.value }); }} placeholder="상황, 상대 역할, 목표를 한국어로 적어 주세요" />
                          </label>
                        )}
                        <label className="field">
                          <span className="field-label">코칭 메모</span>
                          <textarea className="textarea" value={notes} onChange={(e) => { setNotes(e.target.value); patchActive({ notes: e.target.value }); }} placeholder="이번 세션에서 더 집중하고 싶은 포인트" />
                        </label>
                        <div className="block">
                          <span className="block-label">미션 단계</span>
                          <ul className="bullets">{currentScenario.missionSteps.map((step) => <li key={step}>{step}</li>)}</ul>
                        </div>
                        <div className="block">
                          <span className="block-label">핵심 표현 (탭하면 입력)</span>
                          <div className="chip-row">
                            {currentScenario.keyExpressions.map((item) => (
                              <button key={item} type="button" className="chip" onClick={() => setComposer((c) => (c ? `${c} ${item}` : item))}>{item}</button>
                            ))}
                          </div>
                        </div>
                        <div className="block">
                          <span className="block-label">어휘 세트</span>
                          <div className="vocab-chips">
                            {currentScenario.vocabulary.map((card) => (
                              <button key={card.phrase} type="button" className="vocab-chip" onClick={() => navigator.clipboard.writeText(card.example).then(() => setNotice('예문을 복사했어요.'))}>
                                <strong>{card.phrase}</strong><span>{card.meaningKo}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}

                    {toolTab === 'suggestions' && (
                      bundle ? (
                        <>
                          <div className="block">
                            <span className="block-label">바로 이어 말하기</span>
                            <div className="chip-row">
                              {bundle.suggestions.map((item) => <button key={item} type="button" className="chip" onClick={() => setComposer(item)}>{item}</button>)}
                            </div>
                          </div>
                          <div className="note"><span className="block-label">코치 팁</span>{bundle.coachTip}</div>
                          <div className="note amber"><span className="block-label">집중 포인트</span>{bundle.focusPoint}</div>
                        </>
                      ) : (
                        <EmptyState icon={<Icon name="sparkles" />} title="다음 답변 추천이 없어요" description="‘다음 답변’을 누르면 현재 흐름에 맞는 문장 후보를 제안해요." />
                      )
                    )}

                    {toolTab === 'analysis' && (
                      currentSessionAnalysis ? (
                        <>
                          <div className="compare">
                            <div className="compare-card"><span className="block-label">내 문장</span><p>{currentSessionAnalysis.sentence}</p></div>
                            <div className="compare-card good"><span className="block-label">추천 문장</span><p>{currentSessionAnalysis.revision}</p></div>
                          </div>
                          <p className="card-sub">{currentSessionAnalysis.overview}</p>
                          <div className="note green"><span className="block-label">왜 이렇게 바꾸나요?</span>{currentSessionAnalysis.koreanSummary}</div>
                          <div className="tri">
                            <div className="note green"><span className="block-label">잘한 점</span><ul className="bullets">{currentSessionAnalysis.strengths.map((i) => <li key={i}>{i}</li>)}</ul></div>
                            <div className="note"><span className="block-label">문법</span><ul className="bullets">{currentSessionAnalysis.grammar.map((i) => <li key={i}>{i}</li>)}</ul></div>
                            <div className="note amber"><span className="block-label">자연스러움</span><ul className="bullets">{currentSessionAnalysis.naturalness.map((i) => <li key={i}>{i}</li>)}</ul></div>
                          </div>
                        </>
                      ) : (
                        <EmptyState icon={<Icon name="check" />} title="문장 교정 결과가 없어요" description="대화 중 ‘문장 교정’을 누르면 내 문장과 추천 문장을 비교해 줘요." />
                      )
                    )}

                    {toolTab === 'challenge' && (
                      activeChallengeReview ? (
                        <>
                          <div className="score-hero">
                            <div className="score-ring">
                              <Ring value={activeChallengeReview.score100} color={gradeColor(activeChallengeReview.grade)} />
                              <span className="num">{activeChallengeReview.score100}</span>
                            </div>
                            <div className="score-info">
                              <div className="grade" style={{ color: gradeColor(activeChallengeReview.grade) }}>{activeChallengeReview.medal} · {activeChallengeReview.grade}등급</div>
                              <p>{activeChallengeLevel.label}</p>
                              <p>{activeChallengeReview.verdict}</p>
                            </div>
                          </div>
                          <div className="chip-row">{activeChallengeReview.rewards.map((r) => <span key={r} className="pill pill-amber">{r}</span>)}</div>
                          <div className="subscores">
                            {Object.entries(activeChallengeSubscores).map(([key, value]) => (
                              <div key={key} className="subscore">
                                <span>{CHALLENGE_SUBSCORE_LABELS[key as keyof ChallengeReview['subscores']]}</span>
                                <strong>{value}</strong>
                                <div className="bar"><i style={{ width: `${value}%` }} /></div>
                              </div>
                            ))}
                          </div>
                          <div className="note green"><span className="block-label">잘한 플레이</span><ul className="bullets">{activeChallengeReview.strengths.map((i) => <li key={i}>{i}</li>)}</ul></div>
                          <div className="note amber"><span className="block-label">감점 포인트</span><ul className="bullets">{activeChallengeReview.improvements.map((i) => <li key={i}>{i}</li>)}</ul></div>
                          <div className="note"><span className="block-label">다음 미션</span>{activeChallengeReview.nextMission}</div>
                          <div className="chip-row">
                            <button type="button" className="btn btn-soft btn-sm" onClick={retryChallenge}><Icon name="refresh" /> 다시 도전</button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={stopChallenge}>일반 연습으로</button>
                          </div>
                        </>
                      ) : activeChallenge.enabled || busy === 'challenge' ? (
                        <>
                          <div className="note amber">
                            <span className="block-label">{busy === 'challenge' ? '최종 채점 중' : '챌린지 진행 중'}</span>
                            {busy === 'challenge'
                              ? '상황 대응, 자연스러움, 핵심 표현, 대화 주도성을 기준으로 100점 만점 결과를 계산하고 있어요.'
                              : `${activeChallenge.userTurns}/${activeChallenge.targetTurns}턴 진행 중 · 남은 턴 ${activeChallenge.remainingTurns} · 핵심 표현 ${activeChallenge.expressionHits}회`}
                          </div>
                          <div className="progress"><i style={{ width: `${Math.min(100, Math.round((activeChallenge.userTurns / activeChallenge.targetTurns) * 100))}%` }} /></div>
                          {busy !== 'challenge' && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={stopChallenge}>챌린지 정지</button>
                          )}
                        </>
                      ) : (
                        <EmptyState icon={<Icon name="bolt" />} title="아직 챌린지 결과가 없어요"
                          description="‘챌린지 시작’으로 목표 턴을 채우면 AI가 100점 만점으로 채점해 줘요."
                          action={<button type="button" className="btn btn-primary" onClick={startChallenge}><Icon name="bolt" /> 챌린지 시작</button>} />
                      )
                    )}

                    {toolTab === 'recap' && (
                      activeSession?.summary ? (
                        <>
                          <p className="card-sub">{activeSession.summary.summary}</p>
                          <div className="cols-2">
                            <div className="note green"><span className="block-label">잘한 점</span><ul className="bullets">{activeSession.summary.wins.map((i) => <li key={i}>{i}</li>)}</ul></div>
                            <div className="note"><span className="block-label">다음 집중 포인트</span><ul className="bullets">{activeSession.summary.nextFocus.map((i) => <li key={i}>{i}</li>)}</ul></div>
                          </div>
                          <div className="note amber"><span className="block-label">숙제</span><ul className="bullets">{activeSession.summary.homework.map((i) => <li key={i}>{i}</li>)}</ul></div>
                        </>
                      ) : (
                        <EmptyState icon={<Icon name="wave" />} title="대화 요약이 없어요" description="‘대화 요약’을 누르면 이번 연습의 성과·집중 포인트·숙제를 정리해 줘요." />
                      )
                    )}
                  </div>
                </aside>
              )}
            </div>
          )}

          {view !== 'practice' && (
            <div className="main-scroll">
              <div className="page">
                {view === 'library' && (
                  <LibraryView
                    scenarios={filteredScenarios}
                    selectedId={selectedScenarioId}
                    selectedScenario={selectedScenario}
                    search={search}
                    onSearch={setSearch}
                    onSelect={(scenarioId) => previewScenario(scenarioId)}
                    onPractice={() => { setView('practice'); setShowTools(false); }}
                    onComposer={setComposer}
                  />
                )}
                {view === 'review' && (
                  <ReviewView
                    recentSessions={recentSessions}
                    favoriteMessages={favoriteMessages}
                    analyses={analyses}
                    vocabulary={vocabulary}
                    challengeStatsBySession={challengeStatsBySession}
                    onOpenSession={openReviewSession}
                  />
                )}
                {view === 'analytics' && (
                  <AnalyticsView
                    sessions={sessions}
                    totalTurns={totalTurns}
                    weeklyMinutes={weeklyMinutes}
                    goalProgress={goalProgress}
                    dailyGoal={settings.dailyMinutesGoal}
                    streakDays={streak(sortSessions(sessions))}
                    clearedChallenges={reviewedChallengeSessions.length}
                    bestChallengeScore={bestChallengeScore}
                    totalChallengeScore={totalChallengeScore}
                    challengeSessions={challengeSessions}
                    recentSessions={recentSessions}
                    challengeStatsBySession={challengeStatsBySession}
                    browserVoiceCount={browserVoices.length}
                    onOpenSession={openReviewSession}
                  />
                )}
              </div>
            </div>
          )}

          <input ref={fileRef} hidden type="file" accept="application/json" onChange={importData} />
        </div>
      </div>

      {/* Scenario picker */}
      <div className={`scrim ${showPicker ? 'open' : ''}`} onClick={() => setShowPicker(false)} />
      <div className={`picker ${showPicker ? 'open' : ''}`} role="dialog" aria-hidden={!showPicker} aria-label="시나리오 선택">
        <div className="picker-head">
          <div className="card-title">상황 고르기</div>
          <button type="button" className="btn-icon" onClick={() => setShowPicker(false)} aria-label="닫기"><Icon name="close" /></button>
        </div>
        <div className="picker-body">
          {CATEGORY_META.map((meta) => {
            const items = scenarios.filter((scenario) => scenario.category === meta.key);
            if (!items.length) return null;
            return (
              <div key={meta.key} className="block">
                <div className="cat-head">
                  <span className="cat-badge" style={{ background: meta.soft, color: meta.color }}>{meta.emoji}</span>
                  <div><div className="cat-name" style={{ fontSize: 14 }}>{meta.label}</div></div>
                  <span className="pill cat-count">{items.length}</span>
                </div>
                <div className="list">
                  {items.map((scenario) => {
                    const dm = difficultyMeta(scenario.difficulty);
                    return (
                      <button key={scenario.id} type="button" className={`picker-row ${scenario.id === selectedScenarioId ? 'sel' : ''}`} onClick={() => handleScenarioSelect(scenario.id)}>
                        <span className="scn-emoji" style={{ background: meta.soft, color: meta.color, width: 34, height: 34, fontSize: 17 }}>{meta.emoji}</span>
                        <div className="list-main">
                          <div className="list-title">{scenario.title}</div>
                          <div className="list-meta">{scenario.subtitle}</div>
                        </div>
                        <span className="pill" style={{ background: dm.soft, color: dm.color }}>{dm.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Settings drawer */}
      <div className={`scrim ${showSettings ? 'open' : ''}`} onClick={() => setShowSettings(false)} />
      <aside className={`drawer ${showSettings ? 'open' : ''}`} aria-hidden={!showSettings}>
        <div className="drawer-head">
          <h2>설정</h2>
          <button type="button" className="btn-icon" onClick={() => setShowSettings(false)} aria-label="설정 닫기"><Icon name="close" /></button>
        </div>
        <div className="drawer-body">
          <section className="settings-group">
            <h3>Gemini 연결</h3>
            <label className="field">
              <span className="field-label">API 키</span>
              <input className="input" type="password" value={settings.apiKey} onChange={(e) => setSettings((c) => ({ ...c, apiKey: e.target.value }))} placeholder="Gemini API 키를 붙여 넣어 주세요" />
              <span className="field-hint">브라우저에서 직접 사용하며, 내보내기 파일에는 포함되지 않아요. 현재 모델: {settings.model}</span>
            </label>
            <label className="field">
              <span className="field-label">코치 모드</span>
              <select className="select" value={settings.coachMode} onChange={(e) => setSettings((c) => ({ ...c, coachMode: e.target.value as Settings['coachMode'] }))}>
                <option value="gentle">부드럽게</option>
                <option value="balanced">균형 있게</option>
                <option value="push">직설적으로</option>
              </select>
            </label>
            <ToggleRow label="API 키 로컬 저장" description="끄면 새로고침 후 저장된 API 키를 지워요." checked={settings.saveApiKey} onChange={(checked) => setSettings((c) => ({ ...c, saveApiKey: checked }))} />
          </section>

          <section className="settings-group">
            <h3>음성</h3>
            <label className="field">
              <span className="field-label">영어 음성</span>
              <select className="select" value={settings.voiceName} onChange={(e) => setSettings((c) => ({ ...c, voiceName: e.target.value }))}>
                <optgroup label="Female">{TTS_VOICE_GROUPS.female.map((v) => <option key={v.name} value={v.name}>{v.name} / {v.tone}</option>)}</optgroup>
                <optgroup label="Male">{TTS_VOICE_GROUPS.male.map((v) => <option key={v.name} value={v.name}>{v.name} / {v.tone}</option>)}</optgroup>
              </select>
            </label>
            <div className="toggle-row">
              <span className="field-hint">{`선택: ${selectedTtsVoice.name} / ${selectedTtsVoice.tone} / ${selectedTtsVoice.group === 'female' ? '여성' : '남성'}`}</span>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => void previewVoice(settings.voiceName, selectedTtsVoice.sampleText)} disabled={previewingVoiceName === settings.voiceName}>
                {previewingVoiceName === settings.voiceName ? '재생 중' : '샘플 듣기'}
              </button>
            </div>
            <label className="field">
              <span className="field-label">재생 속도</span>
              <input className="input" type="number" min="0.7" max="1.3" step="0.1" value={settings.speechRate} onChange={(e) => setSettings((c) => ({ ...c, speechRate: Number(e.target.value) || 1 }))} />
            </label>
            <ToggleRow label="AI 응답 자동 재생" description="AI 문장이 도착하면 바로 음성으로 읽어 줘요." checked={settings.autoSpeakAi} onChange={(checked) => setSettings((c) => ({ ...c, autoSpeakAi: checked }))} />
          </section>

          <section className="settings-group">
            <h3>연습</h3>
            <label className="field">
              <span className="field-label">표시 이름</span>
              <input className="input" value={settings.userName} onChange={(e) => setSettings((c) => ({ ...c, userName: e.target.value }))} placeholder="선택 입력" />
            </label>
            <label className="field">
              <span className="field-label">하루 목표 시간(분)</span>
              <input className="input" type="number" value={settings.dailyMinutesGoal} onChange={(e) => setSettings((c) => ({ ...c, dailyMinutesGoal: Number(e.target.value) || 20 }))} />
            </label>
          </section>

          <section className="settings-group">
            <h3>워크스페이스</h3>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => fileRef.current?.click()}><Icon name="upload" /> 학습 데이터 불러오기</button>
            <button type="button" className="btn btn-soft btn-block" onClick={onExport}><Icon name="download" /> 학습 데이터 내보내기</button>
            <button type="button" className="btn btn-danger btn-block" onClick={resetWorkspace}>로컬 워크스페이스 초기화</button>
            <p className="field-hint">API 키는 내보내기 파일에 포함되지 않아요. 세션·분석·어휘는 직접 내보내기 전까지 이 기기에만 남아요.</p>
          </section>
        </div>
      </aside>

      <div className="toast-wrap" aria-live="polite">
        {toastVisible && notice ? (
          <div className={`toast ${inferToastTone(notice)}`}>
            <div className="toast-ic"><Icon name={inferToastTone(notice) === 'error' ? 'close' : inferToastTone(notice) === 'success' ? 'check' : 'sparkles'} /></div>
            <div>
              <div className="toast-title">SpeakUp</div>
              <div className="toast-msg">{notice}</div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

/* ============================ Library view ============================ */
function LibraryView({
  scenarios: list, selectedId, selectedScenario, search, onSearch, onSelect, onPractice, onComposer,
}: {
  scenarios: Scenario[];
  selectedId: string;
  selectedScenario: Scenario;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onPractice: () => void;
  onComposer: (value: string) => void;
}) {
  const searching = search.trim().length > 0;
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({ [categoryMeta(selectedScenario.category).key]: true }));
  const groups = CATEGORY_META
    .map((meta) => ({ meta, items: list.filter((scenario) => scenario.category === meta.key) }))
    .filter((group) => group.items.length > 0 || !searching);
  const allOpen = groups.length > 0 && groups.every((group) => searching || expanded[group.meta.key]);
  const toggle = (key: string) => setExpanded((current) => ({ ...current, [key]: !current[key] }));
  const setAll = (open: boolean) => setExpanded(Object.fromEntries(CATEGORY_META.map((meta) => [meta.key, open])));

  const detailCat = categoryMeta(selectedScenario.category);
  const detailDiff = difficultyMeta(selectedScenario.difficulty);

  return (
    <div className="lib-tree-layout">
      <aside className="card lib-tree animate-in">
        <div className="tree-toolbar">
          <div className="lib-search">
            <Icon name="search" />
            <input className="input" placeholder="시나리오 검색" value={search} onChange={(e) => onSearch(e.target.value)} />
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(!allOpen)} disabled={searching}>
            {allOpen ? '접기' : '펼치기'}
          </button>
        </div>
        <div className="tree">
          {groups.map(({ meta, items }) => {
            const open = searching || Boolean(expanded[meta.key]);
            return (
              <div key={meta.key} className="tree-node">
                <button type="button" className="tree-cat" onClick={() => { if (!searching) toggle(meta.key); }} aria-expanded={open}>
                  <span className={`tree-chevron ${open ? 'open' : ''}`}><Icon name="chevron" /></span>
                  <span className="tree-cat-badge" style={{ background: meta.soft, color: meta.color }}>{meta.emoji}</span>
                  <span className="tree-cat-name">{meta.label}</span>
                  <span className="pill tree-cat-count">{items.length}</span>
                </button>
                {open && (
                  <div className="tree-children">
                    {items.map((scenario) => {
                      const dm = difficultyMeta(scenario.difficulty);
                      return (
                        <button
                          key={scenario.id}
                          type="button"
                          className={`tree-leaf ${scenario.id === selectedId ? 'sel' : ''}`}
                          onClick={() => onSelect(scenario.id)}
                        >
                          <span className="tree-leaf-dot" style={{ background: dm.color }} />
                          <span className="tree-leaf-title">{scenario.title}</span>
                          <span className="tree-leaf-diff" style={{ color: dm.color }}>{dm.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {!groups.length && (
            <EmptyState icon={<Icon name="search" />} title="검색 결과가 없어요" description="다른 키워드로 다시 찾아보세요." />
          )}
        </div>
      </aside>

      <section className="card lib-detail-pane animate-in">
        <div className="card-head">
          <div className="cat-head" style={{ gap: 11 }}>
            <span className="cat-badge" style={{ background: detailCat.soft, color: detailCat.color }}>{detailCat.emoji}</span>
            <div>
              <div className="card-title">{selectedScenario.title}</div>
              <div className="card-sub">{selectedScenario.subtitle}</div>
            </div>
          </div>
          <span className="pill" style={{ background: detailDiff.soft, color: detailDiff.color }}>{detailDiff.label}</span>
        </div>
        <p className="card-sub" style={{ fontSize: 14 }}>{selectedScenario.description}</p>
        <div className="cols-2" style={{ marginTop: 16 }}>
          <div className="block">
            <span className="block-label">목표</span>
            <ul className="bullets">{selectedScenario.goals.map((goal) => <li key={goal}>{goal}</li>)}</ul>
          </div>
          <div className="block">
            <span className="block-label">미션 단계</span>
            <ul className="bullets">{selectedScenario.missionSteps.map((step) => <li key={step}>{step}</li>)}</ul>
          </div>
        </div>
        <div className="block" style={{ marginTop: 16 }}>
          <span className="block-label">핵심 표현 (탭하면 입력칸에 넣어요)</span>
          <div className="chip-row">{selectedScenario.keyExpressions.map((item) => <button key={item} type="button" className="chip" onClick={() => onComposer(item)}>{item}</button>)}</div>
        </div>
        <div className="block" style={{ marginTop: 16 }}>
          <span className="block-label">어휘 미리보기</span>
          <div className="vlist">
            {selectedScenario.vocabulary.map((card) => (
              <div key={card.phrase} className="vrow">
                <span className="vrow-icon"><Icon name="sparkles" /></span>
                <div>
                  <div className="vrow-phrase">{card.phrase}</div>
                  <div className="vrow-mean">{card.meaningKo}</div>
                  <div className="vrow-ex">{card.example}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="chip-row" style={{ marginTop: 18 }}>
          <button type="button" className="btn btn-primary" onClick={() => { onSelect(selectedScenario.id); onPractice(); }}><Icon name="play" /> 이 상황으로 연습하기</button>
        </div>
      </section>
    </div>
  );
}

/* ============================ Review view ============================ */
function ReviewView({
  recentSessions, favoriteMessages, analyses, vocabulary, challengeStatsBySession, onOpenSession,
}: {
  recentSessions: Session[];
  favoriteMessages: Array<{ session: Session; message: Session['messages'][number] }>;
  analyses: AnalysisEntry[];
  vocabulary: VocabularyCard[];
  challengeStatsBySession: Map<string, ReturnType<typeof buildChallengeSnapshot>>;
  onOpenSession: (session: Session) => void;
}) {
  return (
    <div className="grid-2">
      <section className="card animate-in">
        <div className="card-head"><div><div className="card-title">세션 기록</div><div className="card-sub">이전 연습으로 바로 돌아가요.</div></div></div>
        {recentSessions.length ? (
          <div className="list">
            {recentSessions.map((session) => {
              const challenge = challengeStatsBySession.get(session.id);
              return (
                <button key={session.id} type="button" className="list-row" onClick={() => onOpenSession(session)}>
                  <span className="list-icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}><Icon name="chat" /></span>
                  <div className="list-main">
                    <div className="list-title">{session.scenarioTitle}</div>
                    <div className="list-meta">{session.messages.filter((m) => m.role === 'user').length}턴 · {formatDate(session.updatedAt)}</div>
                  </div>
                  <span className="list-tail">{challenge?.review ? `${challenge.review.medal} ${challenge.review.score100}` : challenge?.enabled ? '진행중' : labelFocusSkill(session.focusSkill)}</span>
                </button>
              );
            })}
          </div>
        ) : <EmptyState icon={<Icon name="chat" />} title="아직 세션이 없어요" description="대화 연습을 시작하면 최근 세션이 여기에 쌓여요." />}
      </section>

      <section className="card animate-in">
        <div className="card-head"><div><div className="card-title">저장한 문장</div><div className="card-sub">복습하려고 표시해 둔 문장.</div></div><span className="pill">{favoriteMessages.length}</span></div>
        {favoriteMessages.length ? (
          <div className="list">
            {favoriteMessages.map(({ session, message }) => (
              <div key={message.id} className="list-row">
                <span className="list-icon" style={{ background: 'var(--amber-soft)', color: 'var(--amber)' }}><Icon name="bookmarkFilled" /></span>
                <div className="list-main">
                  <div className="list-title" style={{ fontWeight: 600 }}>{message.text}</div>
                  <div className="list-meta">{session.scenarioTitle} · {formatDate(message.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState icon={<Icon name="bookmark" />} title="저장한 문장이 없어요" description="채팅 말풍선의 저장 버튼으로 좋은 문장을 모아 둘 수 있어요." />}
      </section>

      <section className="card animate-in">
        <div className="card-head"><div><div className="card-title">교정 아카이브</div><div className="card-sub">최근 AI 문장 교정.</div></div><span className="pill">{analyses.length}</span></div>
        {analyses.length ? (
          <div className="list">
            {analyses.slice(0, 10).map((analysis) => (
              <div key={analysis.id} className="note green">
                <span className="block-label">{analysis.scenarioTitle}</span>
                <div style={{ color: 'var(--faint)', fontSize: 13, textDecoration: 'line-through' }}>{analysis.sentence}</div>
                <div style={{ color: 'var(--ink)', fontWeight: 600, marginTop: 3 }}>{analysis.revision}</div>
              </div>
            ))}
          </div>
        ) : <EmptyState icon={<Icon name="check" />} title="교정 기록이 없어요" description="세션에서 문장 교정을 실행하면 기록이 쌓여요." />}
      </section>

      <section className="card animate-in">
        <div className="card-head"><div><div className="card-title">어휘 뱅크</div><div className="card-sub">교정·요약에서 모은 표현.</div></div><span className="pill">{vocabulary.length}</span></div>
        {vocabulary.length ? (
          <div className="vlist">
            {vocabulary.map((card) => (
              <div key={card.phrase} className="vrow">
                <span className="vrow-icon" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}><Icon name="wave" /></span>
                <div>
                  <div className="vrow-phrase">{card.phrase}</div>
                  <div className="vrow-mean">{card.meaningKo}</div>
                  {card.example ? <div className="vrow-ex">{card.example}</div> : null}
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState icon={<Icon name="wave" />} title="어휘 뱅크가 비어 있어요" description="AI 교정이나 요약을 실행하면 새 카드가 추가돼요." />}
      </section>
    </div>
  );
}

/* ============================ Analytics view ============================ */
function AnalyticsView({
  sessions, totalTurns, weeklyMinutes, goalProgress, dailyGoal, streakDays,
  clearedChallenges, bestChallengeScore, totalChallengeScore, challengeSessions, recentSessions, challengeStatsBySession, browserVoiceCount, onOpenSession,
}: {
  sessions: Session[];
  totalTurns: number;
  weeklyMinutes: number;
  goalProgress: number;
  dailyGoal: number;
  streakDays: number;
  clearedChallenges: number;
  bestChallengeScore: number;
  totalChallengeScore: number;
  challengeSessions: Array<{ session: Session; challenge: ReturnType<typeof buildChallengeSnapshot> }>;
  recentSessions: Session[];
  challengeStatsBySession: Map<string, ReturnType<typeof buildChallengeSnapshot>>;
  browserVoiceCount: number;
  onOpenSession: (session: Session) => void;
}) {
  const stats: Array<{ icon: IconName; value: string; suffix?: string; label: string; color: string; soft: string }> = [
    { icon: 'flame', value: String(streakDays), suffix: '일', label: '연속 학습', color: '#ef4444', soft: '#fef0f0' },
    { icon: 'chat', value: String(sessions.length), label: '총 세션', color: '#7c5cff', soft: '#f1eeff' },
    { icon: 'clock', value: String(weeklyMinutes), suffix: '분', label: '주간 말하기', color: '#0ea5e9', soft: '#ecfbff' },
    { icon: 'wave', value: String(totalTurns), label: '전체 대화 턴', color: '#22c55e', soft: '#e9fbf3' },
    { icon: 'trophy', value: String(clearedChallenges), label: '챌린지 클리어', color: '#f59e0b', soft: '#fff5e6' },
    { icon: 'target', value: String(bestChallengeScore), suffix: '점', label: '최고 챌린지', color: '#ec4899', soft: '#fdeef6' },
  ];
  return (
    <>
      <section className="stat-grid">
        {stats.map((stat) => (
          <div key={stat.label} className="stat animate-in">
            <div className="stat-ic" style={{ background: stat.soft, color: stat.color }}><Icon name={stat.icon} /></div>
            <div className="stat-num">{stat.value}{stat.suffix ? <span>{stat.suffix}</span> : null}</div>
            <div className="stat-lbl">{stat.label}</div>
          </div>
        ))}
      </section>

      <section className="card animate-in">
        <div className="card-head"><div><div className="card-title">주간 목표</div><div className="card-sub">최근 세션의 말한 단어 수로 추정해요.</div></div><span className="pill pill-brand">{goalProgress}%</span></div>
        <div className="goal-ring">
          <div className="ring-lg"><Ring value={goalProgress} /><span className="pct">{goalProgress}%</span></div>
          <div>
            <p className="card-sub" style={{ fontSize: 14, color: 'var(--ink)' }}>이번 주 <b>{weeklyMinutes}분</b> 기록</p>
            <p className="card-sub">하루 목표 {dailyGoal}분 기준이에요. 조금만 더 하면 목표 달성! 🎉</p>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section className="card animate-in">
          <div className="card-head"><div><div className="card-title">최근 세션</div><div className="card-sub">이번 주 학습 흐름.</div></div></div>
          {recentSessions.length ? (
            <div className="list">
              {recentSessions.map((session) => {
                const challenge = challengeStatsBySession.get(session.id);
                return (
                  <button key={session.id} type="button" className="list-row" onClick={() => onOpenSession(session)}>
                    <span className="list-icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}><Icon name="chart" /></span>
                    <div className="list-main">
                      <div className="list-title">{session.scenarioTitle}</div>
                      <div className="list-meta">{session.messages.length}턴 · {formatDate(session.updatedAt)}</div>
                    </div>
                    <span className="list-tail">{challenge?.review ? `${challenge.review.score100}점` : challenge?.enabled ? '진행중' : '연습'}</span>
                  </button>
                );
              })}
            </div>
          ) : <EmptyState icon={<Icon name="chart" />} title="아직 통계가 없어요" description="세션을 몇 개 완료하면 대시보드가 채워져요." />}
        </section>

        <section className="card animate-in">
          <div className="card-head"><div><div className="card-title">챌린지 보드</div><div className="card-sub">누적 점수와 도전 진행도.</div></div><span className="pill pill-amber">{totalChallengeScore}점</span></div>
          {challengeSessions.length ? (
            <div className="list">
              {challengeSessions.slice(0, 6).map(({ session, challenge }) => (
                <button key={session.id} type="button" className="list-row" onClick={() => onOpenSession(session)}>
                  <span className="list-icon" style={{ background: 'var(--amber-soft)', color: 'var(--amber)' }}><Icon name="bolt" /></span>
                  <div className="list-main">
                    <div className="list-title">{session.scenarioTitle}</div>
                    <div className="list-meta">{challenge.userTurns}/{challenge.targetTurns}턴 · 표현 {challenge.expressionHits}회</div>
                  </div>
                  <span className="list-tail">{challenge.review ? `${challenge.review.medal} ${challenge.review.score100}` : '대기'}</span>
                </button>
              ))}
            </div>
          ) : <EmptyState icon={<Icon name="bolt" />} title="챌린지 기록이 없어요" description="챌린지 모드로 목표 턴을 채우면 점수가 쌓여요." />}
        </section>
      </div>

      <section className="card animate-in">
        <div className="card-head"><div><div className="card-title">워크스페이스 상태</div><div className="card-sub">기기 지원과 데이터 상태.</div></div></div>
        <div className="health-grid">
          <div className="note"><span className="block-label">음성 입력</span>{isSpeechRecognitionSupported() ? '이 브라우저에서 지원돼요.' : '이 브라우저에서 지원되지 않아요.'}</div>
          <div className="note green"><span className="block-label">음성 출력</span>{`Gemini TTS ${TTS_VOICE_OPTIONS.length}종 + 브라우저 백업 ${browserVoiceCount}종.`}</div>
          <div className="note amber"><span className="block-label">내보내기 안전성</span>API 키는 내보내기 파일에 포함되지 않아요.</div>
        </div>
      </section>
    </>
  );
}
