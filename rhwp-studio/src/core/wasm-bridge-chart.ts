/** [차트 2026-08-13] 차트 wasm 래퍼 — wasm-bridge.ts 가 이미 파일 크기 래칫 상한이라 분리.
 *
 * 엔진은 차트를 표준 OOXML(`c:chartSpace`) XML 로 만들어 HWPX 의 `Chart/chart{N}.xml`
 * 파트에 넣는다. 스튜디오는 데이터(JSON)만 주고받는다 — XML 은 엔진 담당.
 */

/** 차트 한 계열 */
export interface ChartSeries {
  name: string;
  values: number[];
}

/** 차트 데이터 — 삽입·편집 대화상자가 다루는 전부 */
export interface ChartSpec {
  /** 갤러리에서 고른 세부 종류(예: 'column-stacked'). 엔진이 이 id 로 한컴 템플릿을 고른다. */
  style: string;
  type: 'column' | 'bar' | 'line' | 'pie';
  title: string;
  categories: string[];
  series: ChartSeries[];
}

/** 엔진 문서 핸들(wasm HwpDocument)만 있으면 되는 최소 인터페이스 */
interface ChartCapableDoc {
  insertChart(sec: number, para: number, specJson: string, w: number, h: number, tac: boolean): string;
  getChartSpec(sec: number, para: number, ctrl: number): string;
  setChartSpec(sec: number, para: number, ctrl: number, specJson: string): string;
}

function doc(bridge: unknown): ChartCapableDoc {
  const d = (bridge as { doc?: unknown }).doc;
  if (!d) throw new Error('문서가 로드되지 않았습니다');
  return d as ChartCapableDoc;
}

/** 차트를 삽입한다. width/height 는 HWPUNIT(0 이면 엔진 기본 크기). */
export function insertChart(
  bridge: unknown,
  sec: number,
  para: number,
  spec: ChartSpec,
  width = 0,
  height = 0,
  treatAsChar = false,
): { ok: boolean; paraIdx: number; controlIdx: number } {
  return JSON.parse(
    doc(bridge).insertChart(sec, para, JSON.stringify(spec), width, height, treatAsChar),
  );
}

/** 차트 개체의 데이터를 읽는다. 차트가 아니면 null. */
export function getChartSpec(
  bridge: unknown,
  sec: number,
  para: number,
  ctrl: number,
): ChartSpec | null {
  try {
    const v = JSON.parse(doc(bridge).getChartSpec(sec, para, ctrl));
    if (!v || v.ok !== true) return null;
    return {
      style: v.style ?? '',
      type: v.type,
      title: v.title ?? '',
      categories: v.categories ?? [],
      series: v.series ?? [],
    };
  } catch {
    return null; // 차트 아닌 개체 — 호출자가 타입 판별에 쓴다
  }
}

/** 차트 데이터를 교체한다 — 엔진이 기존 XML 을 패치하므로 서식이 보존된다. */
export function setChartSpec(
  bridge: unknown,
  sec: number,
  para: number,
  ctrl: number,
  spec: ChartSpec,
): boolean {
  const out = JSON.parse(doc(bridge).setChartSpec(sec, para, ctrl, JSON.stringify(spec)));
  return out?.ok === true;
}

/** 새 차트의 기본 데이터 — 한컴 '차트 만들기' 초기값과 같은 모양 */
export function defaultChartSpec(): ChartSpec {
  return {
    style: 'column',
    type: 'column',
    title: '',
    categories: ['항목 1', '항목 2', '항목 3', '항목 4'],
    series: [
      { name: '계열 1', values: [4.3, 2.5, 3.5, 4.5] },
      { name: '계열 2', values: [2.4, 4.4, 1.8, 2.8] },
    ],
  };
}
