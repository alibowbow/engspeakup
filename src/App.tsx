import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { focusSkillOptions, modelPresets, scenarios, spotlightScenarioIds } from './data/scenarios';
import {
  buildAnalysisPrompt,
  buildConversationSystemPrompt,
  buildOfflineSummary,
  buildRecapPrompt,
  buildSuggestionPrompt,
  lastUserMessage,
  normalizeAnalysisEntry,
  normalizeSuggestionBundle,
  normalizeSummary,
  resolveScenarioDetails,
} from './lib/coaching';
import { generateJson, generateText } from './lib/gemini';
import { isSpeechRecognitionSupported, listenOnce, loadVoices, speakText, stopSpeaking } from './lib/speech';
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
  PracticeView,
  RoleplayMode,
  Scenario,
  Session,
  SessionSummary,
  Settings,
  SuggestionBundle,
  VocabularyCard,
} from './types';

type Busy = 'chat' | 'suggestions' | 'analysis' | 'recap' | null;
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
  | 'wave';

const NAVS: Array<{ id: PracticeView; label: string; hint: string; icon: IconName }> = [
  { id: 'practice', label: 'Practice', hint: 'Live conversation', icon: 'chat' },
  { id: 'library', label: 'Library', hint: 'Scenario packs', icon: 'library' },
  { id: 'review', label: 'Review', hint: 'Favorites and notes', icon: 'bookmark' },
  { id: 'analytics', label: 'Analytics', hint: 'Progress overview', icon: 'chart' },
];

