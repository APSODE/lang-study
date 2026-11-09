-- 사용자 · 초대 · 세션
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  tz            TEXT NOT NULL DEFAULT 'Asia/Seoul',   -- 연속 학습일 · 하루 경계 계산
  show_progress INTEGER NOT NULL DEFAULT 1,           -- 진도 보기 · 리더보드 공개 여부
  created_at    INTEGER NOT NULL
);

CREATE TABLE invites (
  code       TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  max_uses   INTEGER NOT NULL DEFAULT 1,
  uses       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- 콘텐츠: DB 가 원본. git 에는 공개된 노트만 JSON 으로 내보낸다.
CREATE TABLE notes (
  id         TEXT PRIMARY KEY,                 -- 예: kana-hira-ka, kanji-食, toeic-invoice
  track      TEXT NOT NULL,                    -- kana | kanji | toeic | ...
  fields     TEXT NOT NULL,                    -- JSON (트랙별 필드)
  status     TEXT NOT NULL DEFAULT 'draft',    -- draft | published | retired
  source     TEXT NOT NULL,                    -- dict:kanjidic2 | ai | upload:<user> | manual
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX notes_track_status ON notes(track, status);

CREATE TABLE note_revisions (
  id         INTEGER PRIMARY KEY,
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  fields     TEXT NOT NULL,
  status     TEXT NOT NULL,
  edited_by  INTEGER REFERENCES users(id),
  reason     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX note_revisions_note ON note_revisions(note_id, created_at);

-- 음성: 파일은 DATA_DIR/audio, DB 에는 기록만. 나중에 발음 녹음도 같은 구조.
CREATE TABLE audio (
  id         TEXT PRIMARY KEY,
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  field      TEXT NOT NULL,          -- 어떤 텍스트의 음성인지: word | example_en | char ...
  lang       TEXT NOT NULL,          -- ja | en
  voice      TEXT NOT NULL,          -- voicevox:<speaker> | piper:<model> | kokoro:<voice>
  path       TEXT NOT NULL,          -- DATA_DIR/audio 기준 상대 경로
  credit     TEXT,                   -- 출처 표기 (VOICEVOX 등)
  created_at INTEGER NOT NULL
);
CREATE INDEX audio_note ON audio(note_id, field);

-- 학습: 카드 = 노트 × 연습 방식. 사용자가 처음 볼 때 행이 생긴다.
CREATE TABLE user_cards (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id       TEXT NOT NULL,       -- <note_id>:<drill_id>
  note_id       TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  drill_id      TEXT NOT NULL,
  track         TEXT NOT NULL,
  fsrs          TEXT NOT NULL,       -- ts-fsrs Card JSON
  due           INTEGER NOT NULL,    -- 조회용 (ms)
  introduced_at INTEGER NOT NULL,    -- 하루 신규 카드 제한 계산
  suspended     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, card_id)
);
CREATE INDEX user_cards_due ON user_cards(user_id, suspended, due);
CREATE INDEX user_cards_intro ON user_cards(user_id, track, introduced_at);

CREATE TABLE review_logs (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id     TEXT NOT NULL,
  rating      INTEGER NOT NULL,      -- 1 Again .. 4 Easy
  correct     INTEGER NOT NULL,
  response    TEXT,
  duration_ms INTEGER,
  reviewed_at INTEGER NOT NULL       -- 연속 학습일 · 주간 리더보드
);
CREATE INDEX review_logs_user_time ON review_logs(user_id, reviewed_at);
CREATE INDEX review_logs_time ON review_logs(reviewed_at);

-- 하루 신규 카드 수 (없으면 기본 15)
CREATE TABLE user_track_settings (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track       TEXT NOT NULL,
  new_per_day INTEGER NOT NULL,
  PRIMARY KEY (user_id, track)
);

-- 문항 신고
CREATE TABLE reports (
  id          INTEGER PRIMARY KEY,
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  card_id     TEXT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  reason      TEXT NOT NULL,         -- wrong_answer | typo | audio | other
  body        TEXT,
  status      TEXT NOT NULL DEFAULT 'open',   -- open | resolved | rejected
  resolved_by INTEGER REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX reports_status ON reports(status, created_at);
