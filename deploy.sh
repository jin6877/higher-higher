#!/usr/bin/env bash
# 높이 높이 배포 — 서버(mini-PC, amd64)에서 직접 실행한다.
# 서버가 amd64 라 이 위에서 바로 빌드하면 크로스빌드 이슈가 없다.
#
# 최초 1회:
#   git clone https://github.com/jin6877/higher-higher.git ~/higher-higher
# 이후 배포:
#   cd ~/higher-higher && bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "[1/3] 최신 코드 pull"
git pull --ff-only

echo "[2/3] 이미지 빌드 + 컨테이너 기동 (infra-net)"
docker compose up -d --build

echo "[3/3] 헬스체크"
sleep 3
docker compose exec -T higher-higher node -e "fetch('http://localhost:8080/healthz').then(r=>r.text()).then(t=>{console.log('healthz:',t);process.exit(t.trim()==='ok'?0:1)}).catch(e=>{console.error(e);process.exit(1)})" \
  || { echo '헬스체크 실패 — 로그:'; docker compose logs --tail=40 higher-higher; exit 1; }

echo "✅ 배포 완료. (엣지 nginx 가 higher.brag.io.kr → higher-higher:8080 로 프록시)"
