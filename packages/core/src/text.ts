// 채점용 문자열 정규화. 서버 재채점과 브라우저가 같은 함수를 쓴다.

/** 가타카나 → 히라가나 (장음 ー 는 그대로) */
export const kataToHira = (s: string): string =>
  s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))

/** 읽기 비교용: 히라가나로, 공백 · 훈독 구분자(. -) 제거 */
export const normReading = (s: string): string => kataToHira(s.normalize('NFKC')).replace(/[\s.\-]/g, '')

/** 문장 비교용 (일작): NFKC, 공백 · 문장 부호(、。！？!?.,) 제거. 가나 비교는 여기에 kataToHira 를 더 한다 */
export const normSentence = (s: string): string => s.normalize('NFKC').replace(/[\s、。！？!?.,]/g, '')

/** 로마자 비교용: 소문자, 공백 · 기호 제거, 훈령식 · 헵번식 차이 흡수 */
export const normRomaji = (s: string): string => {
  const t = s.normalize('NFKC').toLowerCase().replace(/[^a-z]/g, '')
  return t
    .replace(/shi/g, 'si').replace(/chi/g, 'ti').replace(/tsu/g, 'tu').replace(/fu/g, 'hu')
    .replace(/sh/g, 'sy').replace(/ch/g, 'ty').replace(/j(?=[aueo])/g, 'zy').replace(/ji/g, 'zi')
}

/** 뜻 비교용: 공백 · 괄호 설명 제거 */
export const normMeaning = (s: string): string => s.normalize('NFKC').replace(/\(.*?\)|（.*?）/g, '').replace(/\s+/g, '').trim()

/** "a, b; c" → ['a','b','c'] */
export const splitMeanings = (s: string): string[] => s.split(/[,;·/]/).map(x => x.trim()).filter(Boolean)
