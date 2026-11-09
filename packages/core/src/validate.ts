// 노트 검사. 가져오기(파일 · 업로드 · AI 생성)는 DB 에 넣기 전에 반드시 이걸 거친다.
//
// id 규칙: `<트랙>-<이름>` (예: kana-hira-ka, kanji-食, toeic-invoice)
//   - 앞부분은 노트의 track 과 같아야 한다.
//   - 이름은 공백과 ':' 를 쓸 수 없다 (카드 id 가 `<노트 id>:<연습 방식 id>` 이므로).
// 필드: 트랙별로 정해진 키만 허용한다 (오타로 생긴 키를 잡기 위해). 새 필드는 notes.ts 와 여기에 같이 추가한다.
import { KANA_SCRIPTS, isTrack, type Track } from './notes.ts'

export const NOTE_ID_RE = /^([a-z]+)-[^\s:]+$/

type Obj = Record<string, unknown>
type FieldRule = (v: unknown) => string | null

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const str: FieldRule = v => (typeof v === 'string' && v.trim() !== '' ? null : '비어 있지 않은 문자열이어야 합니다')
const bool: FieldRule = v => (typeof v === 'boolean' ? null : 'true/false 여야 합니다')
const strArr: FieldRule = v =>
  Array.isArray(v) && v.every(x => typeof x === 'string' && x.trim() !== '') ? null : '문자열 배열이어야 합니다'
const int = (min: number, max = Number.MAX_SAFE_INTEGER): FieldRule => v =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : `${min}–${max} 정수여야 합니다`
const oneOf = (xs: readonly string[]): FieldRule => v => (xs.includes(v as string) ? null : `${xs.join(' | ')} 중 하나여야 합니다`)
const romaji: FieldRule = v => (typeof v === 'string' && /^[a-z]+$/.test(v) ? null : '소문자 로마자여야 합니다')
const examples: FieldRule = v =>
  Array.isArray(v) && v.every(e => isObj(e) && ['word', 'reading', 'meaning_ko'].every(k => str(e[k]) === null))
    ? null
    : '{ word, reading, meaning_ko } 배열이어야 합니다'

interface Schema {
  required: Record<string, FieldRule>
  optional: Record<string, FieldRule>
}

const SCHEMAS: Record<Track, Schema> = {
  kana: {
    required: { char: str, romaji, script: oneOf(KANA_SCRIPTS), row: romaji },
    optional: { dakuon: bool, yoon: bool, hint: str, order: int(0) },
  },
  kanji: {
    required: { kanji: str, on: strArr, kun: strArr, meanings_ko: strArr },
    optional: { jlpt: int(1, 5), strokes: int(1), examples },
  },
  toeic: {
    required: { word: str, meaning_ko: str },
    optional: { pos: str, example_en: str, example_ko: str, list: oneOf(['TSL', 'NGSL']) },
  },
}

/** 문제점 목록을 돌려준다. 빈 배열이면 통과. */
export const validateNote = (note: unknown): string[] => {
  if (!isObj(note)) return ['노트는 객체여야 합니다']
  const errs: string[] = []
  for (const k of Object.keys(note)) if (!['id', 'track', 'fields'].includes(k)) errs.push(`알 수 없는 키: ${k}`)

  const { id, track, fields } = note
  if (!isTrack(track)) {
    errs.push(`알 수 없는 트랙: ${JSON.stringify(track)}`)
  }
  if (typeof id !== 'string' || !NOTE_ID_RE.test(id)) {
    errs.push(`id 형식이 틀립니다 (<트랙>-<이름>, 공백 · ':' 불가): ${JSON.stringify(id)}`)
  } else if (isTrack(track) && id.match(NOTE_ID_RE)![1] !== track) {
    errs.push(`id 앞부분이 트랙(${track})과 다릅니다: ${id}`)
  }
  if (!isObj(fields)) {
    errs.push('fields 는 객체여야 합니다')
    return errs
  }
  if (!isTrack(track)) return errs

  const { required, optional } = SCHEMAS[track]
  for (const [k, rule] of Object.entries(required)) {
    if (!(k in fields)) errs.push(`fields.${k} 가 없습니다`)
    else {
      const e = rule(fields[k])
      if (e) errs.push(`fields.${k}: ${e}`)
    }
  }
  for (const [k, v] of Object.entries(fields)) {
    if (k in required) continue
    const rule = optional[k]
    if (!rule) errs.push(`알 수 없는 필드: fields.${k}`)
    else {
      const e = rule(v)
      if (e) errs.push(`fields.${k}: ${e}`)
    }
  }
  return errs
}
