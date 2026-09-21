/**
 * 아케이드 아이콘 세트.
 *
 * 원래는 UI 전체가 이모지(🔊 🏆 💥 🔗 🖼️ 🥇 …)였다. 이모지는 기기·OS 마다 다른 그림이
 * 나오고 획 두께·크기 기준이 제각각이라, 나란히 놓으면 무슨 짓을 해도 정돈되지 않는다.
 * 같은 24 격자 위에 같은 규칙으로 그린 이 세트로 전부 갈아끼웠다.
 *
 * 규칙 — 아케이드 방향에 맞춘 "두껍고 꽉 찬" 형태:
 *  - viewBox 는 24×24 고정. 크기는 size 로만 바꾼다(획 두께가 같이 커져야 인상이 유지된다).
 *  - 면은 채우고(fill), 선을 쓸 땐 2.6~2.8 로 굵게, 끝은 둥글게.
 *  - 색은 currentColor — 쓰는 쪽 글자색을 그대로 따라간다.
 *  - 게임 소재를 그대로 쓴다: 랭킹은 트로피가 아니라 블록 3개 시상대, 게임오버는
 *    폭발이 아니라 무너진 블록 더미. 그래야 이 게임의 아이콘이 된다.
 *
 * 글자 옆에 붙는 아이콘은 전부 장식이라 aria-hidden 이다. 아이콘만 있는 버튼은
 * 버튼 쪽에 aria-label 을 단다.
 */
interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 20, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  );
}

/** 스피커 몸통 — 소리 켬/끔이 같은 모양을 쓴다. */
const speaker = <path d="M4 9h3.2l4.6-3.9v13.8L7.2 15H4z" fill="currentColor" />;

export function VolumeOn(p: IconProps) {
  return (
    <Svg {...p}>
      {speaker}
      <path
        d="M15.6 9.6a3.6 3.6 0 0 1 0 4.8"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M18.5 7a7.4 7.4 0 0 1 0 10"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function VolumeOff(p: IconProps) {
  return (
    <Svg {...p}>
      {speaker}
      <path
        d="M15.6 9.8l4.6 4.6M20.2 9.8l-4.6 4.6"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 랭킹·최고기록 — 트로피 대신 블록 3개로 만든 시상대. */
export function Podium(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="9" y="6" width="6" height="13.5" rx="1.5" fill="currentColor" />
      <rect x="2.5" y="11.2" width="6.2" height="8.3" rx="1.5" fill="currentColor" />
      <rect x="15.3" y="9.5" width="6.2" height="10" rx="1.5" fill="currentColor" />
    </Svg>
  );
}

/** 게임오버 — 무너져 흩어진 블록. */
export function Collapse(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.6" y="15" width="8.8" height="5" rx="1.5" fill="currentColor" />
      <rect
        x="13"
        y="14.4"
        width="8.4"
        height="5"
        rx="1.5"
        fill="currentColor"
        transform="rotate(11 17.2 16.9)"
      />
      <rect
        x="6"
        y="6.4"
        width="8.4"
        height="5"
        rx="1.5"
        fill="currentColor"
        transform="rotate(-19 10.2 8.9)"
      />
    </Svg>
  );
}

/** 완주 — 정상에 꽂은 깃발. */
export function Flag(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.6" y="16.4" width="16.8" height="4.2" rx="1.6" fill="currentColor" />
      <rect x="6.6" y="3.6" width="2.6" height="13.4" rx="1.3" fill="currentColor" />
      <path d="M9.8 4.6h7.8l-2.3 2.9 2.3 2.9H9.8z" fill="currentColor" />
    </Svg>
  );
}

export function Share(p: IconProps) {
  return (
    <Svg {...p}>
      <path
        d="M9 10.7l5.9-3.3M9 13.3l5.9 3.3"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="17.4" cy="6" r="3.2" fill="currentColor" />
      <circle cx="6.6" cy="12" r="3.2" fill="currentColor" />
      <circle cx="17.4" cy="18" r="3.2" fill="currentColor" />
    </Svg>
  );
}

export function Check(p: IconProps) {
  return (
    <Svg {...p}>
      <path
        d="M4.8 12.6l4.6 4.6L19.2 7.2"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 결과 카드 — 카드 테두리 안에 블록 두 개. */
export function Card(p: IconProps) {
  return (
    <Svg {...p}>
      <rect
        x="3"
        y="4.2"
        width="18"
        height="15.6"
        rx="3.4"
        stroke="currentColor"
        strokeWidth="2.6"
      />
      <rect x="8.4" y="13" width="7.2" height="3.4" rx="1.2" fill="currentColor" />
      <rect x="9.8" y="8.4" width="4.4" height="3.4" rx="1.2" fill="currentColor" />
    </Svg>
  );
}

export function Replay(p: IconProps) {
  return (
    <Svg {...p}>
      <path
        d="M19.6 12a7.6 7.6 0 1 1-2.4-5.6"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.8 4.4v4.6h-4.6"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function Home(p: IconProps) {
  return (
    <Svg {...p}>
      <path
        d="M3.4 10.8L12 3.8l8.6 7"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.2 9.8V20h11.6V9.8"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 이 기록의 탑 모양 보기. */
export function Tower(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5.2" y="16" width="13.6" height="3.8" rx="1.3" fill="currentColor" />
      <rect x="7.4" y="10.8" width="9.2" height="3.8" rx="1.3" fill="currentColor" />
      <rect x="9.4" y="5.6" width="5.2" height="3.8" rx="1.3" fill="currentColor" />
    </Svg>
  );
}

export function Search(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="10.6" cy="10.6" r="6.4" stroke="currentColor" strokeWidth="2.6" />
      <path
        d="M15.4 15.4l4.8 4.8"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function Close(p: IconProps) {
  return (
    <Svg {...p}>
      <path
        d="M6.2 6.2l11.6 11.6M17.8 6.2L6.2 17.8"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 탑이 휘청이는 중 — 기울어진 블록과 흔들림. */
export function Wobble(p: IconProps) {
  return (
    <Svg {...p}>
      <rect
        x="6.4"
        y="8.8"
        width="11.2"
        height="6.4"
        rx="2"
        fill="currentColor"
        transform="rotate(-12 12 12)"
      />
      <path
        d="M3.2 9.4c-1 1.7-1 3.5 0 5.2"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M20.8 9.4c1 1.7 1 3.5 0 5.2"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function Bars(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.4" y="12.4" width="4.6" height="7.4" rx="1.4" fill="currentColor" />
      <rect x="9.7" y="6.6" width="4.6" height="13.2" rx="1.4" fill="currentColor" />
      <rect x="16" y="14.6" width="4.6" height="5.2" rx="1.4" fill="currentColor" />
    </Svg>
  );
}
