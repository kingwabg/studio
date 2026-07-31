/**
 * 환경 설정의 「AI」 탭 — 모델을 고르고 API 키를 넣는다.
 * (사용자 요청 2026-08-01: 도구 → 환경 설정 안에서 AI 를 고르고 키를 넣게)
 *
 * ⚠ 키는 이 화면에 **저장되지 않는다.** 서버(sc-)로 보내면 서버가 암호화해 보관하고
 *   다시는 내려주지 않는다. 그래서 입력칸은 늘 빈 칸에서 시작한다 — 저장된 키를
 *   되불러와 보여주면 어깨너머로도 새고 화면 캡처에도 남는다.
 *
 * ⚠ 단독 실행(호스트 없음)에서는 `/api/ai-providers` 가 없다. 그때는 조용히
 *   "호스트가 없어 설정할 수 없다"만 보여주고 편집기는 정상 동작한다.
 */
import { NVIDIA_MODELS, NVIDIA_BASE_URL } from './ai-models';

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  keyEnv: string;
  isDefault: boolean;
  enabled: boolean;
  hasKey: boolean;
  keySource: 'stored' | 'env' | 'none';
  canStoreKey: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

/** 환경 설정 안에 들어갈 AI 패널을 만든다. 로딩은 비동기로 채운다. */
export function createAiPanel(): HTMLElement {
  const panel = el('div', 'opt-ai');
  const status = el('div', 'opt-ai-status', '불러오는 중…');
  panel.appendChild(status);
  void fill(panel, status);
  return panel;
}

async function fill(panel: HTMLElement, status: HTMLElement): Promise<void> {
  let list: Provider[] = [];
  try {
    const res = await fetch('/api/ai-providers');
    if (!res.ok) throw new Error(String(res.status));
    list = ((await res.json()) as { providers?: Provider[] }).providers ?? [];
  } catch {
    status.textContent =
      '이 편집기를 단독으로 열어서 AI 설정을 불러올 수 없습니다. Office 안에서 열어 주세요.';
    return;
  }
  const active = list.find((p) => p.isDefault && p.enabled) ?? list.find((p) => p.enabled) ?? list[0];
  if (!active) {
    status.textContent = 'AI 공급자가 없습니다. Office 의 설정 → AI 공급자에서 먼저 만들어 주세요.';
    return;
  }
  status.remove();

  // ── 모델 고르기 ──
  const sec1 = el('div', 'dialog-section');
  sec1.appendChild(el('div', 'dialog-section-title', '모델'));
  const sel = el('select', 'opt-ai-model');
  for (const m of NVIDIA_MODELS) {
    const o = el('option');
    o.value = m.id;
    o.textContent = `${m.label} — ${m.hint}`;
    o.selected = m.id === active.model;
    sel.appendChild(o);
  }
  // 목록에 없는 모델(직접 입력한 것)도 고른 상태를 유지한다
  if (!NVIDIA_MODELS.some((m) => m.id === active.model)) {
    const o = el('option');
    o.value = active.model;
    o.textContent = `${active.model} (직접 지정)`;
    o.selected = true;
    sel.appendChild(o);
  }
  sec1.appendChild(sel);
  sec1.appendChild(el('div', 'opt-ai-hint',
    'NVIDIA NIM 무료 크레딧으로 씁니다. 가벼운 모델일수록 크레딧이 오래 갑니다.'));
  panel.appendChild(sec1);

  // ── API 키 ──
  const sec2 = el('div', 'dialog-section');
  sec2.appendChild(el('div', 'dialog-section-title', 'API 키'));
  const state = el('div', 'opt-ai-keystate');
  const paintState = (p: Provider) => {
    state.textContent =
      p.keySource === 'stored' ? '키가 저장돼 있습니다(암호화). 바꾸려면 새 키를 넣고 저장하세요.'
      : p.keySource === 'env' ? `서버 환경변수 ${p.keyEnv} 의 키를 쓰고 있습니다.`
      : '키가 없습니다. 아래에 넣어 주세요.';
    state.classList.toggle('is-ok', p.hasKey);
  };
  paintState(active);
  sec2.appendChild(state);

  const keyInput = el('input', 'opt-ai-key') as HTMLInputElement;
  keyInput.type = 'password';
  keyInput.autocomplete = 'off';
  keyInput.placeholder = active.canStoreKey
    ? 'nvapi-… (build.nvidia.com 에서 발급)'
    : '서버에 AI_KEY_SECRET 이 없어 저장할 수 없습니다';
  keyInput.disabled = !active.canStoreKey;
  sec2.appendChild(keyInput);
  if (!active.canStoreKey) {
    sec2.appendChild(el('div', 'opt-ai-hint',
      '키를 이 화면에서 저장하려면 서버 .env.local 에 AI_KEY_SECRET(16자 이상)을 한 번 설정해야 합니다. 이 값으로 키를 암호화해 보관합니다.'));
  }

  const row = el('div', 'opt-ai-row');
  const saveBtn = el('button', 'dialog-btn dialog-btn-primary', '저장') as HTMLButtonElement;
  const msg = el('span', 'opt-ai-msg');
  row.append(saveBtn, msg);
  sec2.appendChild(row);
  panel.appendChild(sec2);

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    msg.textContent = '저장 중…';
    msg.classList.remove('is-error');
    const body: Record<string, unknown> = { model: sel.value, baseUrl: NVIDIA_BASE_URL };
    // 빈 칸이면 기존 키를 건드리지 않는다 — 모델만 바꿀 때 키가 지워지면 안 된다.
    if (keyInput.value) body.apiKey = keyInput.value;
    try {
      const res = await fetch(`/api/ai-providers/${active.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? String(res.status));
      keyInput.value = '';
      msg.textContent = '저장했습니다';
      // 저장 뒤 상태를 다시 읽는다(키 출처가 바뀌었을 수 있다)
      const fresh = await fetch('/api/ai-providers').then((r) => r.json()) as { providers?: Provider[] };
      const p = fresh.providers?.find((x) => x.id === active.id);
      if (p) paintState(p);
    } catch (err) {
      msg.textContent = String(err).replace(/^Error:\s*/, '');
      msg.classList.add('is-error');
    } finally {
      saveBtn.disabled = false;
    }
  });
}
