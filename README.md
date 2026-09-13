# 높이 높이 · Higher Higher

![높이 높이](public/thumbnail.png)

> **무너지기 전까지, 더 높이.** 랜덤 블록을 하나씩 위로 쌓아 최고 높이 기록에 도전하는 물리 기반 밸런스 게임. 균형을 못 잡으면 탑이 실제로 기울다 **와르르** 무너집니다.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38BDF8?logo=tailwindcss&logoColor=white)
![matter.js](https://img.shields.io/badge/matter.js-physics-4B5563)
![license](https://img.shields.io/badge/100%25-client--side-06D6A0)

## 🔗 라이브 데모

### ▶️ **https://higher-higher-lac.vercel.app**

## 🎮 게임 소개

- 랜덤한 모양의 블록이 하나씩 주어집니다. **드래그로 좌우 조준**하고 **탭 / 스페이스로 드롭**하세요.
- 떨어진 블록은 **2D 강체 물리 엔진(matter.js)** 으로 실제 중력·마찰·회전(토크)에 따라 낙하·안착합니다.
- **잘 놓으면 안정적으로**, **치우치게 놓으면 기울다가** 균형을 잃고 무너집니다. 무너지면 게임 종료!
- 블록은 **최대 100개**. 무너지지 않고 100개를 다 쌓으면 **완주(클리어)** 입니다.
- 높이 올라갈수록 배경 하늘이 **새벽 → 한낮 → 성층권 → 우주**로 변합니다. 🌌

## ✨ 주요 기능

- 🧱 **다양한 랜덤 블록** — 정사각·직사각·와이드·사다리꼴·L자·T자·삼각형·다각형·반원·원까지. 굴러가기 쉬운 모양은 뒤로 갈수록 등장해 긴장감을 더합니다.
- ⚖️ **진짜 물리 밸런스** — 커스텀 캔버스 렌더링 + 고정 timestep 물리 시뮬레이션. 처음 몇 블록은 쉽게, 갈수록 아슬아슬하게.
- 📈 **높이·블록 수 HUD** — 실시간 높이(m), 진행도(/100), 흔들림 경고. 탑이 자라면 카메라가 위로 따라 올라갑니다.
- 🏆 **최고 기록 저장** — `localStorage`에 최고 높이/블록 수 기록. 게임오버·완주 시 **결과 스코어 카드**(탑 스냅샷 이미지) 저장/공유.
- 🎯 **조작** — 드래그 조준, 탭/스페이스 드롭, ← → 이동, ↺ ↻ 회전. **데스크톱 & 모바일 터치** 모두 지원.
- 🔊 **효과음 & 파티클** — Web Audio 기반 사운드, 안착 스파클, 붕괴 흔들림, 완주 컨페티.

## 🕹️ 조작법

| 입력 | 동작 |
| --- | --- |
| 드래그 | 블록 좌우 조준 |
| 탭 / `Space` / `Enter` | 드롭 |
| `←` `→` | 미세 이동 |
| `↺` `↻` / `Q` `E` / `↑` | 회전 |

## 🛠️ 기술 스택

- **React 19 + TypeScript** — UI / 상태
- **Vite 8** — 번들러 · 개발 서버
- **Tailwind CSS v4** — 다크 테마 UI
- **matter.js** — 2D 강체 물리(중력·충돌·마찰·토크). 렌더링은 물리 세계와 분리한 **커스텀 Canvas 2D**
- 서버·API 키 없이 **100% 클라이언트**에서 동작하는 정적 배포

## 🧪 검증

게임 상태 로직(블록 생성/난수, 높이·점수 계산, 100개 제한, 무너짐 판정)은 순수 함수로 분리해 자동 테스트합니다.

```bash
npm test   # 순수 로직 33개 단언 (tsx)
```

물리 플레이는 Playwright로 실제 구동을 확인했습니다 — 잘 정렬해 드롭하면 높이/블록 수가 증가하고, 일부러 치우치게 쌓으면 탑이 기울다 게임오버로 이어집니다.

## 🚀 로컬 실행

```bash
npm install
npm run dev      # 개발 서버
npm run build    # 타입체크 + 프로덕션 빌드
npm run preview  # 빌드 미리보기
```

## 📸 스크린샷

![플레이 화면](docs/play.png)

---

작게 시작해 우주까지. 당신의 기록은 몇 미터인가요? 🚀
