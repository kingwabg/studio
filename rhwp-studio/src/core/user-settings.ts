/**
 * 사용자 환경설정 저장/로드 서비스
 *
 * localStorage 기반, 단일 키(rhwp-settings)에 JSON으로 저장.
 * 섹션별 확장 가능한 구조.
 */

/** 대표 글꼴 세트 (7개 언어별 글꼴) */
export interface FontSet {
  name: string;
  korean: string;
  english: string;
  chinese: string;
  japanese: string;
  other: string;
  symbol: string;
  user: string;
}

/** 글꼴 환경 설정 */
export interface FontSettings {
  /** 사용자 정의 대표 글꼴 세트 */
  fontSets: FontSet[];
  /** 최근 사용 글꼴 표시 여부 */
  showRecentFonts: boolean;
  /** 최근 사용 글꼴 표시 개수 (1~5) */
  recentFontCount: number;
}

/** 앱 UI 테마 설정값 */
export type ThemeMode = 'system' | 'light' | 'dark';

/** 앱 UI 테마 설정 */
export interface ThemeSettings {
  /** 사용자가 선택한 테마 모드 */
  mode: ThemeMode;
}

/** 대화상자 UI 설정 */
export interface DialogSettings {
  /** 개체 속성 기본 탭에서 너비/높이 입력 비율을 유지할지 여부 */
  picturePropsKeepRatio: boolean;
}

/**
 * 줄자 모양 (디자인 "rhwp 줄자 재설계", 2026-08-03).
 * 한글 줄자는 눈금이 빽빽한데 정작 알고 싶은 건 셋뿐이다 — 글이 어디서 시작하고,
 * 어디서 끝나고, 커서가 어느 칸인가. 아래 셋은 그걸 먼저 말하고 눈금을 뒤로 물린다.
 * - `classic` : 지금까지 쓰던 회색 눈금자 (mm 눈금 + 들여쓰기 마커)
 * - `map`     : 여백 지도 — 본문 폭은 띠, 여백은 빈 종이. 숫자는 커서 자리만
 * - `cross`   : 십자 조준 — 두 줄자에서 뻗은 선이 커서에서 만난다(인쇄 돔보)
 * - `quiet`   : 부를 때만 — 평소엔 실 한 줄, 가까이 가면 눈금이 피어난다
 */
export type RulerStyle = 'classic' | 'map' | 'cross' | 'quiet';

/** 보기 표시 설정 */
export interface ViewSettings {
  /** 문단부호 표시 여부 */
  showParagraphMarks: boolean;
  /** 조판부호 표시 여부 */
  showControlCodes: boolean;
  /** 줄자 모양 — 없으면 classic(지금까지 쓰던 것) */
  rulerStyle?: RulerStyle;
}

/** 복구용 자동저장 설정 */
export interface AutosaveSettings {
  /** 복구용 자동저장 사용 여부 */
  recoveryEnabled: boolean;
  /** 복구용 자동저장 간격(분) */
  recoveryIntervalMinutes: number;
  /** 입력이 멈췄을 때 자동저장 사용 여부 */
  idleSaveEnabled: boolean;
  /** 입력이 멈춘 뒤 자동저장까지 기다릴 시간(초) */
  idleDelaySeconds: number;
}

/** 상용구(자주 쓰는 문구) — 한컴 [입력-상용구] 대응. 평문만 저장한다(서식 포함은 v2). */
export interface Snippet {
  /** 목록에 보이는 이름 */
  name: string;
  /** 준말 — 본문에 치고 확장 단축키를 누르면 이 조각으로 바뀐다(빈 값 허용) */
  abbrev: string;
  /** 본문 (줄바꿈 포함) */
  text: string;
}

/** 전체 설정 구조 */
export interface AppSettings {
  version: number;
  font: FontSettings;
  theme: ThemeSettings;
  dialog: DialogSettings;
  view: ViewSettings;
  autosave: AutosaveSettings;
  /** 상용구 목록 */
  snippets: Snippet[];
}

/** 언어 인덱스 상수 (HWP 7개 언어) */
export const LANG = {
  KOREAN: 0,
  ENGLISH: 1,
  CHINESE: 2,
  JAPANESE: 3,
  OTHER: 4,
  SYMBOL: 5,
  USER: 6,
} as const;

/** 언어 인덱스 → 한국어 라벨 */
export const LANG_LABELS = ['한글', '영문', '한자', '일어', '외국어', '기호', '사용자'] as const;

/** 언어 인덱스 → FontSet 키 매핑 */
const LANG_KEYS: (keyof Omit<FontSet, 'name'>)[] = [
  'korean', 'english', 'chinese', 'japanese', 'other', 'symbol', 'user',
];

