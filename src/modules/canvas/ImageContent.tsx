// ImageContent.tsx — 캔버스 이미지 블록 (CanvasBlock에서 분할 — 계획 3단계).
// src = 자산 저장소(IndexedDB) id. placeholder 더블클릭→파일 선택, 원본 비율 h 보정.
import { useEffect, useState } from "react";
import { type Block } from "../document/model";
import { useCanvasStore } from "./store";
import { getAssetUrl, putAsset } from "../document/assets";
import { IcImage } from "../../ui/icons";
// ── 이미지 블록 ──
// src = 자산 저장소(IndexedDB) id. 없으면 placeholder(더블클릭→파일 선택),
// 있으면 objectURL <img>. 원본 비율은 선택 시 h를 폭에 맞춰 보정한다.
function imageDims(file: Blob): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export function ImageContent({ block, locked }: { block: Block; locked: boolean }) {
  const updateBlock = useCanvasStore((s) => s.updateBlock);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (block.src) {
      void getAssetUrl(block.src).then((u) => {
        if (alive) setUrl(u);
      });
    } else {
      setUrl(null);
    }
    return () => {
      alive = false;
    };
  }, [block.src]);

  const pick = () => {
    if (locked) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/bmp";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const [id, dim] = await Promise.all([putAsset(f), imageDims(f)]);
      // 폭 유지 + 원본 비율로 높이 보정 — 지면 아래로 넘치지 않게 상한
      const cur = useCanvasStore.getState().doc.blocks.find((b) => b.id === block.id);
      if (!cur) return;
      const h = dim ? Math.max(8, Math.min(200, Math.round(cur.w * (dim.h / dim.w)))) : cur.h;
      updateBlock(block.id, { src: id, h });
    };
    input.click();
  };

  if (!block.src || !url)
    return (
      <button
        onDoubleClick={(e) => {
          e.stopPropagation();
          pick();
        }}
        onPointerDown={(e) => {
          // 선택은 상위(블록)가 처리 — 더블클릭만 여기서
          void e;
        }}
        className="w-full h-full flex flex-col items-center justify-center gap-1 bg-paper text-inkfaint text-[11px] cursor-pointer"
        title="더블클릭으로 이미지 선택"
      >
        <IcImage size={18} />
        더블클릭으로 이미지 선택
      </button>
    );

  return (
    <img
      src={url}
      alt=""
      draggable={false}
      onDoubleClick={(e) => {
        e.stopPropagation();
        pick(); // 재선택(교체)
      }}
      className="w-full h-full select-none"
      style={{ objectFit: "fill", borderRadius: block.radius ?? 0 }}
      title="더블클릭으로 이미지 교체"
    />
  );
}