const PAGE_META: Record<PracticeView, { title: string; description: string }> = {
  practice: {
    title: 'Conversation Practice',
    description: 'A calm space for focused speaking reps and live AI roleplay.',
  },
  library: {
    title: 'Scenario Library',
    description: 'Browse situations, compare difficulty, and open the next practice run.',
  },
  review: {
    title: 'Review Hub',
    description: 'Revisit saved lines, session notes, and feedback worth keeping.',
  },
  analytics: {
    title: 'Progress Analytics',
    description: 'Track recent sessions, study time, and how your practice is compounding.',
  },
};

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
          <span className="message-sender">{message.role === 'assistant' ? 'AI Coach' : 'You'}</span>
          <span className="message-time">{formatDate(message.createdAt)}</span>
          <div className="message-actions">
            <button type="button" className="btn btn-icon btn-icon-sm" onClick={onFavorite} aria-label="Save message">
              <Icon name={message.favorite ? 'bookmarkFilled' : 'bookmark'} />
            </button>
            <button type="button" className="btn btn-icon btn-icon-sm" onClick={onCopy} aria-label="Copy message">
              <Icon name="copy" />
            </button>
            {onSpeak ? (
              <button type="button" className="btn btn-icon btn-icon-sm" onClick={onSpeak} aria-label="Play message">
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
            <strong>{category}</strong>
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
                  <span>{scenario.difficulty}</span>
                  <span>{scenario.tags[0]}</span>
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
  if (lower.includes('fail') || lower.includes('error') || lower.includes('required')) return 'error';
  if (lower.includes('ready') || lower.includes('saved') || lower.includes('copied') || lower.includes('imported')) return 'success';
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
  const [notes, setNotes] = useState('');
  const [customBrief, setCustomBrief] = useState('');
  const [composer, setComposer] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState('Enter your Gemini API key to start live speaking practice.');
  const [bundle, setBundle] = useState<SuggestionBundle | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [listening, setListening] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showTools, setShowTools] = useState(false);
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
  const latestAnalysis = [...analyses].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
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
  const suggestionChips = (bundle?.suggestions.length ? bundle.suggestions : currentScenario.warmups).slice(0, 5);
  const recentSessions = sortSessions(sessions).slice(0, 8);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveSessions(sessions), [sessions]);
  useEffect(() => saveAnalyses(analyses), [analyses]);
  useEffect(() => saveVocabulary(vocabulary), [vocabulary]);
  useEffect(() => saveActiveSessionId(activeSessionId), [activeSessionId]);
  useEffect(() => {
    const applyVoices = () => setVoices(loadVoices());
    applyVoices();
    window.speechSynthesis?.addEventListener?.('voiceschanged', applyVoices);
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', applyVoices);
  }, []);
  useEffect(() => {
    if (!activeSession) return;
    setSelectedScenarioId(activeSession.scenarioId);
    setFocusSkill(activeSession.focusSkill);
    setRoleplayMode(activeSession.roleplayMode);
    setNotes(activeSession.notes);
    setCustomBrief(activeSession.customScenario);
  }, [activeSession]);
  useEffect(() => {
    const node = chatScrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [activeSession?.messages.length, busy]);
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
    setNotes('');
    setCustomBrief('');
    setBundle(null);
    setShowCatalog(false);
    setShowTools(false);
    setNotice('Scenario switched. Start a fresh session for this context.');
  };

  const makeSession = (scenario: Scenario): Session => {
    const now = new Date().toISOString();
    return {
      id: id('session'),
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      startedAt: now,
      updatedAt: now,
      messages: [],
      focusSkill,
      customScenario: customBrief,
      roleplayMode,
      notes,
      completedMissionSteps: [],
      summary: null,
    };
  };

  const ensureSession = () => {
    if (selectedScenario.isCustom && !customBrief.trim()) {
      setShowTools(true);
      setNotice('Add a custom brief before starting a custom scenario.');
      return null;
    }
    if (activeSession && activeSession.scenarioId === selectedScenarioId) return activeSession;
    const session = makeSession(selectedScenario);
    upsert(session);
    setBundle({
      suggestions: selectedScenario.warmups.slice(0, 3),
      coachTip: `Aim for this target: ${selectedScenario.goals[0]}.`,
      focusPoint: selectedScenario.challenge,
    });
    setNotice('A fresh speaking session is ready.');
    return session;
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = composer.trim();
    if (!text) return;
    if (!settings.apiKey.trim()) {
      setShowSettings(true);
      setNotice('Add your Gemini API key in Settings before sending.');
      return;
    }
    const session = ensureSession();
    if (!session) return;
    const pending = upsert({
      ...session,
      focusSkill,
      roleplayMode,
      notes,
      customScenario: customBrief,
      updatedAt: new Date().toISOString(),
      messages: [...session.messages, { id: id('msg'), role: 'user', text, createdAt: new Date().toISOString() }],
    });
    setComposer('');
    setBusy('chat');
    try {
      const reply = await generateText({
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim(),
        systemInstruction: buildConversationSystemPrompt(selectedScenario, pending, settings),
        history: pending.messages.slice(0, -1),
        userPrompt: text,
      });
      upsert({
        ...pending,
        updatedAt: new Date().toISOString(),
        messages: [...pending.messages, { id: id('msg'), role: 'assistant', text: reply, createdAt: new Date().toISOString() }],
      });
      if (settings.autoSpeakAi) speakText(reply, settings.voiceName, settings.speechRate);
      setNotice('AI reply is ready.');
    } catch (error) {
      setNotice(error instanceof Error ? `Reply generation failed: ${error.message}` : 'Reply generation failed.');
    } finally {
      setBusy(null);
    }
  };

  const suggest = async () => {
    const session = ensureSession();
    if (!session) return;
    if (!settings.apiKey.trim()) {
      setBundle({
        suggestions: selectedScenario.warmups.slice(0, 3),
        coachTip: 'API key missing, so the app is showing built-in warm-up ideas.',
        focusPoint: selectedScenario.challenge,
      });
      setShowTools(true);
      setNotice('Showing warm-up suggestions without AI.');
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
      setShowTools(true);
      setNotice('Suggested three next replies.');
    } catch (error) {
      setNotice(error instanceof Error ? `Suggestions failed: ${error.message}` : 'Suggestions failed.');
    } finally {
      setBusy(null);
    }
  };

  const analyze = async () => {
    if (!activeSession) {
      setNotice('Send a line first so there is something to analyze.');
      return;
    }
    const target = lastUserMessage(activeSession.messages);
    if (!target) {
      setNotice('There is no recent user message to analyze yet.');
      return;
    }
    if (!settings.apiKey.trim()) {
      setShowSettings(true);
      setNotice('Sentence analysis requires an API key.');
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
      setShowTools(true);
      setNotice('Analyzed your latest line.');
    } catch (error) {
      setNotice(error instanceof Error ? `Analysis failed: ${error.message}` : 'Analysis failed.');
    } finally {
      setBusy(null);
    }
  };

  const recap = async () => {
    if (!activeSession) {
      setNotice('There is no active session to recap.');
      return;
    }
    const fallback = buildOfflineSummary(selectedScenario, activeSession);
    if (!settings.apiKey.trim()) {
      upsert({ ...activeSession, summary: fallback });
      setVocabulary((current) => mergeVocabulary(current, fallback.notableVocabulary));
      setShowTools(true);
      setNotice('Built a local recap without the API.');
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
      setShowTools(true);
      setNotice('Session recap is ready.');
    } catch (error) {
      upsert({ ...activeSession, summary: fallback });
      setShowTools(true);
      setNotice(error instanceof Error ? `Recap failed: ${error.message}` : 'Recap failed.');
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
      setNotice('Speech input is not supported in this browser.');
      return;
    }
    if (listening) {
      stopRef.current?.();
      stopRef.current = null;
      setListening(false);
      setNotice('Voice capture stopped.');
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
      setNotice('Listening for English speech.');
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
      setNotice('Imported study data.');
    } catch (error) {
      setNotice(error instanceof Error ? `Import failed: ${error.message}` : 'Import failed.');
    } finally {
      event.target.value = '';
    }
  };

  const resetWorkspace = () => {
    if (!window.confirm('Reset all local sessions, analyses, and saved vocabulary?')) return;
    clearWorkspace();
    setSessions([]);
    setAnalyses([]);
    setVocabulary([]);
    setActiveSessionId('');
    setSelectedScenarioId(spotlightScenarioIds[0]);
    setSettings(defaultSettings);
    setFocusSkill('Fluency');
    setRoleplayMode('normal');
    setNotes('');
    setCustomBrief('');
    setComposer('');
    setBundle(null);
    setShowCatalog(false);
    setShowTools(false);
    setShowSettings(false);
    setNotice('Local workspace cleared.');
  };

  const openReviewSession = (session: Session) => {
    setActiveSessionId(session.id);
    setSelectedScenarioId(session.scenarioId);
    setView('practice');
    setShowCatalog(false);
    setShowTools(false);
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
            <p className="sidebar-logo-copy">Quiet, premium speaking practice.</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">Workspace</div>
          {NAVS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              onClick={() => setView(item.id)}
            >
              <Icon name={item.icon} />
              <div>
                <div>{item.label}</div>
                <small>{item.hint}</small>
              </div>
            </button>
          ))}

          <div className="nav-section-label">Spotlight</div>
          <button
            type="button"
            className="sidebar-spotlight"
            onClick={() => {
              handleScenarioSelect(spotlightScenario.id);
              setView('practice');
              setShowCatalog(true);
            }}
          >
            <span className="badge badge-accent">Today</span>
            <strong>{spotlightScenario.title}</strong>
            <p>{spotlightScenario.challenge}</p>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="nav-item" onClick={() => setShowSettings(true)}>
            <Icon name="settings" />
            <div>
              <div>Settings</div>
              <small>API, voice, and workspace</small>
            </div>
          </button>
          <div className="api-status">
            <span className={`api-status-dot ${settings.apiKey.trim() ? 'connected' : ''}`} />
            <span>{settings.apiKey.trim() ? 'Gemini key connected' : 'Gemini key required'}</span>
          </div>
        </div>
      </aside>

      <div className="main-area">
        <header className="page-header">
          <div>
            <div className="page-title">{pageMeta.title}</div>
            <p className="page-subtitle">{pageMeta.description}</p>
          </div>
          <div className="page-header-actions">
            {view === 'practice' && !activeSession && (
              <button type="button" className="btn btn-secondary" onClick={() => ensureSession()}>
                Start Session
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" />
              Import
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                exportFile(`speakup-${new Date().toISOString().slice(0, 10)}.json`, createExportBundle(settings, sessions, analyses, vocabulary))
              }
            >
              <Icon name="download" />
              Export
            </button>
            <button type="button" className="btn btn-icon" onClick={() => setShowSettings(true)} aria-label="Open settings">
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
                    aria-label="Toggle scenario catalog"
                  >
                    <Icon name="list" />
                  </button>
                  <span className="scenario-badge">
                    <Icon name="bolt" />
                    {currentScenario.category}
                  </span>
                  <div className="scenario-summary">
                    <div className="scenario-title">{currentScenario.title}</div>
                    <div className="scenario-caption">{currentScenario.subtitle}</div>
                  </div>
                  <div className="scenario-meta">
                    <span>{currentScenario.difficulty}</span>
                    <span>{roleplayMode === 'normal' ? 'Default roleplay' : 'Reverse roleplay'}</span>
                    <span>{activeSession ? `${activeSession.messages.length} turns` : 'Ready'}</span>
                  </div>
                  <div className="scenario-bar-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowTools((current) => !current)}>
                      {showTools ? 'Hide Guide' : 'Guide'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={suggest} disabled={busy === 'suggestions'}>
                      {busy === 'suggestions' ? 'Thinking...' : 'Suggest'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={analyze} disabled={busy === 'analysis'}>
                      {busy === 'analysis' ? 'Analyzing...' : 'Analyze'}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={recap} disabled={busy === 'recap'}>
                      {busy === 'recap' ? 'Recapping...' : 'Recap'}
                    </button>
                  </div>
                </div>

                {showCatalog && (
                  <section className="card catalog-popover animate-in">
                    <div className="card-header">
                      <div>
                        <div className="card-title">Scenario Catalog</div>
                        <div className="card-subtitle">{filteredScenarios.length} scenarios available</div>
                      </div>
                    </div>
                    <label className="form-group">
                      <span className="form-label">Search</span>
                      <input
                        className="form-input"
                        placeholder="Search title, category, or tag"
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
                      title="Start a focused speaking session"
                      description={currentScenario.challenge}
                      action={
                        <button type="button" className="btn btn-primary" onClick={() => ensureSession()}>
                          Start Session
                        </button>
                      }
                    />
                  )}

                  {activeSession?.messages.length ? <div className="chat-divider">Current session</div> : null}

                  {activeSession?.messages.map((message) => (
                    <MessageCard
                      key={message.id}
                      message={message}
                      onFavorite={() => toggleFavorite(activeSession.id, message.id)}
                      onCopy={() => navigator.clipboard.writeText(message.text).then(() => setNotice('Message copied.'))}
                      onSpeak={
                        message.role === 'assistant'
                          ? () => speakText(message.text, settings.voiceName, settings.speechRate)
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
                          <span className="message-sender">AI Coach</span>
                        </div>
                        <div className="message-bubble">
                          <span className="typing-dot" />
                          <span className="typing-dot" />
                          <span className="typing-dot" />
                        </div>
                      </div>
                    </article>
                  )}
                </div>

                <div className="input-area">
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

                  <form onSubmit={send}>
                    <div className="input-container">
                      <textarea
                        rows={1}
                        value={composer}
                        onChange={(event) => setComposer(event.target.value)}
                        placeholder="Type the next line in English"
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
                          aria-label="Use voice input"
                        >
                          <Icon name="mic" />
                        </button>
                        {composer.trim() && (
                          <button type="button" className="btn btn-icon" onClick={() => setComposer('')} aria-label="Clear message">
                            <Icon name="close" />
                          </button>
                        )}
                        <button type="submit" className="send-btn" disabled={busy === 'chat' || !composer.trim()} aria-label="Send message">
                          <Icon name="send" />
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </section>

              {showTools && (
                <aside className="insights-rail">
                  <section className="card animate-in">
                    <div className="card-header">
                      <div>
                        <div className="card-title">Scenario Guide</div>
                        <div className="card-subtitle">
                          {currentScenario.userRole} speaking to {currentScenario.aiRole}
                        </div>
                      </div>
                      <span className="badge badge-neutral">{focusSkill}</span>
                    </div>

                    <div className="form-grid">
                      <label className="form-group">
                        <span className="form-label">Focus skill</span>
                        <select
                          className="form-select"
                          value={focusSkill}
                          onChange={(event) => {
                            setFocusSkill(event.target.value);
                            patchActive({ focusSkill: event.target.value });
                          }}
                        >
                          {focusSkillOptions.map((option) => (
                            <option key={option}>{option}</option>
                          ))}
                        </select>
                      </label>

                      <label className="form-group">
                        <span className="form-label">Roleplay mode</span>
                        <select
                          className="form-select"
                          value={roleplayMode}
                          onChange={(event) => {
                            const next = event.target.value as RoleplayMode;
                            setRoleplayMode(next);
                            patchActive({ roleplayMode: next });
                          }}
                        >
                          <option value="normal">Default</option>
                          <option value="reverse">Reverse</option>
                        </select>
                      </label>
                    </div>

                    {selectedScenario.isCustom && (
                      <label className="form-group">
                        <span className="form-label">Custom brief</span>
                        <textarea
                          className="form-input form-input--textarea"
                          value={customBrief}
                          onChange={(event) => {
                            setCustomBrief(event.target.value);
                            patchActive({ customScenario: event.target.value });
                          }}
                          placeholder="Describe the setting, partner, and goal."
                        />
                      </label>
                    )}

                    <label className="form-group">
                      <span className="form-label">Coach notes</span>
                      <textarea
                        className="form-input form-input--textarea"
                        value={notes}
                        onChange={(event) => {
                          setNotes(event.target.value);
                          patchActive({ notes: event.target.value });
                        }}
                        placeholder="What do you want to push harder on in this session?"
                      />
                    </label>

                    <div className="detail-columns">
                      <div>
                        <div className="mini-label">Mission steps</div>
                        <ul className="bullet-list">
                          {currentScenario.missionSteps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="mini-label">Key expressions</div>
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
                      <div className="mini-label">Vocabulary set</div>
                      <div className="vocab-chip-grid">
                        {currentScenario.vocabulary.map((card) => (
                          <button
                            key={card.phrase}
                            type="button"
                            className="vocab-chip"
                            onClick={() => navigator.clipboard.writeText(card.example).then(() => setNotice('Example copied.'))}
                          >
                            <strong>{card.phrase}</strong>
                            <span>{card.meaningKo}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>

                  <section className="card animate-in">
                    <div className="card-header">
                      <div>
                        <div className="card-title">Reply Deck</div>
                        <div className="card-subtitle">Fast next-line options for the current flow.</div>
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
                          <div className="feedback-label">Coach tip</div>
                          <p>{bundle.coachTip}</p>
                        </div>
                        <div className="feedback-card">
                          <div className="feedback-label">Focus point</div>
                          <p>{bundle.focusPoint}</p>
                        </div>
                      </>
                    ) : (
                      <EmptyState
                        icon={<Icon name="sparkles" />}
                        title="No reply deck yet"
                        description="Run Suggest to generate next-line ideas tuned to the current exchange."
                      />
                    )}
                  </section>

                  <section className="card animate-in">
                    <div className="card-header">
                      <div>
                        <div className="card-title">Latest Analysis</div>
                        <div className="card-subtitle">What to keep, fix, and reuse.</div>
                      </div>
                    </div>
                    {latestAnalysis ? (
                      <>
                        <p className="insight-copy">{latestAnalysis.overview}</p>
                        <div className="feedback-card">
                          <div className="feedback-label">Revision</div>
                          <p>{latestAnalysis.revision}</p>
                        </div>
                        <div className="analysis-grid">
                          <div className="feedback-card">
                            <div className="feedback-label">Strengths</div>
                            <ul className="bullet-list compact">
                              {latestAnalysis.strengths.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="feedback-card">
                            <div className="feedback-label">Grammar</div>
                            <ul className="bullet-list compact">
                              {latestAnalysis.grammar.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="feedback-card">
                            <div className="feedback-label">Naturalness</div>
                            <ul className="bullet-list compact">
                              {latestAnalysis.naturalness.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </>
                    ) : (
                      <EmptyState
                        icon={<Icon name="check" />}
                        title="No analysis yet"
                        description="Analyze the latest user line to populate feedback, corrections, and new vocabulary."
                      />
                    )}
                  </section>

                  {activeSession?.summary && (
                    <section className="card animate-in">
                      <div className="card-header">
                        <div>
                          <div className="card-title">Session Recap</div>
                          <div className="card-subtitle">Wins, next focus, and homework from this run.</div>
                        </div>
                      </div>
                      <p className="insight-copy">{activeSession.summary.summary}</p>
                      <div className="detail-columns">
                        <div>
                          <div className="mini-label">Wins</div>
                          <ul className="bullet-list compact">
                            {activeSession.summary.wins.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="mini-label">Next focus</div>
                          <ul className="bullet-list compact">
                            {activeSession.summary.nextFocus.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                      <div>
                        <div className="mini-label">Homework</div>
                        <ul className="bullet-list compact">
                          {activeSession.summary.homework.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </section>
                  )}
                </aside>
              )}
            </div>
          )}

          {view === 'library' && (
            <div className="library-layout">
              <section className="card animate-in">
                <div className="card-header">
                  <div>
                    <div className="card-title">Scenario Library</div>
                    <div className="card-subtitle">Browse all speaking packs and choose the next run.</div>
                  </div>
                  <span className="badge badge-neutral">{filteredScenarios.length} total</span>
                </div>
                <label className="form-group">
                  <span className="form-label">Search</span>
                  <input
                    className="form-input"
                    placeholder="Search title, category, or tag"
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
                        <span className="badge badge-neutral">{scenario.category}</span>
                      </div>
                      <p className="card-copy">{scenario.description}</p>
                      <div className="card-footer">
                        <div className="difficulty-dots" aria-label={scenario.difficulty}>
                          {Array.from({ length: 4 }).map((_, index) => (
                            <span
                              key={`${scenario.id}-${index}`}
                              className={`difficulty-dot ${index < difficultyValue(scenario.difficulty) ? 'filled' : ''}`}
                            />
                          ))}
                        </div>
                        <span className="badge badge-accent">{scenario.difficulty}</span>
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
                  <span className="badge badge-accent">{selectedScenario.difficulty}</span>
                </div>
                <p className="insight-copy">{selectedScenario.description}</p>

                <div className="detail-columns">
                  <div>
                    <div className="mini-label">Goals</div>
                    <ul className="bullet-list compact">
                      {selectedScenario.goals.map((goal) => (
                        <li key={goal}>{goal}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mini-label">Mission steps</div>
                    <ul className="bullet-list compact">
                      {selectedScenario.missionSteps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="detail-columns">
                  <div>
                    <div className="mini-label">Warm-ups</div>
                    <div className="chip-row">
                      {selectedScenario.warmups.map((item) => (
                        <button key={item} type="button" className="suggestion-chip" onClick={() => setComposer(item)}>
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mini-label">Key expressions</div>
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
                  <div className="mini-label">Vocabulary preview</div>
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
                    Open In Practice
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowSettings(true)}>
                    Review API Settings
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
                    <div className="card-title">Session History</div>
                    <div className="card-subtitle">Jump back into any previous practice run.</div>
                  </div>
                </div>
                {recentSessions.length ? (
                  <div className="session-list">
                    {recentSessions.map((session) => (
                      <button key={session.id} type="button" className="session-item" onClick={() => openReviewSession(session)}>
                        <div className="session-icon">
                          <Icon name="chat" />
                        </div>
                        <div className="session-info">
                          <div className="session-title">{session.scenarioTitle}</div>
                          <div className="session-meta">
                            {session.messages.filter((message) => message.role === 'user').length} user turns · {formatDate(session.updatedAt)}
                          </div>
                        </div>
                        <div className="session-score">{session.focusSkill}</div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={<Icon name="chat" />} title="No sessions yet" description="Start a practice run and your recent sessions will appear here." />
                )}
              </section>

              <section className="card animate-in">
                <div className="card-header">
                  <div>
                    <div className="card-title">Saved Messages</div>
                    <div className="card-subtitle">Useful lines you marked for review.</div>
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
                  <EmptyState icon={<Icon name="bookmark" />} title="Nothing saved yet" description="Use the star action in chat bubbles to keep strong lines for later review." />
                )}
              </section>

              <section className="card animate-in">
                <div className="card-header">
                  <div>
                    <div className="card-title">Feedback Archive</div>
                    <div className="card-subtitle">Recent AI corrections and naturalness notes.</div>
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
                  <EmptyState icon={<Icon name="check" />} title="No feedback yet" description="Run Analyze inside a session to build a correction archive." />
                )}
              </section>

              <section className="card animate-in">
                <div className="card-header">
                  <div>
                    <div className="card-title">Vocabulary Bank</div>
                    <div className="card-subtitle">Terms collected from analyses and recaps.</div>
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
                  <EmptyState icon={<Icon name="wave" />} title="Vocabulary bank is empty" description="New cards appear here after AI analysis or session recap." />
                )}
              </section>
            </div>
          )}

          {view === 'analytics' && (
            <div className="analytics-layout">
              <section className="stats-grid">
                <StatCard value={String(sessions.length)} label="Total sessions" />
                <StatCard value={String(totalTurns)} label="Total turns" />
                <StatCard value={`${streak(sortSessions(sessions))}`} label="Current streak" suffix="days" />
                <StatCard value={`${weeklyMinutes}`} label="Weekly speaking time" suffix="min" />
              </section>
              <section className="card animate-in">
                <div className="card-header">
                  <div>
                    <div className="card-title">Weekly Goal</div>
                    <div className="card-subtitle">Estimated from your spoken word count in recent sessions.</div>
                  </div>
                  <span className="badge badge-accent">{goalProgress}%</span>
                </div>
                <div className="progress-bar-wrap">
                  <div className="progress-bar-fill" style={{ width: `${goalProgress}%` }} />
                </div>
                <p className="insight-copy">
                  {weeklyMinutes} minutes tracked against a {settings.dailyMinutesGoal}-minute target.
                </p>
              </section>

              <section className="card animate-in">
                <div className="card-header">
                  <div>
                    <div className="card-title">Recent Sessions</div>
                    <div className="card-subtitle">The latest practice runs that shaped this week.</div>
                  </div>
                </div>
                {recentSessions.length ? (
                  <div className="session-list">
                    {recentSessions.map((session) => (
                      <button key={session.id} type="button" className="session-item" onClick={() => openReviewSession(session)}>
                        <div className="session-icon">
                          <Icon name="chart" />
                        </div>
                        <div className="session-info">
                          <div className="session-title">{session.scenarioTitle}</div>
                          <div className="session-meta">
                            {session.messages.length} turns · {formatDate(session.updatedAt)}
                          </div>
                        </div>
                        <div className="session-score">{session.roleplayMode === 'normal' ? 'Default' : 'Reverse'}</div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={<Icon name="chart" />} title="No analytics yet" description="Complete a few sessions and the dashboard will start to fill in." />
                )}
              </section>

              <section className="card animate-in">
                <div className="card-header">
                  <div>
                    <div className="card-title">Workspace Health</div>
                    <div className="card-subtitle">Quick checks for device support and data state.</div>
                  </div>
                </div>
                <div className="health-grid">
                  <div className="feedback-card">
                    <div className="feedback-label">Voice input</div>
                    <p>{isSpeechRecognitionSupported() ? 'Supported in this browser.' : 'Not supported in this browser.'}</p>
                  </div>
                  <div className="feedback-card">
                    <div className="feedback-label">Voice output</div>
                    <p>{voices.length ? `${voices.length} voices ready.` : 'No voices detected yet.'}</p>
                  </div>
                  <div className="feedback-card">
                    <div className="feedback-label">Export safety</div>
                    <p>API keys are excluded from exported study bundles.</p>
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
        <div className="drawer-title">Settings</div>
        <button type="button" className="btn btn-icon" onClick={() => setShowSettings(false)} aria-label="Close settings">
          <Icon name="close" />
        </button>
      </div>
      <div className="drawer-body">
        <section className="settings-section">
          <div className="settings-section-title">Gemini</div>
          <label className="form-group">
            <span className="form-label">API key</span>
            <input
              className="form-input"
              type="password"
              value={settings.apiKey}
              onChange={(event) => setSettings((current) => ({ ...current, apiKey: event.target.value }))}
              placeholder="Paste your Gemini API key"
            />
            <span className="form-hint">The key is used directly from the browser. It is excluded from export files.</span>
          </label>

          <label className="form-group">
            <span className="form-label">Model</span>
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
          </label>

          <label className="form-group">
            <span className="form-label">Coach mode</span>
            <select
              className="form-select"
              value={settings.coachMode}
              onChange={(event) =>
                setSettings((current) => ({ ...current, coachMode: event.target.value as Settings['coachMode'] }))
              }
            >
              <option value="gentle">Gentle</option>
              <option value="balanced">Balanced</option>
              <option value="push">Direct</option>
            </select>
          </label>

          <ToggleField
            label="Save API key locally"
            description="If off, the key is cleared from local storage after refresh."
            checked={settings.saveApiKey}
            onChange={(checked) => setSettings((current) => ({ ...current, saveApiKey: checked }))}
          />
        </section>

        <section className="settings-section">
          <div className="settings-section-title">Voice</div>
          <label className="form-group">
            <span className="form-label">Voice</span>
            <select
              className="form-select"
              value={settings.voiceName}
              onChange={(event) => setSettings((current) => ({ ...current, voiceName: event.target.value }))}
            >
              <option value="">System default</option>
              {voices.map((voice) => (
                <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </label>

          <label className="form-group">
            <span className="form-label">Speech rate</span>
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
            label="Auto-play AI replies"
            description="Read assistant lines aloud as soon as they arrive."
            checked={settings.autoSpeakAi}
            onChange={(checked) => setSettings((current) => ({ ...current, autoSpeakAi: checked }))}
          />
        </section>

        <section className="settings-section">
          <div className="settings-section-title">Practice</div>
          <label className="form-group">
            <span className="form-label">Display name</span>
            <input
              className="form-input"
              value={settings.userName}
              onChange={(event) => setSettings((current) => ({ ...current, userName: event.target.value }))}
              placeholder="Optional"
            />
          </label>

          <label className="form-group">
            <span className="form-label">Daily goal (minutes)</span>
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
          <div className="settings-section-title">Workspace</div>
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" />
            Import Study Data
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
            Export Study Data
          </button>
          <button type="button" className="btn btn-danger" onClick={resetWorkspace}>
            Reset Local Workspace
          </button>
          <p className="form-hint">
            API keys are excluded from exported bundles. Session, analysis, and vocabulary data remain local unless you export them.
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
