import { useState } from 'react';

export interface MatrixPoint {
  label: string;
  value: number;
  secondary?: number;
}

interface DottedMatrixChartProps {
  points: MatrixPoint[];
  accentColor?: 'gold' | 'emerald' | 'sky';
}

export function DottedMatrixChart({ points, accentColor = 'gold' }: DottedMatrixChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const sliced = points.slice(-24);
  if (sliced.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center text-xs text-slate-500">
        لا توجد نقاط زمنية متاحة
      </div>
    );
  }

  const maxVal = Math.max(1, ...sliced.map((p) => p.value));
  const rows = 8;
  const active = hoverIdx !== null ? sliced[hoverIdx] : null;

  const activeDotClass =
    accentColor === 'emerald'
      ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.45)]'
      : accentColor === 'sky'
        ? 'bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.45)]'
        : 'bg-[#d9be8b] shadow-[0_0_6px_rgba(217,190,139,0.45)]';

  return (
    <div dir="rtl" className="space-y-1.5">
      <div
        dir="rtl"
        className="flex h-20 items-end justify-between gap-[3px]"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {sliced.map((pt, colIdx) => {
          const filledRows = pt.value === 0 ? 0 : Math.max(1, Math.round((pt.value / maxVal) * rows));
          const isHovered = hoverIdx === colIdx;
          return (
            <div
              key={`${pt.label}-${colIdx}`}
              onMouseEnter={() => setHoverIdx(colIdx)}
              className="flex flex-1 cursor-crosshair flex-col-reverse items-center gap-[3px]"
              title={`${pt.label}: ${pt.value.toLocaleString('en-US')}`}
            >
              {Array.from({ length: rows }).map((_, rowIdx) => {
                const isLit = rowIdx < filledRows;
                return (
                  <span
                    key={rowIdx}
                    className={`h-[4px] w-[4px] rounded-full transition-opacity duration-150 ${
                      isLit
                        ? isHovered
                          ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]'
                          : activeDotClass
                        : 'bg-white/10'
                    }`}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      <div dir="rtl" className="flex items-center justify-between font-mono text-[10px] text-slate-400 tabular-nums">
        <span>
          {active ? (
            <>
              <span className="dir-ltr inline-block">{active.label}</span> · {active.value.toLocaleString('en-US')} سجل
            </>
          ) : (
            <span className="dir-ltr inline-block">{sliced[0]?.label}</span>
          )}
        </span>
        <span>
          {active ? 'فترة محددة' : <span className="dir-ltr inline-block">{sliced[sliced.length - 1]?.label}</span>}
        </span>
      </div>
    </div>
  );
}
