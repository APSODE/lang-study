#!/bin/sh
# 이 PC(x86_64)에서 이미지를 빌드해 서버로 보낸다. 서버에서는 빌드하지 않는다.
# 사용: deploy/server/push-image.sh [ssh 호스트, 기본 oracle]
set -eu
HOST=${1:-oracle}
cd "$(dirname "$0")/../.."
docker build -t nakamura:local .
docker save nakamura:local | gzip -1 | ssh "$HOST" 'gunzip | sudo docker load'
ssh "$HOST" 'cd /opt/nakamura && sudo docker compose up -d && sudo docker image prune -f >/dev/null'
echo "배포 완료: $HOST"
