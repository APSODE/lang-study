import { describe, expect, it } from 'vitest'
import { dayKey, dayStart, prevDayKey, safeTz, streakOf } from '../src/study/day.ts'

const SEOUL = 'Asia/Seoul'
/** 서울 벽시계 → ms (UTC+9, 서머타임 없음) */
const kst = (iso: string) => Date.parse(`${iso}+09:00`)

describe('학습일 경계 (04:00)', () => {
  it('03:59 는 전날, 04:00 부터 그날', () => {
    expect(dayKey(kst('2026-11-09T03:59:59'), SEOUL)).toBe('2026-11-08')
    expect(dayKey(kst('2026-11-09T04:00:00'), SEOUL)).toBe('2026-11-09')
    expect(dayKey(kst('2026-11-09T00:30:00'), SEOUL)).toBe('2026-11-08')
    expect(dayKey(kst('2026-11-09T23:59:59'), SEOUL)).toBe('2026-11-09')
  })

  it('학습일 시작 시각', () => {
    expect(dayStart(kst('2026-11-09T03:59:59'), SEOUL)).toBe(kst('2026-11-08T04:00:00'))
    expect(dayStart(kst('2026-11-09T04:00:00'), SEOUL)).toBe(kst('2026-11-09T04:00:00'))
    expect(dayStart(kst('2026-11-09T21:15:00'), SEOUL)).toBe(kst('2026-11-09T04:00:00'))
    // 월 · 연 경계
    expect(dayStart(kst('2027-01-01T02:00:00'), SEOUL)).toBe(kst('2026-12-31T04:00:00'))
  })

  it('서머타임이 있는 시간대도 그날 04:00 벽시계', () => {
    const ny = 'America/New_York'
    // 2026-03-08 02:00 에 서머타임 시작 (EST -5 → EDT -4)
    expect(dayStart(Date.parse('2026-03-08T12:00:00Z'), ny)).toBe(Date.parse('2026-03-08T08:00:00Z'))
    expect(dayStart(Date.parse('2026-03-08T07:30:00Z'), ny)).toBe(Date.parse('2026-03-07T09:00:00Z'))
    expect(dayKey(Date.parse('2026-03-08T07:59:00Z'), ny)).toBe('2026-03-07')
    expect(dayKey(Date.parse('2026-03-08T08:00:00Z'), ny)).toBe('2026-03-08')
  })

  it('전날 · 잘못된 시간대', () => {
    expect(prevDayKey('2026-03-01')).toBe('2026-02-28')
    expect(prevDayKey('2026-01-01')).toBe('2025-12-31')
    expect(safeTz('Not/AZone')).toBe(SEOUL)
    expect(safeTz('')).toBe(SEOUL)
    expect(safeTz('Europe/Paris')).toBe('Europe/Paris')
  })
})

describe('연속 학습일', () => {
  const today = '2026-11-09'
  it('오늘부터 거꾸로 센다 (같은 날 여러 번은 하루)', () => {
    expect(streakOf(['2026-11-09', '2026-11-09', '2026-11-08', '2026-11-07', '2026-11-05'], today)).toBe(3)
  })
  it('오늘 안 했으면 어제에서 끝나는 연속을 센다', () => {
    expect(streakOf(['2026-11-08', '2026-11-07'], today)).toBe(2)
  })
  it('어제도 안 했으면 0', () => {
    expect(streakOf(['2026-11-07', '2026-11-06'], today)).toBe(0)
    expect(streakOf([], today)).toBe(0)
  })
  it('월 경계를 넘어 센다', () => {
    expect(streakOf(['2026-03-01', '2026-02-28', '2026-02-27'], '2026-03-01')).toBe(3)
  })
})
