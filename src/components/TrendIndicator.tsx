interface TrendIndicatorProps {
  pct: number | null | undefined;
  comparisonLabel?: string;
  positiveIsGood?: boolean;
  suffix?: string;
  neutralWhenNull?: string;
  compact?: boolean;
}

export function TrendIndicator({
  pct,
  comparisonLabel = 'من الشهر الماضي',
  positiveIsGood = true,
  suffix = '%',
  neutralWhenNull,
  compact = false,
}: TrendIndicatorProps) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) {
    if (!neutralWhenNull) return null;
    return (
      <span
        className={`inline-flex items-center gap-1.5 font-mono tabular-nums text-slate-500 dark:text-slate-400 ${
          compact ? 'text-[10px]' : 'text-[11px]'
        }`}
      >
        <span>—</span>
        <span className="font-sans font-normal">{neutralWhenNull}</span>
      </span>
    );
  }

  const isFlat = Math.abs(pct) < 0.05;
  const isUp = pct > 0;
  const absVal = Math.abs(pct).toFixed(1);
  const arrow = isFlat ? '—' : isUp ? '↑' : '↓';
  const displaySuffix = suffix === 'pp' ? ' ن.م' : suffix;

  let colorClass = 'text-slate-500 dark:text-slate-400';
  if (!isFlat) {
    const isFavorable = positiveIsGood ? isUp : !isUp;
    colorClass = isFavorable
      ? 'text-emerald-700 dark:text-emerald-400'
      : 'text-rose-700 dark:text-rose-400';
  }

  return (
    <span
      className={`inline-flex flex-wrap items-center gap-1.5 font-mono font-medium tabular-nums ${
        compact ? 'text-[10px]' : 'text-[11px]'
      } ${colorClass}`}
    >
      <span className="dir-ltr inline-flex items-center gap-0.5">
        <span>{arrow}</span>
        <span>
          {absVal}
          {displaySuffix}
        </span>
      </span>
      {comparisonLabel && (
        <span className="font-sans font-normal text-slate-500 dark:text-slate-400">
          {comparisonLabel}
        </span>
      )}
    </span>
  );
}
