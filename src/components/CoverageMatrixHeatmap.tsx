import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { CalendarDays, Grid3X3, Info, ShieldCheck } from 'lucide-react';
import type {
  CoverageDailyCell,
  CoverageHeatmapResponse,
  CoverageMonthlyCell,
} from '../types/aviation';
import { SYRIAN_CITY_SHORT_AR, translateCoverageClass } from '../i18n/ar';

interface CoverageMatrixHeatmapProps {
  selectedAirport?: string;
  onSelectDailyCell?: (cell: CoverageDailyCell) => void;
  onSelectMonthCell?: (cell: CoverageMonthlyCell) => void;
  compact?: boolean;
}

const AIRPORT_LABELS = SYRIAN_CITY_SHORT_AR;

// Lighter shades indicate gaps (0 records), darker green represents high data density
const GREEN_RAMP_STOPS = ['#edf7f1', '#b7e4c7', '#74c69d', '#40916c', '#1b5e3f', '#053b23'];

function getHeatmapCellStyle(
  count: number,
  maxVal: number,
  classification?: string
): { bg: string; text: string; border: string } {
  if (count <= 0) {
    if (classification === 'source_checked_no_records') {
      return {
        bg: '#d7ecde',
        text: '#1e3a2f',
        border: 'rgba(116, 198, 157, 0.45)',
      };
    }
    return {
      bg: '#eef7f1',
      text: '#334155',
      border: 'rgba(255, 255, 255, 0.14)',
    };
  }

  const ratio = Math.min(1, Math.sqrt(count) / Math.sqrt(Math.max(1, maxVal)));
  const interpolator = d3.interpolateRgbBasis(GREEN_RAMP_STOPS.slice(1));
  const bg = interpolator(ratio);
  const text = ratio >= 0.46 ? '#ecfdf5' : '#052e1b';
  const border = ratio >= 0.65 ? 'rgba(52, 211, 153, 0.45)' : 'rgba(16, 185, 129, 0.25)';
  return { bg, text, border };
}

interface HeatmapTooltipState {
  x: number;
  y: number;
  placeAbove: boolean;
  airportId: string;
  periodLabel: string;
  classificationLabel: string;
  verifiedCount: number;
  commercialCount: number;
  fidsCount: number;
  totalDisplayed: number;
  macro2024Ops?: number;
  footNote?: string;
}

