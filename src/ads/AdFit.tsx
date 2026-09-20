import { useEffect, useRef, useState } from "react";
import { logEvent } from "../analytics";

/**
 * 카카오 애드핏 광고 한 칸.
 *
 * SDK(ba.min.js) 동작은 실제 스크립트를 뜯어 확인한 것에 맞췄다.
 *  - 광고를 그리는 건 로드 직후의 "초기 스캔" 한 번뿐이다. 700ms 루프는 data-ad-preload="Y"
 *    가 붙은 것만 본다. => 그 뒤에 만든 광고 자리는 adfit.render(요소) 로 직접 그려달라고
 *    해야 한다. 이걸 안 해서 첫 결과 창만 광고가 나오고 그 뒤로는 계속 비어 있었다.
 *  - 배너 API 는 window.adfit 이다(window.kakaoAdFit 은 전면광고·설정용이라 render/destroy 가 없다).
 *      window.adfit()            전체 스캔 후 렌더 — 스크립트 로드 직후 딱 한 번 저절로 돈다
 *      window.adfit.render(el)   특정 자리 하나 렌더
 *      window.adfit.destroy(x)   단위 id 나 요소로 등록 해제
 *  - 같은 data-ad-unit 은 페이지 안에서 유일해야 하고(한 페이지 4개 제한),
 *    칸을 없앨 때 destroy 로 목록에서 빼지 않으면 등록이 쌓여 "중복" 예외로 렌더가 막힌다.
 *    => 결과 창이 여러 번 뜨는 이 게임에서는 정리하지 않으면 몇 판 뒤부터 광고가 안 나온다.
 *  - data-ad-onload / data-ad-onfail 에 "전역 함수 이름"을 적으면 채워짐/실패를 알려준다.
 *
 * 자리(height)는 미리 잡아 둔다. 광고가 늦게 떠서 아래 버튼을 밀어내면 그 순간 잘못 눌리기 쉽다.
 * 시간마다 자동으로 다시 부르지는 않는다 — 사용자 행동 없이 노출을 늘리는 건 정책 위반 소지가 있다.
 */
const SCRIPT_SRC = "https://t1.kakaocdn.net/kas/static/ba.min.js";
// 채워짐/실패 콜백이 둘 다 오지 않는 경우(스크립트 차단 등)에만 쓰는 대비책.
// 버튼이 풀리는 시점(App 의 RETRY_DELAY_MS = 2초)보다 먼저 끝나야 자리가 접히며 버튼이 움직이지 않는다.
const FALLBACK_MS = 1500;

let scriptPromise: Promise<void> | null = null;
function loadScriptOnce(): Promise<void> {
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.async = true;
      s.src = SCRIPT_SRC;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("adfit script"));
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

interface AdFitApi {
  /** 특정 광고 자리를 그린다. 초기 스캔 이후에 만든 자리는 이걸 불러야 한다. */
  render?: (el: HTMLElement) => void;
  destroy?: (target: string | HTMLElement) => void;
}
const sdk = () => (window as { adfit?: AdFitApi }).adfit;

let seq = 0;

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
    let alive = true;

    const ins = document.createElement("ins");
    ins.className = "kakao_ad_area";
    ins.style.display = "none";
    ins.setAttribute("data-ad-unit", unit);
    ins.setAttribute("data-ad-width", String(width));
    ins.setAttribute("data-ad-height", String(height));

    // 콜백은 전역 "이름"으로만 지정할 수 있어서 이름을 만들어 걸고, 정리할 때 지운다.
    const onLoadName = `__adfitLoad${++seq}`;
    const onFailName = `__adfitFail${seq}`;
    const globals = window as unknown as Record<string, unknown>;
    // 광고가 실제로 채워지는 비율과 걸린 시간을 남긴다 — 안 뜨는 게 재고 문제인지
    // 우리 쪽 문제인지 /stats 에서 숫자로 보려고. 광고 요청을 더 만들지는 않는다.
    const shownAt = Date.now();
    let logged = false;
    const log = (name: "ad_fill" | "ad_empty") => {
      if (logged) return;
      logged = true;
      logEvent(name, { durationMs: Date.now() - shownAt });
    };
    globals[onLoadName] = () => {
      log("ad_fill");
      if (alive) setEmpty(false);
    };
    globals[onFailName] = () => {
      log("ad_empty");
      if (alive) setEmpty(true);
    };
    ins.setAttribute("data-ad-onload", onLoadName);
    ins.setAttribute("data-ad-onfail", onFailName);

    // SDK 가 이미 떠 있으면 초기 스캔은 지나간 뒤다 — 이 자리는 직접 그려달라고 해야 한다.
    // 아직 안 떠 있으면 로드 직후의 초기 스캔이 이 태그를 발견하므로 그대로 두면 된다
    // (여기서 또 render 를 부르면 같은 자리를 두 번 그리게 된다).
    const needsRender = !!sdk();
    box.appendChild(ins);
    loadScriptOnce()
      .then(() => {
        if (alive && needsRender) sdk()?.render?.(ins);
      })
      .catch(() => alive && setEmpty(true));

    const fallback = window.setTimeout(() => {
      if (alive && !ins.querySelector("iframe")) setEmpty(true);
    }, FALLBACK_MS);
    // 창을 닫을 때까지 아무 콜백도 안 왔으면 그것도 '안 채워짐' 으로 센다.
    const markUnresolved = () => log("ad_empty");

    return () => {
      alive = false;
      markUnresolved();
      window.clearTimeout(fallback);
      delete globals[onLoadName];
      delete globals[onFailName];
      // 같은 광고 단위를 다음 판에 다시 쓰려면 SDK 목록에서 빼야 한다.
      // 요소로 넘기면 SDK 가 ads[0].container.element 와 비교해 찾는데, 광고가 안 채워진
      // 경우엔 ads[0] 자체가 없어 매칭에 실패하고 아무것도 지우지 않는다. 그러면 등록이
      // 쌓이고(유일해야 함·페이지당 4개), 700ms 루프가 이미 떼어낸 요소를 계속 건드린다.
      // 단위 id(문자열)로 넘기면 목록에서 바로 지운다 — 이쪽을 먼저.
      const api = sdk();
      try {
        api?.destroy?.(unit);
        api?.destroy?.(ins);
      } catch {
        /* SDK 미초기화(도메인 미승인·차단 등) — 무시 */
      }
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
