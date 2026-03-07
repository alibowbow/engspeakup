export type Role = 'user' | 'assistant';

export type Difficulty = 'Starter' | 'Builder' | 'Momentum' | 'Mastery';

export type CoachMode = 'gentle' | 'balanced' | 'push';

export type PracticeView = 'practice' | 'library' | 'review' | 'analytics';

export type RoleplayMode = 'normal' | 'reverse';

export interface VocabularyCard {
  phrase: string;
  meaningKo: string;
  example: string;
}

export interface Scenario {
  id: string;
  title: string;
  category: string;
  subtitle: string;
  description: string;
  difficulty: Difficulty;
  userRole: string;
  aiRole: string;
  goals: string[];
  keyExpressions: string[];
  missionSteps: string[];
  warmups: string[];
  vocabulary: VocabularyCard[];
  challenge: string;
  tags: string[];
  systemTone: string;
  isCustom?: boolean;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  createdAt: string;
  favorite?: boolean;
}

export interface SessionSummary {
  summary: string;
  wins: string[];
  nextFocus: string[];
  homework: string[];
  notableVocabulary: VocabularyCard[];
}

export interface Session {
  id: string;
  scenarioId: string;
  scenarioTitle: string;
  startedAt: string;
  updatedAt: string;
  messages: Message[];
  focusSkill: string;
  customScenario: string;
  roleplayMode: RoleplayMode;
  notes: string;
  completedMissionSteps: string[];
  summary: SessionSummary | null;
}

export interface AnalysisEntry {
  id: string;
  sessionId: string;
  sentence: string;
  scenarioTitle: string;
  createdAt: string;
  overview: string;
  strengths: string[];
  grammar: string[];
  naturalness: string[];
  revision: string;
  koreanSummary: string;
  vocabulary: VocabularyCard[];
}

export interface SuggestionBundle {
  suggestions: string[];
  coachTip: string;
  focusPoint: string;
}

export interface Settings {
  apiKey: string;
  model: string;
  saveApiKey: boolean;
  userName: string;
  coachMode: CoachMode;
  voiceName: string;
  speechRate: number;
  autoSpeakAi: boolean;
  dailyMinutesGoal: number;
}

export interface ExportBundle {
  settings: Omit<Settings, 'apiKey'>;
  sessions: Session[];
  analyses: AnalysisEntry[];
  vocabulary: VocabularyCard[];
}