export function CoverageMatrixHeatmap({
  selectedAirport = 'all',
  onSelectDailyCell,
  onSelectMonthCell,
  compact = false,
}: CoverageMatrixHeatmapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>('2026-10');
  const [includeFids, setIncludeFids] = useState<boolean>(true);
  const [show2024Macro, setShow2024Macro] = useState<boolean>(false);
  const [data, setData] = useState<CoverageHeatmapResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState<number>(0);
  const [pinnedDay, setPinnedDay] = useState<CoverageDailyCell | null>(null);
  const [tooltip, setTooltip] = useState<HeatmapTooltipState | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{
    title: string;
    detail: string;
    meta: string;
  } | null>(null);

  const openCellTooltip = useCallback(
    (
      targetEl: HTMLElement,
      payload: Omit<HeatmapTooltipState, 'x' | 'y' | 'placeAbove'>
    ) => {
      const rootRect = containerRef.current?.getBoundingClientRect();
      const cellRect = targetEl.getBoundingClientRect();
      if (!rootRect) return;

      const tooltipW = 240;
      const centerX = cellRect.left - rootRect.left + cellRect.width / 2;
      const clampedX = Math.max(
        12,
        Math.min(centerX - tooltipW / 2, rootRect.width - tooltipW - 12)
      );
      const cellTop = cellRect.top - rootRect.top;
      const cellBottom = cellRect.bottom - rootRect.top;
      const placeAbove = cellBottom + 176 > rootRect.height && cellTop > 176;

      setTooltip({
        x: clampedX,
        y: placeAbove ? cellTop - 8 : cellBottom + 8,
        placeAbove,
        ...payload,
      });
    },
    []
  );

  const clearHover = useCallback(() => {
    setHoverInfo(null);
    setTooltip(null);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch(`/api/coverage/heatmap?month=${encodeURIComponent(selectedMonth)}`)
      .then((r) => {
        if (!r.ok) throw new Error('تعذّر تحميل مصفوفة التغطية');
        return r.json();
      })
      .then((json: CoverageHeatmapResponse) => {
        if (!active) return;
        setData(json);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'تعذّر تحميل مصفوفة التغطية');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedMonth, reloadTick]);

  useEffect(() => {
    if (!data?.daily_cells?.length) {
      setPinnedDay(null);
      return;
    }
    const defaultCell =
      data.daily_cells.find(
        (c) =>
          (selectedAirport === 'all' || c.airport_id === selectedAirport) &&
          c.verified_movements_count > 0
      ) ||
      data.daily_cells.find(
        (c) =>
          (selectedAirport === 'all' || c.airport_id === selectedAirport) &&
          c.commercial_records_count + c.fids_records_count > 0
      ) ||
      data.daily_cells[0] ||
      null;
    setPinnedDay(defaultCell);
  }, [data, selectedAirport]);

  const airports = data?.airports ?? ['DAM', 'ALP', 'DEZ', 'LTK', 'KAC'];
  const months = data?.months ?? [];
  const dates = data?.dates ?? [];

  const monthlyLookup = useMemo(() => {
    const map = new Map<string, CoverageMonthlyCell>();
    for (const cell of data?.monthly_cells ?? []) {
      map.set(`${cell.airport_id}__${cell.year_month}`, cell);
    }
    return map;
  }, [data]);

  const dailyLookup = useMemo(() => {
    const map = new Map<string, CoverageDailyCell>();
    for (const cell of data?.daily_cells ?? []) {
      map.set(`${cell.airport_id}__${cell.flight_date}`, cell);
    }
    return map;
  }, [data]);

  const getMonthlyValue = (cell?: CoverageMonthlyCell): number => {
    if (!cell) return 0;
    let val = cell.direct_density_records;
    if (includeFids) val += cell.fids_records;
    if (show2024Macro && cell.sem_2024_macro_ops > 0 && val === 0) {
      val = cell.sem_2024_macro_ops;
    }
    return val;
  };

  const getDailyValue = (cell?: CoverageDailyCell): number => {
    if (!cell) return 0;
    return (
      cell.verified_movements_count +
      cell.commercial_records_count +
      (includeFids ? cell.fids_records_count : 0)
    );
  };

  const maxMonthlyVal = useMemo(() => {
    const vals = (data?.monthly_cells ?? []).map((c) => getMonthlyValue(c));
    return Math.max(100, ...vals);
  }, [data, includeFids, show2024Macro]);

  const maxDailyVal = useMemo(() => {
    const vals = (data?.daily_cells ?? []).map((c) => getDailyValue(c));
    return Math.max(40, ...vals);
  }, [data, includeFids]);

  const monthStats = useMemo(() => {
    const cells = data?.daily_cells ?? [];
    let gapCells = 0;
    let checkedEmpty = 0;
    let coveredCells = 0;
    let totalVolume = 0;

    for (const c of cells) {
      const vol = getDailyValue(c);
      totalVolume += vol;
      if (vol > 0) coveredCells += 1;
      else if (c.coverage_classification === 'source_checked_no_records') checkedEmpty += 1;
      else gapCells += 1;
    }
    return { gapCells, checkedEmpty, coveredCells, totalVolume, totalCells: cells.length };
  }, [data, includeFids]);

  return (
    <div
      dir="rtl"
      ref={containerRef}
      onMouseLeave={clearHover}
      className="relative flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#071112]/90 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:p-5"
    >
      {/* Header & Controls */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.08] pb-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Grid3X3 className="h-4 w-4 shrink-0 text-[#d9be8b]" />
            <h2 className="font-display text-sm font-semibold text-white sm:text-base">
              خريطة الكثافة الزمنية للتغطية (2024–2026)
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            يدل اللون الأخضر الزمردي الداكن على كثافة سجلات يومية أو شهرية أعلى؛ بينما تشير الدرجات الفاتحة إلى فجوات بيانات غير مستردة أو أيام خالية من السجلات.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIncludeFids((v) => !v)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              includeFids
                ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                : 'border-white/15 bg-white/[0.04] text-slate-400 hover:text-white'
            }`}
          >
            {includeFids ? 'شاشات FIDS المؤرشفة: مُضمّنة' : 'تضمين FIDS المؤرشفة'}
          </button>

          <button
            type="button"
            onClick={() => setShow2024Macro((v) => !v)}
            title="عرض التجميع الإقليمي الثلاثي لعام 2024 (DAM_ALP_LTK)"
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              show2024Macro
                ? 'border-[#d9be8b]/50 bg-[#d9be8b]/15 text-[#f0ddb2]'
                : 'border-white/15 bg-white/[0.04] text-slate-400 hover:text-white'
            }`}
          >
            {show2024Macro ? 'إجمالي 2024: ظاهر' : 'عرض إجمالي 2024 DAM_ALP_LTK'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-900/60 bg-red-950/35 px-3.5 py-2.5 text-xs text-red-300">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setReloadTick((t) => t + 1)}
            className="font-medium underline underline-offset-2 whitespace-nowrap shrink-0"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* Color Scale Legend + Hover Telemetry */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-[#0a1718]/80 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-slate-300">
          <span className="text-slate-400">فجوة</span>
          <div className="flex items-center gap-1">
            {GREEN_RAMP_STOPS.map((color, idx) => (
              <span
                key={color}
                title={
                  idx === 0
                    ? 'فجوة بيانات / 0 سجل (درجة فاتحة)'
                    : idx === GREEN_RAMP_STOPS.length - 1
                      ? 'أعلى كثافة بيانات (أخضر داكن)'
                      : `مستوى الكثافة ${idx}`
                }
                className="inline-block h-3.5 w-6 rounded-[3px] border border-white/15"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <span className="font-medium text-emerald-300">أعلى كثافة</span>
          <span className="hidden sm:inline text-slate-500">·</span>
          <span className="hidden sm:inline text-[10.5px] text-slate-400 tabular-nums">
            <span className="dir-ltr inline-block">
              {monthStats.coveredCells}/{monthStats.totalCells}
            </span>{' '}
            خلية نشطة في <span className="dir-ltr inline-block font-mono">{selectedMonth}</span>
          </span>
        </div>

        <div className="min-w-0 text-[11px] text-[#ebd8ab] truncate">
          {hoverInfo
            ? `${hoverInfo.title} · ${hoverInfo.detail}`
            : 'مرر المؤشر أو انقر على أي خلية لمعاينة مصدر البيانات'}
        </div>
      </div>

      {/* Section 1: 34-Month Airport × Month Density Matrix */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
            <CalendarDays className="h-3.5 w-3.5 text-[#d9be8b]" />
            <span>
              الخط الزمني الشامل (34 شهراً: من{' '}
              <span className="dir-ltr inline-block font-mono">{months[0] ?? '2024-01'}</span> إلى{' '}
              <span className="dir-ltr inline-block font-mono">
                {months[months.length - 1] ?? '2026-10'}
              </span>
              )
            </span>
          </div>
          <span className="text-[11px] text-slate-400">
            انقر على أي عمود شهر لعرض المصفوفة اليومية التفصيلية أدناه
          </span>
        </div>

        <div dir="rtl" className="overflow-x-auto pb-1">
          <div className="min-w-[680px] space-y-1">
            {/* Month tick header */}
            <div
              className="grid items-center gap-[3px]"
              style={{
                gridTemplateColumns: `72px repeat(${Math.max(1, months.length)}, minmax(0, 1fr))`,
              }}
            >
              <div className="text-start text-[10px] text-slate-500">المحطة</div>
              {months.map((ym) => {
                const [, mStr] = ym.split('-');
                const mNum = Number(mStr);
                const isSelectedM = ym === selectedMonth;
                const isYearStart = mStr === '01';
                return (
                  <button
                    key={ym}
                    type="button"
                    onClick={() => setSelectedMonth(ym)}
                    title={`معاينة التغطية اليومية لشهر ${ym}`}
                    className={`rounded-t py-0.5 text-center font-mono text-[9px] leading-none transition-colors ${
                      isSelectedM
                        ? 'bg-[#d9be8b]/25 font-bold text-[#f3e1b4]'
                        : isYearStart
                          ? 'font-semibold text-slate-200 hover:text-white'
                          : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {isYearStart ? ym.slice(2, 4) : mNum % 3 === 1 ? mStr : '·'}
                  </button>
                );
              })}
            </div>

            {/* Rows per airport */}
            {airports.map((ap) => {
              const isScoped = selectedAirport.toUpperCase() === ap;
              return (
                <div
                  key={ap}
                  className={`grid items-center gap-[3px] rounded-md px-0.5 py-[2px] ${
                    isScoped ? 'ring-1 ring-[#d9be8b]/40 bg-white/[0.03]' : ''
                  }`}
                  style={{
                    gridTemplateColumns: `72px repeat(${Math.max(1, months.length)}, minmax(0, 1fr))`,
                  }}
                >
                  <div className="flex flex-col leading-tight pe-1 text-start">
                    <span className="font-mono text-[11px] font-semibold text-white">{ap}</span>
                    {!compact && (
                      <span className="truncate text-[9.5px] text-slate-400">{AIRPORT_LABELS[ap]}</span>
                    )}
                  </div>

                  {months.map((ym) => {
                    const cell = monthlyLookup.get(`${ap}__${ym}`);
                    const val = getMonthlyValue(cell);
                    const isEmptyChecked = (cell?.checked_empty_days ?? 0) > 0 && val === 0;
                    const style = getHeatmapCellStyle(
                      val,
                      maxMonthlyVal,
                      isEmptyChecked ? 'source_checked_no_records' : undefined
                    );
                    const isSelectedM = ym === selectedMonth;
                    const isMacroOnly =
                      show2024Macro &&
                      (cell?.direct_density_records ?? 0) === 0 &&
                      (cell?.fids_records ?? 0) === 0 &&
                      (cell?.sem_2024_macro_ops ?? 0) > 0;

                    return (
                      <button
                        key={`${ap}-${ym}`}
                        type="button"
                        onClick={() => {
                          setSelectedMonth(ym);
                          if (cell) onSelectMonthCell?.(cell);
                        }}
                        onMouseEnter={(e) => {
                          if (!cell) return;
                          setHoverInfo({
                            title: `${ap} · ${ym}`,
                            detail:
                              val > 0
                                ? `${val.toLocaleString('en-US')} سجل (${cell.verified_records} موثق، ${cell.commercial_records} تجاري، ${cell.fids_records} FIDS)`
                                : isEmptyChecked
                                  ? 'مصدر مفحوص · 0 سجل'
                                  : 'فجوة بيانات · 0 سجل مسترد',
                            meta: isMacroOnly ? 'تجميع DAM_ALP_LTK الكلي' : 'سجلات المحطة المباشرة',
                          });
                          openCellTooltip(e.currentTarget, {
                            airportId: ap,
                            periodLabel: ym,
                            classificationLabel: isMacroOnly
                              ? `إجمالي DAM_ALP_LTK الكلي · ${cell.total_days} يوم`
                              : isEmptyChecked
                                ? `مصدر مفحوص (0 سجل) · ${cell.non_gap_days}/${cell.total_days} نشط`
                                : val > 0
                                  ? `${cell.non_gap_days}/${cell.total_days} يوم نشط في الشهر`
                                  : `فجوة بيانات · ${cell.total_days} يوم`,
                            verifiedCount: cell.verified_records,
                            commercialCount: cell.commercial_records,
                            fidsCount: cell.fids_records,
                            totalDisplayed: val,
                            macro2024Ops: cell.sem_2024_macro_ops,
                            footNote: !includeFids && cell.fids_records > 0
                              ? 'تم إخفاء FIDS عبر المفتاح'
                              : 'انقر لفتح الشبكة اليومية',
                          });
                        }}
                        onFocus={(e) => {
                          if (!cell) return;
                          openCellTooltip(e.currentTarget, {
                            airportId: ap,
                            periodLabel: ym,
                            classificationLabel: `${cell.non_gap_days}/${cell.total_days} يوم نشط`,
                            verifiedCount: cell.verified_records,
                            commercialCount: cell.commercial_records,
                            fidsCount: cell.fids_records,
                            totalDisplayed: val,
                            macro2024Ops: cell.sem_2024_macro_ops,
                          });
                        }}
                        onMouseLeave={clearHover}
                        onBlur={clearHover}
                        className={`h-6 w-full rounded-[3px] transition-transform hover:scale-110 hover:z-10 ${
                          isSelectedM ? 'ring-1 ring-[#f3e1b4]' : ''
                        }`}
                        style={{
                          backgroundColor: style.bg,
                          border: isMacroOnly
                            ? '1px dashed rgba(217, 190, 139, 0.9)'
                            : `1px solid ${style.border}`,
                        }}
                        aria-label={`${ap} ${ym}: ${val} سجل`}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Section 2: Selected Month Daily Calendar Matrix */}
      <div className="space-y-2.5 border-t border-white/[0.08] pt-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-200">
              مصفوفة الكثافة اليومية · <span className="font-mono text-[#ebd8ab]">{selectedMonth}</span>
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {[
                { ym: '2026-10', label: 'أكتوبر 2026 (حي+مجدول)' },
                { ym: '2026-09', label: 'سبتمبر 2026 (FIDS)' },
                { ym: '2026-08', label: 'أغسطس 2026 (FIDS)' },
                { ym: '2026-07', label: 'يوليو 2026 (FIDS)' },
              ].map((preset) => (
                <button
                  key={preset.ym}
                  type="button"
                  onClick={() => setSelectedMonth(preset.ym)}
                  className={`rounded-md px-2 py-0.5 text-[10.5px] transition-colors whitespace-nowrap ${
                    selectedMonth === preset.ym
                      ? 'border border-[#d9be8b]/50 bg-[#d9be8b]/20 text-[#f3e1b4]'
                      : 'border border-white/10 bg-white/[0.03] text-slate-400 hover:text-white'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            aria-label="اختر الشهر لمصفوفة التغطية اليومية"
            className="rounded-lg border border-white/15 bg-[#0a1415] px-2.5 py-1 font-mono text-xs text-slate-200 focus:border-[#d9be8b]/50 focus:outline-none"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {loading && !data ? (
          <div className="flex h-44 items-center justify-center rounded-xl border border-white/10 bg-[#0a1516] text-xs text-slate-400">
            جارٍ تحميل خلايا المصفوفة اليومية...
          </div>
        ) : (
          <div dir="rtl" className="overflow-x-auto pb-1">
            <div className="min-w-[740px] space-y-1">
              {/* Day numbers header */}
              <div
                className="grid items-center gap-[3px]"
                style={{
                  gridTemplateColumns: `72px repeat(${Math.max(1, dates.length)}, minmax(0, 1fr))`,
                }}
              >
                <div className="text-start text-[10px] text-slate-500">اليوم</div>
                {dates.map((d) => (
                  <div
                    key={d}
                    className="text-center font-mono text-[9px] text-slate-400 tabular-nums"
                  >
                    {d.slice(8, 10)}
                  </div>
                ))}
              </div>

              {/* Airport daily rows */}
              {airports.map((ap) => {
                const isScoped = selectedAirport.toUpperCase() === ap;
                return (
                  <div
                    key={`daily-${ap}`}
                    className={`grid items-center gap-[3px] rounded-md px-0.5 py-[2px] ${
                      isScoped ? 'ring-1 ring-[#d9be8b]/40 bg-white/[0.03]' : ''
                    }`}
                    style={{
                      gridTemplateColumns: `72px repeat(${Math.max(1, dates.length)}, minmax(0, 1fr))`,
                    }}
                  >
                    <div className="flex flex-col leading-tight pe-1 text-start">
                      <span className="font-mono text-[11px] font-semibold text-white">{ap}</span>
                      {!compact && (
                        <span className="truncate text-[9.5px] text-slate-400">{AIRPORT_LABELS[ap]}</span>
                      )}
                    </div>

                    {dates.map((d) => {
                      const cell = dailyLookup.get(`${ap}__${d}`);
                      const val = getDailyValue(cell);
                      const style = getHeatmapCellStyle(
                        val,
                        maxDailyVal,
                        cell?.coverage_classification
                      );
                      const isPinned =
                        pinnedDay?.airport_id === ap && pinnedDay?.flight_date === d;
                      const isVerified = (cell?.verified_movements_count ?? 0) > 0;

                      return (
                        <button
                          key={`${ap}-${d}`}
                          type="button"
                          onClick={() => {
                            if (cell) {
                              setPinnedDay(cell);
                              onSelectDailyCell?.(cell);
                            }
                          }}
                          onMouseEnter={(e) => {
                            if (!cell) return;
                            const arCls = translateCoverageClass(cell.coverage_classification);
                            setHoverInfo({
                              title: `${ap} · ${d}`,
                              detail:
                                val > 0
                                  ? `${val} سجل (${cell.verified_movements_count} موثق، ${cell.commercial_records_count} تجاري، ${cell.fids_records_count} FIDS)`
                                  : arCls,
                              meta: cell.sources_checked,
                            });
                            openCellTooltip(e.currentTarget, {
                              airportId: ap,
                              periodLabel: d,
                              classificationLabel: arCls,
                              verifiedCount: cell.verified_movements_count,
                              commercialCount: cell.commercial_records_count,
                              fidsCount: cell.fids_records_count,
                              totalDisplayed: val,
                              footNote: cell.sources_checked || undefined,
                            });
                          }}
                          onFocus={(e) => {
                            if (!cell) return;
                            openCellTooltip(e.currentTarget, {
                              airportId: ap,
                              periodLabel: d,
                              classificationLabel: translateCoverageClass(cell.coverage_classification),
                              verifiedCount: cell.verified_movements_count,
                              commercialCount: cell.commercial_records_count,
                              fidsCount: cell.fids_records_count,
                              totalDisplayed: val,
                              footNote: cell.sources_checked || undefined,
                            });
                          }}
                          onMouseLeave={clearHover}
                          onBlur={clearHover}
                          className={`flex h-7 w-full min-w-0 items-center justify-center rounded-[3px] font-mono text-[8.5px] leading-none font-semibold tabular-nums transition-transform hover:scale-110 hover:z-10 ${
                            isPinned ? 'ring-2 ring-[#f3e1b4] z-10' : ''
                          }`}
                          style={{
                            backgroundColor: style.bg,
                            color: style.text,
                            border: isVerified
                              ? '1.5px solid rgba(52, 211, 153, 0.9)'
                              : `1px solid ${style.border}`,
                          }}
                          aria-label={`${ap} ${d}: ${val} سجل`}
                        >
                          {val > 0 ? val : ''}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Pinned Cell Provenance Strip */}
      {pinnedDay && (
        <div className="rounded-xl border border-white/10 bg-[#0a1516]/90 p-3.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#d9be8b]" />
              <span className="dir-ltr font-mono font-semibold text-white">
                {pinnedDay.airport_id} · {pinnedDay.flight_date}
              </span>
              <span className="text-slate-400">·</span>
              <span className="text-[11px] font-medium text-emerald-300">
                {translateCoverageClass(pinnedDay.coverage_classification)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] tabular-nums">
              <span className="text-emerald-300">
                موثق: <span className="font-mono">{pinnedDay.verified_movements_count}</span>
              </span>
              <span className="text-sky-300">
                تجاري: <span className="font-mono">{pinnedDay.commercial_records_count}</span>
              </span>
              <span className="text-[#ebd8ab]">
                FIDS: <span className="font-mono">{pinnedDay.fids_records_count}</span>
              </span>
            </div>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
            <Info className="me-1 inline h-3 w-3 text-slate-500" />
            <strong className="font-medium text-slate-300">{pinnedDay.sources_checked}:</strong>{' '}
            {pinnedDay.evidence_basis} {pinnedDay.notes}
          </p>
        </div>
      )}

      {/* Interactive Cell Hover Tooltip */}
      {tooltip && (
        <div
          dir="rtl"
          role="tooltip"
          className="pointer-events-none absolute z-40 w-[240px] rounded-lg border border-white/15 bg-[#071112]/96 p-3 shadow-[0_18px_40px_rgba(0,0,0,0.75)] backdrop-blur-md"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: tooltip.placeAbove ? 'translateY(-100%)' : undefined,
          }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-xs font-semibold text-white">
              <span className="font-mono">{tooltip.airportId}</span> · {AIRPORT_LABELS[tooltip.airportId] ?? tooltip.airportId}
            </span>
            <span className="dir-ltr font-mono text-[11px] text-[#ebd8ab] tabular-nums">
              {tooltip.periodLabel}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {tooltip.classificationLabel}
          </div>

          <div className="mt-2 space-y-1 border-t border-white/10 pt-2 text-[11px] tabular-nums">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">السجلات الموثقة</span>
              <span className="font-mono font-semibold text-emerald-300">
                {tooltip.verifiedCount.toLocaleString('en-US')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">السجلات التجارية</span>
              <span className="font-mono font-semibold text-sky-300">
                {tooltip.commercialCount.toLocaleString('en-US')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">
                سجلات FIDS{!includeFids && tooltip.fidsCount > 0 ? ' (مخفية)' : ''}
              </span>
              <span className="font-mono font-semibold text-[#ebd8ab]">
                {tooltip.fidsCount.toLocaleString('en-US')}
              </span>
            </div>
            {show2024Macro && (tooltip.macro2024Ops ?? 0) > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-slate-400">إجمالي 2024 DAM_ALP_LTK</span>
                <span className="font-mono font-semibold text-amber-200">
                  {tooltip.macro2024Ops?.toLocaleString('en-US')}
                </span>
              </div>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-1.5 text-[10.5px]">
            <span className="text-slate-400">إجمالي الخلية النشطة</span>
            <span className="font-mono font-semibold text-white tabular-nums">
              {tooltip.totalDisplayed.toLocaleString('en-US')}
            </span>
          </div>
          {tooltip.footNote && (
            <div className="mt-1 truncate text-[10px] text-slate-500">
              {tooltip.footNote}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
