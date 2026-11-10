import { describe, expect, it } from 'vitest'
import { levelForXp, levelInfo, streakBonuses, titleForLevel, xpForLevel } from '../src/index.ts'

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
    expect(levelInfo(60)).toEqual({ level: 2, title: '「あ」부터 시작한 새싹 🌱', xp: 60, levelXp: 50, nextLevelXp: 141 })
  })
})

describe('칭호', () => {
  it('표의 구간 경계', () => {
    expect(titleForLevel(1)).toBe('「あ」부터 시작한 새싹 🌱')
    expect(titleForLevel(2)).toBe('「あ」부터 시작한 새싹 🌱')
    expect(titleForLevel(3)).toBe('가타카나 보면 멈칫하는 사람')
    expect(titleForLevel(9)).toBe('라멘 주문 성공자 🍜')
    expect(titleForLevel(10)).toBe('한자 보면 덜 무서운 사람')
    expect(titleForLevel(49)).toBe('토익 · 토플까지 씹어먹는 단어 사냥꾼')
    expect(titleForLevel(50)).toBe('나카무라 그 자체 👑')
    expect(titleForLevel(500)).toBe('나카무라 그 자체 👑')
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
