import type { Scenario } from '../types';

export interface CategoryMeta {
  /** Raw category key used inside scenario data. */
  key: string;
  /** Korean display label. */
  label: string;
  /** Friendly emoji used across cards, chips and the picker. */
  emoji: string;
  /** Strong brand color for the category. */
  color: string;
  /** Soft tinted background that pairs with `color`. */
  soft: string;
  /** One-line description shown on the library category header. */
  blurb: string;
}

/**
 * Visual identity for every scenario category. Keeping it in one place lets the
 * whole app share consistent colors / emoji without scattering hex codes.
 */
export const CATEGORY_META: CategoryMeta[] = [
  {
    key: 'Everyday',
    label: '일상',
    emoji: '☕',
    color: '#f59e0b',
    soft: '#fff7ea',
    blurb: '카페, 쇼핑, 생활 속 실전 대화',
  },
  {
    key: 'Travel',
    label: '여행',
    emoji: '✈️',
    color: '#0ea5e9',
    soft: '#ecfbff',
    blurb: '공항, 호텔, 길 찾기까지 여행 영어',
  },
  {
    key: 'Career',
    label: '커리어',
    emoji: '💼',
    color: '#7c5cff',
    soft: '#f1eeff',
    blurb: '회의, 면접, 협상 등 비즈니스 영어',
  },
  {
    key: 'Social',
    label: '소셜',
    emoji: '🥂',
    color: '#ec4899',
    soft: '#fdeef6',
    blurb: '스몰토크와 관계를 여는 자연스러운 대화',
  },
  {
    key: 'High Stakes',
    label: '고난도',
    emoji: '🎯',
    color: '#ef4444',
    soft: '#fef0f0',
    blurb: '감정과 압박이 큰 상황을 다루는 고급 대화',
  },
  {
    key: 'Custom Lab',
    label: '커스텀',
    emoji: '🧪',
    color: '#10b981',
    soft: '#e9fbf3',
    blurb: '내가 직접 만드는 맞춤형 역할극',
  },
];

const FALLBACK_CATEGORY: CategoryMeta = {
  key: 'Everyday',
  label: '기타',
  emoji: '💬',
  color: '#6366f1',
  soft: '#eef0ff',
  blurb: '다양한 실전 상황',
};

const CATEGORY_BY_KEY = new Map(CATEGORY_META.map((meta) => [meta.key, meta]));

export function categoryMeta(key: string): CategoryMeta {
  return CATEGORY_BY_KEY.get(key) ?? { ...FALLBACK_CATEGORY, key, label: key };
}

export interface DifficultyMeta {
  label: string;
  level: number;
  color: string;
  soft: string;
}

export const DIFFICULTY_META: Record<Scenario['difficulty'], DifficultyMeta> = {
  Starter: { label: '입문', level: 1, color: '#10b981', soft: '#e9fbf3' },
  Builder: { label: '기초', level: 2, color: '#0ea5e9', soft: '#ecfbff' },
  Momentum: { label: '실전', level: 3, color: '#7c5cff', soft: '#f1eeff' },
  Mastery: { label: '고급', level: 4, color: '#ef4444', soft: '#fef0f0' },
};

export function difficultyMeta(value: Scenario['difficulty']): DifficultyMeta {
  return DIFFICULTY_META[value] ?? DIFFICULTY_META.Starter;
}
