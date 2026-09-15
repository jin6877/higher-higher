# 높이 높이 — 서버 배포 가이드 (higher.brag.io.kr)

게임(정적) + 글로벌 랭킹 API 를 **한 컨테이너**가 서빙한다. brag 인프라와는
공용 도커 네트워크(`infra-net`)와 엣지 nginx 라우팅만 공유하고, **앱·DB(SQLite)는 완전히 독립**이다.

```
브라우저 → (443) community-nginx → higher.brag.io.kr → higher-higher:8080
                                                         ├─ /            정적 게임(dist)
                                                         └─ /api/scores  랭킹(SQLite /app/data/higher.db)
```

## 사전 준비 (1회)

### 1) DNS
`higher.brag.io.kr` A 레코드 → 서버 IP (`125.185.37.6`). 전파 후 `dig higher.brag.io.kr` 로 확인.

### 2) 서버에 클론 + 기동
```bash
git clone https://github.com/jin6877/higher-higher.git ~/higher-higher
cd ~/higher-higher
docker compose up -d --build      # infra-net 에 higher-higher 컨테이너 기동
docker compose exec -T higher-higher node -e "fetch('http://localhost:8080/healthz').then(r=>r.text()).then(console.log)"  # → ok
```
> `infra-net` 이 없다는 에러가 나면 brag 인프라(`docker-compose.infra.yml`)가 먼저 떠 있어야 한다.

### 3) TLS 인증서 (Let's Encrypt, outline.brag.io.kr 때와 동일한 webroot 방식)
인증서가 없는 상태에서 443 블록을 넣으면 `nginx -t` 가 실패하므로 **반드시 아래 순서**로.

**3-a. 먼저 80 블록만** — brag 레포 `nginx/nginx.conf` 에 추가하고 reload:
```nginx
# ===== higher-higher (higher.brag.io.kr) — 1단계: ACME 챌린지 =====
server {
    listen 80;
    server_name higher.brag.io.kr;
    location /.well-known/acme-challenge/ { root /etc/letsencrypt/webroot; }
    location / { return 301 https://$host$request_uri; }
}
```
```bash
docker exec community-nginx nginx -t && docker exec community-nginx nginx -s reload
```

**3-b. 인증서 발급** (brag 의 certbot 방식 그대로. webroot = `/etc/letsencrypt/webroot`):
```bash
docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /etc/letsencrypt/webroot:/etc/letsencrypt/webroot \
  certbot/certbot certonly --webroot -w /etc/letsencrypt/webroot \
  -d higher.brag.io.kr --email <your-email> --agree-tos -n
```
> 실제 마운트 경로는 brag 의 outline/apex 인증서 발급 명령과 동일하게 맞출 것.

**3-c. 그다음 443 프록시 블록** — 같은 `nginx/nginx.conf` 에 추가하고 reload:
```nginx
# ===== higher-higher (higher.brag.io.kr) — 2단계: 443 프록시 =====
server {
    listen 443 ssl;
    server_name higher.brag.io.kr;

    ssl_certificate     /etc/letsencrypt/live/higher.brag.io.kr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/higher.brag.io.kr/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        set $higher higher-higher:8080;      # resolver(127.0.0.11)로 동적 해석 — 컨테이너 다운 시에도 nginx 기동 유지
        proxy_pass http://$higher;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
    }
}
```
```bash
docker exec community-nginx nginx -t && docker exec community-nginx nginx -s reload
```
> ⚠️ 이 nginx 블록은 **엣지 라우팅**일 뿐이다(앱·DB 는 전부 이 레포/컨테이너). brag 앱 코드와는 무관.

## 이후 배포
```bash
cd ~/higher-higher && bash deploy.sh      # git pull → compose build+up → healthz
```

## 로컬 개발
```bash
# 터미널 A — 랭킹 서버
cd server && npm install && npm run dev      # :8080 (SQLite = server/data/higher.db)
# 터미널 B — 게임 (vite dev 가 /api → :8080 프록시)
npm install && npm run dev                   # :5173
```

## 데이터/백업
- 랭킹 DB = 도커 볼륨 `higher-data` (`/app/data/higher.db`).
- 백업: `docker run --rm -v higher-data:/d -v "$PWD":/b alpine cp /d/higher.db /b/higher-backup.db`

## API
- `GET  /api/scores?limit=20` → `{ success, data:{ top:[{rank,playerName,heightCm,blocks,createdAt}] }, error }`
- `POST /api/scores` body `{ playerName, heightCm, blocks }` → `{ success, data:{ rank,totalCount,entry,top }, error }`
- 점수는 서버에서 clamp(heightCm ≤ 100000, blocks ≤ 100) + 이름 sanitize(≤20자) + IP Rate Limit(60초 20회).
