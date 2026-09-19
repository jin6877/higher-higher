import { useEffect, useRef, useState } from "react";

/**
 * 카카오 애드핏 광고 한 칸.
 *
 * ba.min.js 는 "로드되는 시점"에 페이지에서 ins.kakao_ad_area 를 찾아 광고를 채운다.
 * 이 게임은 페이지 이동 없이 모달만 바뀌는 구조라, 칸이 새로 뜰 때마다 ins 와 스크립트를
 * 함께 붙여야 광고가 그려진다. 반대로 시간마다 자동으로 새로 부르지는 않는다 —
 * 사용자 행동 없이 노출을 늘리는 건 광고 정책 위반 소지가 있다.
 *
 * 자리(height)는 미리 잡아 둔다. 광고가 늦게 떠서 아래 버튼을 밀어내면 그 순간 잘못 눌리기 쉽다.
 */
const SCRIPT_SRC = "//t1.kakaocdn.net/kas/static/ba.min.js";
// 광고가 안 채워졌을 때 빈 자리를 접기까지의 시간. 짧게 잡아 사용자가 버튼을 누르기 전에 끝낸다.
const FAIL_MS = 1500;

export function AdFit({
  unit,
  width,
  height,
  className = "",
}: {
  unit: string;
  width: number;
  height: number;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(false);
  // 개발 중 배치 확인용 — ?admock 을 붙이면 광고 크기의 자리표시 박스를 그린다(운영 빌드엔 없음).
  const mock =
    import.meta.env.DEV && new URLSearchParams(window.location.search).has("admock");

  useEffect(() => {
    const box = boxRef.current;
    if (!box || mock) return;
    const ins = document.createElement("ins");
    ins.className = "kakao_ad_area";
    ins.style.display = "none";
    ins.setAttribute("data-ad-unit", unit);
    ins.setAttribute("data-ad-width", String(width));
    ins.setAttribute("data-ad-height", String(height));
    const script = document.createElement("script");
    script.async = true;
    script.src = SCRIPT_SRC;
    box.appendChild(ins);
    box.appendChild(script);

    setEmpty(false);
    const t = window.setTimeout(() => {
      // 이미 떠 있는 광고를 숨기지는 않는다. 자리만 접어 두고, 늦게 오면 그때 늘어난다.
      if (!ins.querySelector("iframe")) setEmpty(true);
    }, FAIL_MS);
    return () => {
      window.clearTimeout(t);
      box.replaceChildren();
    };
  }, [unit, width, height, mock]);

  return (
    <div
      ref={boxRef}
      className={`flex justify-center overflow-hidden ${className}`}
      style={{ minHeight: empty ? 0 : height }}
      aria-hidden
    >
      {mock && (
        <div
          style={{ width, height }}
          className="grid place-items-center rounded-sm border border-white/20 bg-white/90 text-[13px] font-semibold text-[#5a6275]"
        >
          AdFit {width}×{height}
        </div>
      )}
    </div>
  );
}
