-- 파일 올리기: 한 번에 올린 문제 묶음 id. 관리자가 묶음째 공개 · 반려한다 (uploads.ts).
-- 직접 만든 문제 · 가져오기 · 사전 노트는 NULL.
ALTER TABLE notes ADD COLUMN upload_batch TEXT;
CREATE INDEX notes_upload_batch ON notes(upload_batch) WHERE upload_batch IS NOT NULL;
-- 하루 만들기 수 계산 (source = upload:<user id>, created_at)
CREATE INDEX notes_source_created ON notes(source, created_at);
