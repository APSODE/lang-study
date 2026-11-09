// FSRS 래퍼. 카드 상태는 사용자별 · 카드별로 DB 에 JSON 으로 저장한다.
import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs'

export { Rating }
export type { Card as SrsCard, Grade }

/** 하루 신규 카드 기본값. 사용자별 · 트랙별로 바꿀 수 있다. 복습 카드는 제한하지 않는다. */
export const DEFAULT_NEW_PER_DAY = 15

const scheduler = fsrs({ enable_fuzz: true })

export const newCard = (now: Date): Card => createEmptyCard(now)

export const review = (card: Card, grade: Grade, now: Date) => scheduler.next(card, now, grade)

/** 정답 여부만 있을 때의 기본 평가 */
export const gradeOf = (correct: boolean): Grade => (correct ? Rating.Good : Rating.Again)

/** DB 저장용 */
export const serializeCard = (c: Card): string => JSON.stringify(c)
export const parseCard = (s: string): Card => {
  const o = JSON.parse(s) as Card
  return { ...o, due: new Date(o.due), last_review: o.last_review ? new Date(o.last_review) : undefined }
}