/** 내장 기본 대표 글꼴 (편집/삭제 불가) */
export const BUILTIN_FONT_SETS: readonly FontSet[] = [
  {
    name: '함초롬',
    korean: '함초롬바탕', english: '함초롬바탕', chinese: '함초롬바탕',
    japanese: '함초롬바탕', other: '함초롬바탕', symbol: '함초롬바탕', user: '함초롬바탕',
  },
  {
    name: '함초롬돋움',
    korean: '함초롬돋움', english: '함초롬돋움', chinese: '함초롬돋움',
    japanese: '함초롬돋움', other: '함초롬돋움', symbol: '함초롬돋움', user: '함초롬돋움',
  },
  {
    name: '맑은 고딕',
    korean: '맑은 고딕', english: '맑은 고딕', chinese: '맑은 고딕',
    japanese: '맑은 고딕', other: '맑은 고딕', symbol: '맑은 고딕', user: '맑은 고딕',
  },
  {
    name: '바탕',
    korean: '바탕', english: '바탕', chinese: '바탕',
    japanese: '바탕', other: '바탕', symbol: '바탕', user: '바탕',
  },
];

const STORAGE_KEY = 'rhwp-settings';

function defaultSettings(): AppSettings {
  return {
    version: 1,
    font: {
      fontSets: [],
      showRecentFonts: true,
      recentFontCount: 3,
    },
    theme: {
      mode: 'system',
    },
    dialog: {
      picturePropsKeepRatio: true,
    },
    view: {
      showParagraphMarks: false,
      showControlCodes: false,
    },
    autosave: {
      recoveryEnabled: true,
      recoveryIntervalMinutes: 10,
      idleSaveEnabled: true,
      idleDelaySeconds: 10,
    },
    snippets: [],
  };
}

function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/** 사용자 환경설정 서비스 (싱글턴) */
class UserSettingsService {
  private data: AppSettings;

  constructor() {
    this.data = this.load();
  }

