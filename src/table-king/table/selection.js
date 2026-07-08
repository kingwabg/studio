export const makeKey = (row, col) => `${row}-${col}`;

export const cloneGrid = (grid) => grid.map((row) => [...row]);

export const rectFromSelection = (selection) => {
  if (!selection) return null;
  return {
    r1: Math.min(selection.anchorRow, selection.focusRow),
    c1: Math.min(selection.anchorCol, selection.focusCol),
    r2: Math.max(selection.anchorRow, selection.focusRow),
    c2: Math.max(selection.anchorCol, selection.focusCol),
  };
};

export const rectsOverlap = (a, b) =>
  a.r1 <= b.r2 && a.r2 >= b.r1 && a.c1 <= b.c2 && a.c2 >= b.c1;

export const mergeToRect = (merge) => ({
  r1: merge.r,
  c1: merge.c,
  r2: merge.r + merge.rs - 1,
  c2: merge.c + merge.cs - 1,
});

export const expandRectForMerges = (rect, mergeList) => {
  if (!rect) return null;

  let next = { ...rect };
  let changed = true;

  while (changed) {
    changed = false;

    mergeList.forEach((merge) => {
      const mergeRect = mergeToRect(merge);
      if (!rectsOverlap(mergeRect, next)) return;

      const expanded = {
        r1: Math.min(next.r1, mergeRect.r1),
        c1: Math.min(next.c1, mergeRect.c1),
        r2: Math.max(next.r2, mergeRect.r2),
        c2: Math.max(next.c2, mergeRect.c2),
      };

      if (
        expanded.r1 !== next.r1 ||
        expanded.c1 !== next.c1 ||
        expanded.r2 !== next.r2 ||
        expanded.c2 !== next.c2
      ) {
        next = expanded;
        changed = true;
      }
    });
  }

  return next;
};
