-- 칭호 언어 설정: 'auto'(복습 XP 가 더 많은 언어, 같으면 일본어) · 'ja' · 'en'. 레벨은 하나, 칭호만 두 벌 (study/level.ts).
ALTER TABLE users ADD COLUMN title_lang TEXT NOT NULL DEFAULT 'auto';
