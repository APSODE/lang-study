#!/bin/sh
# SQLite 일관된 사본 → data/backups/app-YYYYmmdd-HHMM.sqlite, 14일 지난 것은 지운다.
# cron 예: 30 4 * * * root /opt/nakamura/backup.sh >> /opt/nakamura/data/backups/backup.log 2>&1
set -eu
docker exec nakamura node apps/server/src/cli.ts backup
find "$(dirname "$0")/data/backups" -name 'app-*.sqlite' -mtime +14 -delete
