import { useEffect, useRef, useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";

type ColorPopoverProps = {
  label: string;
  value?: string;
  onChange: (color: string) => void;
  presets?: string[];
  allowTransparent?: boolean;
  transparentLabel?: string;
  shape?: "circle" | "square";
  compact?: boolean;
  glyph?: string; // 설정 시 스와치 대신 글리프(예: "A") + 하단 색 막대 트리거 (디자인 글자색)
};

const FALLBACK_COLOR = "#ffffff";

const isTransparent = (value?: string) => !value || value === "transparent";
const normalizeColor = (value?: string) => (isTransparent(value) ? FALLBACK_COLOR : value!);

function TransparentMark() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-0 rounded-[inherit]"
      style={{ background: "linear-gradient(135deg, transparent 0 44%, #d64550 45% 55%, transparent 56% 100%)" }}
    />
  );
}

export function ColorPopover({
  label,
  value,
  onChange,
  presets = [],
  allowTransparent,
  transparentLabel = "없음",
  shape = "circle",
  compact,
  glyph,
}: ColorPopoverProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(normalizeColor(value));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const empty = isTransparent(value);
  const rounded = shape === "circle" ? "rounded-full" : "rounded-[6px]";

  useEffect(() => {
    if (!open) setDraft(normalizeColor(value));
  }, [open, value]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const applyColor = (color: string) => {
    setDraft(color);
    onChange(color);
  };

  return (
    <div ref={rootRef} className="studio-color-popover relative inline-flex items-center">
      {glyph ? (
        <button
          type="button"
          title={label}
          aria-label={label}
          className="flex h-8 w-8 flex-col items-center justify-center rounded-lg text-inksoft transition-colors hover:bg-paper hover:text-ink"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="text-[13px] font-black leading-none">{glyph}</span>
          <span className="mt-[3px] h-[3px] w-3.5 rounded-[1px]" style={{ background: empty ? "transparent" : value }} />
        </button>
      ) : (
        <button
          type="button"
          title={label}
          aria-label={label}
          className={`studio-color-popover-trigger relative flex items-center justify-center border border-line bg-surface transition-transform hover:scale-105 ${rounded} ${compact ? "h-5 w-5" : "h-[22px] w-[26px]"}`}
          style={{ boxShadow: "0 0 0 1px rgba(16,24,40,.08)", background: empty ? "var(--surface)" : value }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setOpen((current) => !current)}
        >
          {empty && <TransparentMark />}
          <span className={`relative ${shape === "circle" ? "h-2 w-2 rounded-full" : "h-2 w-3 rounded-[2px]"}`} style={{ background: empty ? "transparent" : value }} />
        </button>
      )}

      {open && (
        <div
          className="studio-color-popover-panel absolute left-0 top-[28px] z-[90] w-[218px] rounded-[14px] border border-line bg-surface p-3 text-ink"
          style={{ boxShadow: "var(--sh-pop)" }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-extrabold text-inksoft">{label}</span>
            {allowTransparent && (
              <button
                type="button"
                className="rounded-full border border-line px-2 py-0.5 text-[10.5px] font-bold text-inksoft hover:bg-paper hover:text-ink"
                onClick={() => {
                  onChange("transparent");
                  setOpen(false);
                }}
              >
                {transparentLabel}
              </button>
            )}
          </div>
          <HexColorPicker color={draft} onChange={applyColor} />
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] font-bold text-inkfaint">#</span>
            <HexColorInput
              color={draft}
              onChange={applyColor}
              prefixed={false}
              className="studio-color-input h-7 flex-1 rounded-lg border border-line bg-paper px-2 text-[12px] font-bold text-ink outline-none focus:border-accentline"
            />
          </div>
          {!!presets.length && (
            <div className="mt-2 grid grid-cols-8 gap-1.5">
              {presets.map((color) => (
                <button
                  key={color}
                  type="button"
                  title={color}
                  className={`h-5 w-5 border border-line transition-transform hover:scale-110 ${shape === "circle" ? "rounded-full" : "rounded-[5px]"}`}
                  style={{ background: color }}
                  onClick={() => applyColor(color)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

