import type { JSX } from 'react'
import type { QueueItem } from '../study.ts'

export interface DrillProps {
  item: QueueItem
  /** 채점 결과. null 이면 아직 답하지 않았다 (답한 뒤에는 입력을 잠근다). */
  result: { correct: boolean; expected: string; response: string } | null
  /** 응답 제출. 채점 · 저장은 학습 화면이 한다. */
  onSubmit: (response: string) => void
}

export type DrillComponent = (props: DrillProps) => JSX.Element
