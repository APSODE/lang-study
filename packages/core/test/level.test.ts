import { describe, expect, it } from 'vitest'
import { autoTitleLang, isTitlePref, levelForXp, levelInfo, streakBonuses, titleForLevel, titleLangFor, TITLES_EN, TITLES_JA, xpForLevel } from '../src/index.ts'

const prev = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
const run = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10))

describe('레벨', () => {
  it('필요 XP = round(50 × (n−1)^1.5), Lv1 = 0', () => {
    expect([1, 2, 3, 4, 5, 10].map(xpForLevel)).toEqual([0, 50, 141, 260, 400, 1350])
  })
  it('경계: 0 → Lv1, 49 → Lv1, 50 → Lv2, 140 → Lv2, 141 → Lv3', () => {
    expect([0, 49, 50, 140, 141].map(levelForXp)).toEqual([1, 1, 2, 2, 3])
  })
  it('상한 없음', () => {
    expect(levelForXp(xpForLevel(120))).toBe(120)
    expect(levelForXp(xpForLevel(120) - 1)).toBe(119)
  })
  it('levelInfo 는 지금 레벨 시작 · 다음 레벨 XP 를 준다', () => {
    expect(levelInfo(60)).toEqual({ level: 2, title: '「あ」부터 시작한 새싹 🌱', titleLang: 'ja', xp: 60, levelXp: 50, nextLevelXp: 141 })
    expect(levelInfo(60, 'en')).toMatchObject({ level: 2, title: 'ABC 떼고 온 새싹 🌱', titleLang: 'en' })
  })
})

describe('칭호', () => {
  // 구간 시작 레벨: 1 3 5 7 10 13 16 20 25 30 35 40 50
  const starts = [1, 3, 5, 7, 10, 13, 16, 20, 25, 30, 35, 40, 50]
  const ja = [
    '「あ」부터 시작한 새싹 🌱',
    '가타카나 보면 멈칫하는 사람',
    '편의점 いらっしゃいませ 알아들음',
    '라멘 주문 성공자 🍜',
    '한자 보면 덜 무서운 사람',
    '후리가나 졸업반 🎓',
    '단어장 수집가',
    'JLPT 접수 버튼 앞에서 고민 중',
    '애니 자막 반쯤 끈 사람 📺',
    '일드 무자막 도전자',
    '한자 2000자 탐험가 🧭',
    '오사카 사투리도 알아듣는 사람 🐙',
    '나카무라 그 자체 👑',
  ]
  const en = [
    'ABC 떼고 온 새싹 🌱',
    '"Fine, thank you. And you?" 자동 반사',
    '카페 영어 주문 성공자 ☕',
    '미드 자막을 영어로 바꿔 본 사람',
    '단어장 형광펜 장인 🖍️',
    '토익 LC 에서 졸지 않는 사람',
    '메일 끝에 "Best regards" 쓰는 사람',
    '토익 접수 버튼 앞에서 고민 중',
    '해외 직구 문의 메일 혼자 보내는 사람 📦',
    '영어 원서 첫 장 넘긴 사람 📖',
    '아카데믹 단어 탐험가 🧭',
    '토플 스피킹 타이머도 안 무서운 사람 ⏱️',
    '원어민 코스프레 장인 👑',
  ]
  it('표 그대로', () => {
    expect(TITLES_JA.map(t => [t.from, t.title])).toEqual(starts.map((f, i) => [f, ja[i]]))
    expect(TITLES_EN.map(t => [t.from, t.title])).toEqual(starts.map((f, i) => [f, en[i]]))
  })
  it('두 표의 구간 경계 (시작 레벨 · 바로 앞 레벨)', () => {
    starts.forEach((from, i) => {
      expect(titleForLevel(from, 'ja')).toBe(ja[i])
      expect(titleForLevel(from, 'en')).toBe(en[i])
      if (i > 0) {
        expect(titleForLevel(from - 1, 'ja')).toBe(ja[i - 1])
        expect(titleForLevel(from - 1, 'en')).toBe(en[i - 1])
      }
    })
    expect(titleForLevel(49)).toBe('오사카 사투리도 알아듣는 사람 🐙')
    expect(titleForLevel(500, 'ja')).toBe('나카무라 그 자체 👑')
    expect(titleForLevel(500, 'en')).toBe('원어민 코스프레 장인 👑')
  })
  it('언어 판정: 복습 XP 가 더 많은 쪽, 같으면 일본어', () => {
    expect(autoTitleLang({ ja: 10, en: 3 })).toBe('ja')
    expect(autoTitleLang({ ja: 3, en: 10 })).toBe('en')
    expect(autoTitleLang({ ja: 5, en: 5 })).toBe('ja')
    expect(autoTitleLang({ ja: 0, en: 0 })).toBe('ja')
  })
  it('설정이 자동이 아니면 그 언어', () => {
    expect(titleLangFor('auto', { ja: 1, en: 9 })).toBe('en')
    expect(titleLangFor('ja', { ja: 1, en: 9 })).toBe('ja')
    expect(titleLangFor('en', { ja: 9, en: 1 })).toBe('en')
    expect([isTitlePref('auto'), isTitlePref('ja'), isTitlePref('en'), isTitlePref('kr'), isTitlePref(null)]).toEqual([true, true, true, false, false])
  })
})

describe('연속 학습일 보너스', () => {
  it('7 · 30 일째에 닿은 날', () => {
    const days = run('2026-01-01', 30)
    expect(streakBonuses(days, prev)).toEqual([
      { day: '2026-01-07', xp: 20 },
      { day: '2026-01-30', xp: 50 },
    ])
  })
  it('끊기면 다시 7일부터', () => {
    const days = [...run('2026-01-01', 7), ...run('2026-01-10', 7)]
    expect(streakBonuses(days, prev).map(s => s.day)).toEqual(['2026-01-07', '2026-01-16'])
  })
  it('6일이면 없다', () => {
    expect(streakBonuses(run('2026-01-01', 6), prev)).toEqual([])
  })
})
