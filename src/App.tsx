import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { coachModeLabels, focusSkillOptions, modelPresets, scenarios, spotlightScenarioIds } from './data/scenarios';
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

const NAVS: Array<{ id: PracticeView; label: string }> = [
  { id: 'practice', label: 'Practice' },
  { id: 'library', label: 'Library' },
  { id: 'review', label: 'Review' },
  { id: 'analytics', label: 'Analytics' },
];

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

export default function App() {
  const [view, setView] = useState<PracticeView>('practice');
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [sessions, setSessions] = useState<Session[]>(() => sortSessions(loadSessions()));
  const [analyses, setAnalyses] = useState<AnalysisEntry[]>(() => loadAnalyses());
  const [vocabulary, setVocabulary] = useState<VocabularyCard[]>(() => loadVocabulary());
  const [activeSessionId, setActiveSessionId] = useState(() => loadActiveSessionId());
  const [selectedScenarioId, setSelectedScenarioId] = useState(() => loadSessions().find((item) => item.id === loadActiveSessionId())?.scenarioId ?? spotlightScenarioIds[0]);
  const [focusSkill, setFocusSkill] = useState('Fluency');
  const [roleplayMode, setRoleplayMode] = useState<RoleplayMode>('normal');
  const [notes, setNotes] = useState('');
  const [customBrief, setCustomBrief] = useState('');
  const [composer, setComposer] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState('API 키를 직접 넣으면 별도 서버 없이 바로 실전 회화를 시작할 수 있습니다.');
  const [bundle, setBundle] = useState<SuggestionBundle | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [listening, setListening] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const activeSession = sessions.find((item) => item.id === activeSessionId) ?? null;
  const selectedScenario = scenarioById(selectedScenarioId);
  const currentScenario = activeSession?.scenarioId === selectedScenarioId ? resolveScenarioDetails(selectedScenario, activeSession) : selectedScenario;
  const filteredScenarios = scenarios.filter((item) => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return true;
    return [item.title, item.subtitle, item.description, item.category, item.tags.join(' ')].join(' ').toLowerCase().includes(q);
  });
  const groupedScenarios = filteredScenarios.reduce<Record<string, Scenario[]>>((acc, item) => {
    acc[item.category] = [...(acc[item.category] ?? []), item];
    return acc;
  }, {});
  const favoriteMessages = sortSessions(sessions).flatMap((session) => session.messages.filter((message) => message.favorite).map((message) => ({ session, message })));
  const latestAnalysis = [...analyses].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const weeklySessions = sessions.filter((session) => Date.now() - new Date(session.updatedAt).getTime() < 7 * 24 * 60 * 60 * 1000);
  const totalTurns = sessions.reduce((sum, session) => sum + session.messages.length, 0);
  const weeklyMinutes = Math.round(weeklySessions.reduce((sum, session) => sum + session.messages.filter((message) => message.role === 'user').reduce((inner, message) => inner + words(message.text), 0), 0) / 110);

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
  }, [activeSessionId]);
  useEffect(() => {
    const node = chatScrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [activeSession?.messages.length]);
  useEffect(() => () => {
    stopRef.current?.();
    stopSpeaking();
  }, []);

  const upsert = (session: Session) => {
    setSessions((current) => sortSessions([session, ...current.filter((item) => item.id !== session.id)]));
    setActiveSessionId(session.id);
    return session;
  };

  const patchActive = (patch: Partial<Session>) => {
    if (!activeSession || activeSession.scenarioId !== selectedScenarioId) return;
    upsert({ ...activeSession, ...patch });
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
    setNotice('새 상황으로 전환했습니다. 이전 대화는 히스토리에 남고, 현재 대화창은 새 세션으로 리셋됩니다.');
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
      setNotice('커스텀 시나리오는 먼저 상황 브리프를 입력해야 합니다.');
      return null;
    }
    if (activeSession && activeSession.scenarioId === selectedScenarioId) return activeSession;
    const session = makeSession(selectedScenario);
    upsert(session);
    setShowTools(false);
    setBundle({
      suggestions: selectedScenario.warmups.slice(0, 3),
      coachTip: `${selectedScenario.goals[0]}부터 한 문장씩 밀고 가세요.`,
      focusPoint: selectedScenario.challenge,
    });
    return session;
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = composer.trim();
    if (!text) return;
    if (!settings.apiKey.trim()) {
      setNotice('Gemini API 키를 입력해야 AI 대화가 동작합니다.');
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
      setNotice('AI 응답을 생성했습니다.');
    } catch (error) {
      setNotice(error instanceof Error ? `응답 실패: ${error.message}` : '응답 생성 실패');
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
        coachTip: 'API 키가 없어서 기본 워밍업 문장을 보여줍니다.',
        focusPoint: selectedScenario.challenge,
      });
      setShowTools(true);
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
      setNotice('현재 문맥 기준 다음 답변 3개를 준비했습니다.');
    } catch (error) {
      setNotice(error instanceof Error ? `추천 실패: ${error.message}` : '추천 실패');
    } finally {
      setBusy(null);
    }
  };

  const analyze = async () => {
    if (!activeSession) return setNotice('먼저 문장을 보내 주세요.');
    const target = lastUserMessage(activeSession.messages);
    if (!target) return setNotice('분석할 사용자 문장이 아직 없습니다.');
    if (!settings.apiKey.trim()) return setNotice('문장 분석에는 API 키가 필요합니다.');
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
      setNotice('마지막 문장 피드백을 저장했습니다.');
    } catch (error) {
      setNotice(error instanceof Error ? `분석 실패: ${error.message}` : '분석 실패');
    } finally {
      setBusy(null);
    }
  };

  const recap = async () => {
    if (!activeSession) return setNotice('요약할 세션이 없습니다.');
    const fallback = buildOfflineSummary(selectedScenario, activeSession);
    if (!settings.apiKey.trim()) {
      upsert({ ...activeSession, summary: fallback });
      setVocabulary((current) => mergeVocabulary(current, fallback.notableVocabulary));
      setShowTools(true);
      return setNotice('API 없이 로컬 요약을 생성했습니다.');
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
      setNotice('세션 리캡을 저장했습니다.');
    } catch (error) {
      upsert({ ...activeSession, summary: fallback });
      setNotice(error instanceof Error ? `리캡 실패: ${error.message}` : '리캡 실패');
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
    if (listening) {
      stopRef.current?.();
      stopRef.current = null;
      setListening(false);
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
      setNotice('말하면 영어 문장으로 받아씁니다.');
    }
  };

  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const bundle = await parseImportFile(file);
      startTransition(() => {
        setSettings((current) => ({ ...current, ...bundle.settings, apiKey: current.apiKey }));
        setSessions(sortSessions(bundle.sessions));
        setAnalyses(bundle.analyses);
        setVocabulary(bundle.vocabulary);
        setActiveSessionId(bundle.sessions[0]?.id ?? '');
        setView('review');
      });
      setNotice('학습 데이터를 가져왔습니다.');
    } catch (error) {
      setNotice(error instanceof Error ? `가져오기 실패: ${error.message}` : '가져오기 실패');
    } finally {
      event.target.value = '';
    }
  };

  const resetWorkspace = () => {
    if (!window.confirm('저장된 세션, 분석, 어휘를 모두 삭제할까요?')) return;
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
    setNotice('로컬 워크스페이스를 초기화했습니다.');
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <small>SpeakUp Studio</small>
          <h1>15에서 100으로 올린 영어 회화 앱</h1>
          <p>대화, 분석, 복습, 통계를 한 화면 흐름으로 묶었습니다.</p>
        </div>
        <div className="navs">
          {NAVS.map((item) => (
            <button key={item.id} className={`nav ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="sidebar-card">
          <span>오늘 추천</span>
          <strong>{scenarioById(spotlightScenarioIds[new Date().getDate() % spotlightScenarioIds.length]).title}</strong>
          <p>{scenarioById(spotlightScenarioIds[new Date().getDate() % spotlightScenarioIds.length]).challenge}</p>
        </div>
        <div className="metrics slim">
          <div><strong>{sessions.length}</strong><span>세션</span></div>
          <div><strong>{totalTurns}</strong><span>턴</span></div>
          <div><strong>{favoriteMessages.length}</strong><span>저장</span></div>
          <div><strong>{streak(sortSessions(sessions))}</strong><span>연속일</span></div>
        </div>
      </aside>

      <main className="main">
        <header className="top">
          <div>
            <small>Scenario</small>
            <h2>{currentScenario.title}</h2>
            <p>{currentScenario.subtitle}</p>
          </div>
          <div className="row">
            <button className="ghost" onClick={() => exportFile(`speakup-${new Date().toISOString().slice(0, 10)}.json`, createExportBundle(settings, sessions, analyses, vocabulary))}>내보내기</button>
            <button className="ghost" onClick={() => fileRef.current?.click()}>가져오기</button>
            <button className="primary" onClick={() => ensureSession()}>세션 준비</button>
            <input ref={fileRef} hidden type="file" accept="application/json" onChange={importData} />
          </div>
        </header>

        <div className="notice">{notice}</div>

        {view === 'practice' && (
          <div className="chat-first">
            <section className="panel messenger-shell">
              <div className="messenger-top">
                <div className="messenger-headline">
                  <div className="tags">
                    <span>{currentScenario.category}</span>
                    <span>{currentScenario.difficulty}</span>
                    <span>{roleplayMode === 'normal' ? 'Default roleplay' : 'Role reversal'}</span>
                  </div>
                  <h3>{currentScenario.title}</h3>
                  <p>{currentScenario.description}</p>
                </div>
                <div className="toolbar-strip">
                  <button className={`ghost ${showCatalog ? 'is-active' : ''}`} onClick={() => setShowCatalog((current) => !current)}>
                    {showCatalog ? 'Hide scenarios' : 'Scenarios'}
                  </button>
                  <button className={`ghost ${showTools ? 'is-active' : ''}`} onClick={() => setShowTools((current) => !current)}>
                    {showTools ? 'Hide tools' : 'Tools'}
                  </button>
                  <button className="ghost" onClick={suggest} disabled={busy === 'suggestions'}>
                    {busy === 'suggestions' ? 'Loading...' : 'Suggest'}
                  </button>
                  <button className="ghost" onClick={analyze} disabled={busy === 'analysis'}>
                    {busy === 'analysis' ? 'Analyzing...' : 'Analyze'}
                  </button>
                  <button className="ghost" onClick={recap} disabled={busy === 'recap'}>
                    {busy === 'recap' ? 'Recapping...' : 'Recap'}
                  </button>
                </div>
              </div>

              {showCatalog && (
                <div className="compact-panel">
                <div className="head">
                  <h3>Scenario Browser</h3>
                  <input className="field" placeholder="시나리오 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <p className="catalog-count">{filteredScenarios.length} scenarios</p>
                  <ScenarioCatalog groups={groupedScenarios} selectedId={selectedScenarioId} onSelect={handleScenarioSelect} />
                </div>
              )}

              {showTools && <section className="utility-panel hero">
                <div className="hero-top">
                  <div>
                    <div className="tags">
                      <span>{currentScenario.category}</span>
                      <span>{currentScenario.difficulty}</span>
                      <span>{roleplayMode === 'normal' ? '기본 역할' : '역할 반전'}</span>
                    </div>
                    <h3>{currentScenario.title}</h3>
                    <p>{currentScenario.description}</p>
                  </div>
                  <div className="hero-grid">
                    <label><span>집중 스킬</span><select className="field" value={focusSkill} onChange={(e) => { setFocusSkill(e.target.value); patchActive({ focusSkill: e.target.value }); }}>{focusSkillOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                    <label><span>역할 모드</span><select className="field" value={roleplayMode} onChange={(e) => { const next = e.target.value as RoleplayMode; setRoleplayMode(next); patchActive({ roleplayMode: next }); }}><option value="normal">기본 역할</option><option value="reverse">역할 반전</option></select></label>
                  </div>
                </div>
                {selectedScenario.isCustom && <label><span>커스텀 브리프</span><textarea className="field textarea" value={customBrief} onChange={(e) => { setCustomBrief(e.target.value); patchActive({ customScenario: e.target.value }); }} placeholder="상황, 상대 역할, 목표, 제약을 자세히 적어 주세요." /></label>}
                <label><span>코칭 메모</span><textarea className="field textarea" value={notes} onChange={(e) => { setNotes(e.target.value); patchActive({ notes: e.target.value }); }} placeholder="예: 답변 짧게, 논리 먼저, 면접 톤 유지" /></label>
                <div className="split">
                  <div><strong>미션</strong><ul>{currentScenario.missionSteps.map((step) => <li key={step}>{step}</li>)}</ul></div>
                  <div><strong>핵심 표현</strong><ul>{currentScenario.keyExpressions.map((item) => <li key={item}><button className="text" onClick={() => setComposer((current) => (current ? `${current} ${item}` : item))}>{item}</button></li>)}</ul></div>
                </div>
                <div className="vocab-row">{currentScenario.vocabulary.map((card) => <button key={card.phrase} className="vocab" onClick={() => navigator.clipboard.writeText(card.example).then(() => setNotice('예문을 복사했습니다.'))}><strong>{card.phrase}</strong><span>{card.meaningKo}</span></button>)}</div>
              </section>}

              <div className="messenger-thread">
                <div className="chat-session-head">
                  <div>
                    <strong>{activeSession ? activeSession.scenarioTitle : 'Start a fresh session'}</strong>
                    <p>{activeSession ? `${activeSession.messages.length} messages in this run` : currentScenario.subtitle}</p>
                  </div>
                  <div className="row">
                    <button className="ghost" onClick={suggest} disabled={busy === 'suggestions'}>{busy === 'suggestions' ? '생성 중' : '답변 추천'}</button>
                    <button className="ghost" onClick={analyze} disabled={busy === 'analysis'}>{busy === 'analysis' ? '분석 중' : '문장 분석'}</button>
                    <button className="ghost" onClick={recap} disabled={busy === 'recap'}>{busy === 'recap' ? '요약 중' : '세션 리캡'}</button>
                  </div>
                </div>
                <div ref={chatScrollRef} className="messenger-chat">
                  {activeSession?.messages.length ? activeSession.messages.map((message) => (
                    <article key={message.id} className={`bubble ${message.role}`}>
                      <div className="row between message-head">
                        <strong>{message.role === 'assistant' ? 'AI Coach' : 'You'}</strong>
                        <div className="row message-meta">
                          <span>{formatDate(message.createdAt)}</span>
                        </div>
                      </div>
                      <p>{message.text}</p>
                      <div className="row message-actions">
                        <button className="text" onClick={() => toggleFavorite(activeSession.id, message.id)}>{message.favorite ? '★ 저장됨' : '☆ 저장'}</button>
                        <button className="text" onClick={() => navigator.clipboard.writeText(message.text).then(() => setNotice('문장을 복사했습니다.'))}>복사</button>
                        {message.role === 'assistant' && <button className="text" onClick={() => speakText(message.text, settings.voiceName, settings.speechRate)}>듣기</button>}
                      </div>
                    </article>
                  )) : <div className="empty"><strong>첫 문장을 시작해 보세요.</strong><div className="chips">{currentScenario.warmups.map((item) => <button key={item} className="chip" onClick={() => setComposer(item)}>{item}</button>)}</div></div>}
                </div>
                <form className="composer compact-composer" onSubmit={send}>
                  <textarea className="field textarea" value={composer} onChange={(e) => setComposer(e.target.value)} placeholder="영어로 보낼 문장을 입력하세요." />
                  <div className="row">
                    <button type="button" className={`ghost ${listening ? 'hot' : ''}`} onClick={voiceInput}>{listening ? '음성 중지' : '음성 입력'}</button>
                    <button type="button" className="ghost" onClick={() => setComposer('')}>비우기</button>
                    <button type="submit" className="primary" disabled={busy === 'chat'}>{busy === 'chat' ? '응답 생성 중' : '보내기'}</button>
                  </div>
                </form>
              </div>
            </section>

            {showTools && <div className="utility-stack">
              <div className="panel">
                <h3>Settings</h3>
                <label><span>Gemini API Key</span><input className="field" type="password" value={settings.apiKey} onChange={(e) => setSettings((current) => ({ ...current, apiKey: e.target.value }))} placeholder="AI Studio API Key" /></label>
                <div className="grid2">
                  <label><span>모델</span><select className="field" value={settings.model} onChange={(e) => setSettings((current) => ({ ...current, model: e.target.value }))}>{modelPresets.map((model) => <option key={model}>{model}</option>)}</select></label>
                  <label><span>코칭 강도</span><select className="field" value={settings.coachMode} onChange={(e) => setSettings((current) => ({ ...current, coachMode: e.target.value as Settings['coachMode'] }))}>{Object.entries(coachModeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                </div>
                <div className="grid2">
                  <label><span>이름</span><input className="field" value={settings.userName} onChange={(e) => setSettings((current) => ({ ...current, userName: e.target.value }))} placeholder="선택 입력" /></label>
                  <label><span>주간 목표(분)</span><input className="field" type="number" value={settings.dailyMinutesGoal} onChange={(e) => setSettings((current) => ({ ...current, dailyMinutesGoal: Number(e.target.value) || 20 }))} /></label>
                </div>
                <div className="grid2">
                  <label><span>음성</span><select className="field" value={settings.voiceName} onChange={(e) => setSettings((current) => ({ ...current, voiceName: e.target.value }))}>{voices.map((voice) => <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name}</option>)}</select></label>
                  <label><span>속도</span><input className="field" type="number" step="0.1" min="0.7" max="1.3" value={settings.speechRate} onChange={(e) => setSettings((current) => ({ ...current, speechRate: Number(e.target.value) || 1 }))} /></label>
                </div>
                <label className="toggle"><input type="checkbox" checked={settings.saveApiKey} onChange={(e) => setSettings((current) => ({ ...current, saveApiKey: e.target.checked }))} /><span>API 키 로컬 저장</span></label>
                <label className="toggle"><input type="checkbox" checked={settings.autoSpeakAi} onChange={(e) => setSettings((current) => ({ ...current, autoSpeakAi: e.target.checked }))} /><span>AI 답변 자동 재생</span></label>
                <div className="row"><button className="ghost" onClick={resetWorkspace}>로컬 초기화</button><button className="ghost" onClick={() => setNotice('API 키는 로컬 저장 여부를 끄면 브라우저에 남지 않고 export에도 포함되지 않습니다.')}>보안 안내</button></div>
              </div>

              <div className="panel">
                <h3>Reply Deck</h3>
                {bundle ? <>
                  {bundle.suggestions.map((item) => <button key={item} className="suggest" onClick={() => setComposer(item)}>{item}</button>)}
                  <div className="subtle"><strong>Coach Tip</strong><p>{bundle.coachTip}</p><strong>Focus Point</strong><p>{bundle.focusPoint}</p></div>
                </> : <div className="subtle"><p>답변 추천을 누르면 현재 문맥 기반 문장 3개를 제안합니다.</p></div>}
              </div>

              <div className="panel">
                <h3>Latest Analysis</h3>
                {latestAnalysis ? <>
                  <p className="lead">{latestAnalysis.overview}</p>
                  <div className="quote"><strong>원문</strong><p>{latestAnalysis.sentence}</p></div>
                  <div className="quote"><strong>개선문</strong><p>{latestAnalysis.revision}</p></div>
                  <div className="subtle"><strong>한국어 요약</strong><p>{latestAnalysis.koreanSummary}</p></div>
                </> : <div className="subtle"><p>문장 분석을 실행하면 최근 피드백이 여기에 표시됩니다.</p></div>}
              </div>

              {activeSession?.summary && <div className="panel"><h3>Session Recap</h3><div className="subtle"><p>{activeSession.summary.summary}</p></div><ul>{activeSession.summary.wins.map((item) => <li key={item}>{item}</li>)}</ul></div>}
            </div>}
          </div>
        )}

        {view === 'library' && (
          <div className="library-dense">
            <div className="panel">
              <div className="head">
                <h3>Scenario Library</h3>
                <span className="catalog-count">{scenarios.length} total</span>
              </div>
              <ScenarioCatalog groups={groupedScenarios} selectedId={selectedScenarioId} onSelect={handleScenarioSelect} />
            </div>
            <div className="panel library-detail">
              <div className="row between">
                <div>
                  <h3>{selectedScenario.title}</h3>
                  <p>{selectedScenario.subtitle}</p>
                </div>
                <div className="tags">
                  <span>{selectedScenario.category}</span>
                  <span>{selectedScenario.difficulty}</span>
                </div>
              </div>
              <p>{selectedScenario.description}</p>
              <div className="split">
                <div>
                  <strong>Goals</strong>
                  <ul>{selectedScenario.goals.map((goal) => <li key={goal}>{goal}</li>)}</ul>
                </div>
                <div>
                  <strong>Mission Steps</strong>
                  <ul>{selectedScenario.missionSteps.map((step) => <li key={step}>{step}</li>)}</ul>
                </div>
              </div>
              <div className="split">
                <div>
                  <strong>Warm-ups</strong>
                  <ul>{selectedScenario.warmups.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
                <div>
                  <strong>Key Expressions</strong>
                  <ul>{selectedScenario.keyExpressions.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              </div>
              <div className="vocab-bank">
                {selectedScenario.vocabulary.map((card) => (
                  <div key={card.phrase} className="vocab-card">
                    <strong>{card.phrase}</strong>
                    <p>{card.meaningKo}</p>
                    <small>{card.example}</small>
                  </div>
                ))}
              </div>
              <button className="primary" onClick={() => setView('practice')}>Open In Practice</button>
            </div>
          </div>
        )}

        {view === 'review' && <div className="review">
          <div className="panel"><h3>세션 히스토리</h3>{sortSessions(sessions).length ? sortSessions(sessions).map((session) => <button key={session.id} className="review-row" onClick={() => { setActiveSessionId(session.id); setSelectedScenarioId(session.scenarioId); setView('practice'); }}><strong>{session.scenarioTitle}</strong><span>{session.messages.filter((m) => m.role === 'user').length}회 발화 · {formatDate(session.updatedAt)}</span></button>) : <div className="subtle"><p>저장된 세션이 없습니다.</p></div>}</div>
          <div className="panel"><h3>저장한 문장</h3>{favoriteMessages.length ? favoriteMessages.map(({ session, message }) => <div key={message.id} className="subtle"><strong>{session.scenarioTitle}</strong><p>{message.text}</p></div>) : <div className="subtle"><p>별표 저장 문장이 없습니다.</p></div>}</div>
          <div className="panel"><h3>문장 피드백</h3>{analyses.length ? analyses.map((analysis) => <div key={analysis.id} className="subtle"><strong>{analysis.scenarioTitle}</strong><p>{analysis.sentence}</p><small>{analysis.revision}</small></div>) : <div className="subtle"><p>분석 결과가 없습니다.</p></div>}</div>
          <div className="panel"><h3>어휘 뱅크</h3><div className="vocab-bank">{vocabulary.length ? vocabulary.map((card) => <div key={card.phrase} className="vocab-card"><strong>{card.phrase}</strong><p>{card.meaningKo}</p><small>{card.example}</small></div>) : <div className="subtle"><p>분석이나 리캡으로 표현 카드가 쌓입니다.</p></div>}</div></div>
        </div>}

        {view === 'analytics' && <div className="analytics">
          <div className="panel stat"><small>총 세션</small><strong>{sessions.length}</strong></div>
          <div className="panel stat"><small>총 턴</small><strong>{totalTurns}</strong></div>
          <div className="panel stat"><small>연속 학습</small><strong>{streak(sortSessions(sessions))}일</strong></div>
          <div className="panel stat"><small>이번 주 추정</small><strong>{weeklyMinutes}분</strong></div>
          <div className="panel"><h3>이번 주 목표</h3><div className="progress"><div style={{ width: `${Math.min(100, Math.round((weeklyMinutes / settings.dailyMinutesGoal) * 100))}%` }} /></div><p>{weeklyMinutes}분 / 목표 {settings.dailyMinutesGoal}분</p></div>
          <div className="panel"><h3>음성 지원</h3><p>{isSpeechRecognitionSupported() ? '브라우저 음성 입력 지원 가능' : '이 브라우저는 음성 입력 미지원'}</p></div>
        </div>}

        <footer className="footer">
          <span>컨텐츠 확장: {scenarios.length}개 고밀도 시나리오</span>
          <span>API 키는 export에 포함되지 않습니다.</span>
        </footer>
      </main>
    </div>
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
