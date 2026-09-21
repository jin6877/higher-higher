// 문서 메타를 dist/meta.json 으로 내보낸다. (npm run build 끝에 실행)
//
// 서버 컨테이너에는 게임 소스가 아니라 dist 만 들어가므로(Dockerfile), 서버가 언어별
// og/title 을 갈아끼우려면 값을 파일로 건네받아야 한다. 이 한 줄짜리 단계가 없으면
// 서버 쪽에 같은 문자열을 한 벌 더 적어 두게 되고, 나중에 문구를 고칠 때 한쪽만 바뀐다.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { META } from "../src/meta";

const out = join("dist", "meta.json");
writeFileSync(out, JSON.stringify(META, null, 2) + "\n", "utf8");
console.log(`meta → ${out} (${Object.keys(META).join(", ")})`);
