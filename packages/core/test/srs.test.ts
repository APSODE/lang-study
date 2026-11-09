import { describe, expect, it } from 'vitest'
import { gradeOf, newCard, parseCard, review, serializeCard } from '../src/index.ts'

describe('srs', () => {
  it('정답이면 오답보다 다음 복습이 늦다', () => {
    const now = new Date('2026-11-09T00:00:00Z')
    const c = newCard(now)
    const good = review(c, gradeOf(true), now).card
    const again = review(c, gradeOf(false), now).card
    expect(good.due.getTime()).toBeGreaterThan(again.due.getTime())
  })
  it('직렬화 왕복', () => {
    const c = review(newCard(new Date()), gradeOf(true), new Date()).card
    const back = parseCard(serializeCard(c))
    expect(back.due).toBeInstanceOf(Date)
    expect(back.due.getTime()).toBe(c.due.getTime())
  })
})