  private load(): AppSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultSettings();
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      // 기본값 병합
      const defaults = defaultSettings();
      const dialog: Partial<DialogSettings> = parsed.dialog ?? {};
      const view: Partial<ViewSettings> = parsed.view ?? {};
      const autosave: Partial<AutosaveSettings> = parsed.autosave ?? {};
      return {
        version: parsed.version ?? defaults.version,
        font: {
          ...defaults.font,
          ...(parsed.font ?? {}),
        },
        theme: {
          ...defaults.theme,
          ...(parsed.theme ?? {}),
          mode: normalizeThemeMode(parsed.theme?.mode),
        },
        dialog: {
          ...defaults.dialog,
          ...dialog,
          picturePropsKeepRatio: normalizeBoolean(
            dialog.picturePropsKeepRatio,
            defaults.dialog.picturePropsKeepRatio,
          ),
        },
        view: {
          ...defaults.view,
          ...view,
          showParagraphMarks: normalizeBoolean(
            view.showParagraphMarks,
            defaults.view.showParagraphMarks,
          ),
          showControlCodes: normalizeBoolean(
            view.showControlCodes,
            defaults.view.showControlCodes,
          ),
        },
        snippets: Array.isArray(parsed.snippets) ? parsed.snippets.filter(
          (x): x is Snippet => !!x && typeof x.name === 'string' && typeof x.text === 'string',
        ) : defaults.snippets,
        autosave: {
          ...defaults.autosave,
          ...autosave,
          recoveryEnabled: normalizeBoolean(
            autosave.recoveryEnabled,
            defaults.autosave.recoveryEnabled,
          ),
          recoveryIntervalMinutes: normalizeNumber(
            autosave.recoveryIntervalMinutes,
            defaults.autosave.recoveryIntervalMinutes,
            1,
            120,
          ),
          idleSaveEnabled: normalizeBoolean(
            autosave.idleSaveEnabled,
            defaults.autosave.idleSaveEnabled,
          ),
          idleDelaySeconds: normalizeNumber(
            autosave.idleDelaySeconds,
            defaults.autosave.idleDelaySeconds,
            5,
            600,
          ),
        },
      };
    } catch {
      return defaultSettings();
    }
  }

  save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  }

  /** 전체 설정 반환 */
  getAll(): AppSettings {
    return this.data;
  }

  /** 글꼴 설정 반환 */
  getFontSettings(): FontSettings {
    return this.data.font;
  }

  /** 글꼴 설정 업데이트 */
  updateFontSettings(partial: Partial<FontSettings>): void {
    Object.assign(this.data.font, partial);
    this.save();
  }

  /** 테마 설정 반환 */
  getThemeSettings(): ThemeSettings {
    return this.data.theme;
  }

  /** 테마 모드 설정 */
  setThemeMode(mode: ThemeMode): void {
    this.data.theme.mode = normalizeThemeMode(mode);
    this.save();
  }

  /** 대화상자 UI 설정 반환 */
  getDialogSettings(): DialogSettings {
    return this.data.dialog;
  }

  /** 개체 속성 기본 탭 비율 유지 설정 반환 */
  getPicturePropsKeepRatio(): boolean {
    return this.data.dialog.picturePropsKeepRatio;
  }

  /** 개체 속성 기본 탭 비율 유지 설정 */
  setPicturePropsKeepRatio(value: boolean): void {
    this.data.dialog.picturePropsKeepRatio = value;
    this.save();
  }

  /** 보기 표시 설정 반환 */
  getViewSettings(): ViewSettings {
    return this.data.view;
  }

  /** 문단부호 표시 설정 */
  setShowParagraphMarks(value: boolean): void {
    this.data.view.showParagraphMarks = value;
    this.save();
  }

  /** 조판부호 표시 설정 */
  setShowControlCodes(value: boolean): void {
    this.data.view.showControlCodes = value;
    this.save();
  }

  /** 줄자 모양 — 없으면 classic */
  getRulerStyle(): RulerStyle {
    return this.data.view.rulerStyle ?? 'classic';
  }

  setRulerStyle(value: RulerStyle): void {
    this.data.view.rulerStyle = value;
    this.save();
  }

  /** 복구용 자동저장 설정 반환 */
  /** 상용구 목록(사본) */
  getSnippets(): Snippet[] {
    return this.data.snippets.map((s) => ({ ...s }));
  }

  /** 상용구 추가 — 같은 이름이 있으면 덮어쓴다(한컴도 같은 이름은 갱신) */
  addSnippet(snippet: Snippet): void {
    const i = this.data.snippets.findIndex((s) => s.name === snippet.name);
    if (i >= 0) this.data.snippets[i] = { ...snippet };
    else this.data.snippets.push({ ...snippet });
    this.save();
  }

  removeSnippet(name: string): boolean {
    const i = this.data.snippets.findIndex((s) => s.name === name);
    if (i < 0) return false;
    this.data.snippets.splice(i, 1);
    this.save();
    return true;
  }

  /** 준말로 상용구 찾기(확장용) */
  findSnippetByAbbrev(abbrev: string): Snippet | null {
    if (!abbrev) return null;
    return this.data.snippets.find((s) => s.abbrev === abbrev) ?? null;
  }

  getAutosaveSettings(): AutosaveSettings {
    return this.data.autosave;
  }

  /** 복구용 자동저장 설정 */
  updateAutosaveSettings(partial: Partial<AutosaveSettings>): void {
    this.data.autosave = {
      ...this.data.autosave,
      ...partial,
      recoveryEnabled: normalizeBoolean(
        partial.recoveryEnabled,
        this.data.autosave.recoveryEnabled,
      ),
      recoveryIntervalMinutes: normalizeNumber(
        partial.recoveryIntervalMinutes,
        this.data.autosave.recoveryIntervalMinutes,
        1,
        120,
      ),
      idleSaveEnabled: normalizeBoolean(
        partial.idleSaveEnabled,
        this.data.autosave.idleSaveEnabled,
      ),
      idleDelaySeconds: normalizeNumber(
        partial.idleDelaySeconds,
        this.data.autosave.idleDelaySeconds,
        5,
        600,
      ),
    };
    this.save();
  }

  /** 모든 대표 글꼴 세트 반환 (내장 + 사용자) */
  getAllFontSets(): FontSet[] {
    return [...BUILTIN_FONT_SETS, ...this.data.font.fontSets];
  }

  /** 사용자 정의 대표 글꼴 세트만 반환 */
  getUserFontSets(): FontSet[] {
    return this.data.font.fontSets;
  }

  /** 대표 글꼴 세트 추가 */
  addFontSet(fs: FontSet): boolean {
    const allNames = this.getAllFontSets().map(s => s.name);
    if (allNames.includes(fs.name)) return false; // 중복 이름 불가
    this.data.font.fontSets.push(fs);
    this.save();
    return true;
  }

  /** 대표 글꼴 세트 수정 (사용자 정의만) */
  updateFontSet(index: number, fs: FontSet): boolean {
    if (index < 0 || index >= this.data.font.fontSets.length) return false;
    this.data.font.fontSets[index] = fs;
    this.save();
    return true;
  }

  /** 대표 글꼴 세트 삭제 (사용자 정의만) */
  removeFontSet(index: number): boolean {
    if (index < 0 || index >= this.data.font.fontSets.length) return false;
    this.data.font.fontSets.splice(index, 1);
    this.save();
    return true;
  }

  /** FontSet의 언어 인덱스로 글꼴 이름 조회 */
  static getFontByLang(fs: FontSet, langIndex: number): string {
    return fs[LANG_KEYS[langIndex] ?? 'korean'] ?? fs.korean;
  }

  /** FontSet에 언어 인덱스로 글꼴 이름 설정 */
  static setFontByLang(fs: FontSet, langIndex: number, fontName: string): void {
    const key = LANG_KEYS[langIndex];
    if (key) (fs as any)[key] = fontName;
  }
}

/** 싱글턴 인스턴스 */
export const userSettings = new UserSettingsService();
