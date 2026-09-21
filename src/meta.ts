/**
 * 문서 메타(제목·설명·og) 두 벌.
 *
 * i18n.ts 와 분리해 둔 이유: 이 값들은 브라우저 밖에서도 필요하다. 카카오톡·트위터·
 * 검색 크롤러는 JS 를 돌리지 않아서, 클라이언트에서 document.title 을 바꿔 봐야
 * 미리보기에는 반영되지 않는다. 서버가 index.html 을 내려줄 때 갈아끼워야 한다.
 *
 * 그래서 이 파일은 window/navigator 를 건드리지 않는 순수 데이터로 둔다.
 *  - 게임(i18n.ts)   : import 해서 document.title 등에 반영
 *  - 빌드(scripts/emit-meta.ts): dist/meta.json 으로 내보냄
 *  - 서버(server/)   : 그 meta.json 을 읽어 index.html 을 치환
 * 서버 컨테이너에는 dist 만 들어가므로(Dockerfile) 파일을 거쳐 건네는 수밖에 없다.
 */
export type MetaLang = "ko" | "en";

export interface DocMeta {
  /** <html lang> */
  lang: string;
  /** og:locale */
  locale: string;
  /** <title> · og:title · twitter:title */
  title: string;
  /** <meta name="description"> */
  desc: string;
  /** og:description · twitter:description — 본문 설명보다 짧게 */
  ogDesc: string;
}

export const META: Record<MetaLang, DocMeta> = {
  ko: {
    lang: "ko",
    locale: "ko_KR",
    title: "높이 높이 · Higher Higher",
    desc: "무너지기 전까지, 더 높이. 랜덤 블록을 물리로 쌓아 최고 높이에 도전하는 밸런스 게임.",
    ogDesc: "무너지기 전까지, 더 높이 — 랜덤 블록을 물리로 쌓아 올리는 밸런스 게임.",
  },
  en: {
    lang: "en",
    locale: "en_US",
    title: "Higher Higher · Stack the blocks",
    desc: "Stack until it falls. A physics balance game — drop random blocks and push your tower as high as it goes.",
    ogDesc: "Stack until it falls — a physics balance game about stacking random blocks.",
  },
};
