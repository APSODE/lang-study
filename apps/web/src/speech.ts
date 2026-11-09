// 듣기. 지금은 브라우저 TTS(Web Speech API)만 쓴다. 지원하지 않는 브라우저에서는 아무것도 하지 않는다.
//
// 나중에 미리 만든 음성 파일(서버 audio 테이블, DATA_DIR/audio)을 낼 때는 setAudioSource 로
// "텍스트 → 파일 주소" 함수를 등록하면 된다. 주소가 있으면 그 파일을 먼저 재생하고, 없거나 재생이 실패하면 TTS 로 넘어간다.
// 화면 코드는 speak() 만 부르므로 바꿀 필요가 없다.

export type SpeechLang = 'ja-JP' | 'en-US'

/** 미리 녹음한 음성 파일 주소를 찾는다. 없으면 null. */
export type AudioSource = (text: string, lang: SpeechLang) => string | null

let audioSource: AudioSource | null = null

export const setAudioSource = (fn: AudioSource | null): void => {
  audioSource = fn
}

const synth = (): SpeechSynthesis | null =>
  typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null

export const canSpeak = (): boolean => synth() !== null || audioSource !== null

// 목소리 목록은 비동기로 채워지는 브라우저가 있다 (크롬). 미리 한 번 불러 둔다.
const s0 = synth()
if (s0) {
  s0.getVoices()
  s0.addEventListener?.('voiceschanged', () => s0.getVoices())
}

const pickVoice = (s: SpeechSynthesis, lang: SpeechLang): SpeechSynthesisVoice | undefined => {
  const voices = s.getVoices()
  const norm = (l: string) => l.replace('_', '-').toLowerCase()
  const exact = voices.filter(v => norm(v.lang) === lang.toLowerCase())
  const prefix = voices.filter(v => norm(v.lang).startsWith(lang.slice(0, 2).toLowerCase()))
  const list = exact.length ? exact : prefix
  return list.find(v => v.localService) ?? list[0]
}

const speakTts = (text: string, lang: SpeechLang): void => {
  const s = synth()
  if (!s) return
  try {
    s.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    const voice = pickVoice(s, lang)
    if (voice) u.voice = voice
    u.rate = lang === 'ja-JP' ? 0.85 : 0.95
    s.speak(u)
  } catch {
    // 일부 브라우저는 사용자 동작 없이 재생하면 예외를 낸다 — 다시 듣기 버튼으로 재생하면 된다
  }
}

export const speak = (text: string, lang: SpeechLang): void => {
  const url = audioSource?.(text, lang)
  if (url) {
    new Audio(url).play().catch(() => speakTts(text, lang))
    return
  }
  speakTts(text, lang)
}
