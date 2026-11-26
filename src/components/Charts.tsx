import { useState } from 'react';
import type { ComparisonDay } from '../types/aviation';

interface ComparisonChartProps {
  data: ComparisonDay[];
  loading?: boolean;
}

export function ComparisonSeriesChart({ data, loading }: ComparisonChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (loading) {
    return (
      <div className="h-72 w-full animate-pulse rounded border border-slate-200 bg-slate-100/70 dark:border-slate-800 dark:bg-slate-900/60" />
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded border border-slate-200 bg-slate-50 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
        لا توجد سجلات مقارنة يومية مطابقة للمطار المحدد.
      </div>
    );
  }

  // Aggregate by flight_date when 'all' airports return multiple rows per date
  const byDate = new Map<
    string,
    {
      flight_date: string;
      scheduled: number;
      operational: number;
      codeshare: number;
      unverified: number;
      resolved: number;
    }
  >();

  for (const row of data) {
    const existing = byDate.get(row.flight_date);
    if (existing) {
      existing.scheduled += Number(row.scheduled_record_count || 0);
      existing.operational += Number(row.commercial_operational_event_count || 0);
      existing.codeshare += Number(row.codeshare_record_count || 0);
      existing.unverified += Number(row.unverified_record_count || 0);
      existing.resolved += Number(row.resolved_commercial_movement_count || 0);
    } else {
      byDate.set(row.flight_date, {
        flight_date: row.flight_date,
        scheduled: Number(row.scheduled_record_count || 0),
        operational: Number(row.commercial_operational_event_count || 0),
        codeshare: Number(row.codeshare_record_count || 0),
        unverified: Number(row.unverified_record_count || 0),
        resolved: Number(row.resolved_commercial_movement_count || 0),
      });
    }
  }

  const series = [...byDate.values()].sort((a, b) => a.flight_date.localeCompare(b.flight_date));
  const width = 920;
  const height = 260;
  const padLeft = 18;
  const padRight = 44;
  const padTop = 18;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxVal = Math.max(
    10,
    ...series.map((d) => Math.max(d.scheduled, d.operational + d.codeshare + d.unverified))
  );
  const yMax = Math.ceil(maxVal / 10) * 10;
  const stepX = plotW / Math.max(1, series.length);
  const barW = Math.max(2, Math.min(18, stepX * 0.68));

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(yMax * t));
  const labelIndices = new Set<number>();
  if (series.length <= 10) {
    series.forEach((_, i) => labelIndices.add(i));
  } else {
    const stride = Math.ceil(series.length / 7);
    for (let i = 0; i < series.length; i += stride) labelIndices.add(i);
    labelIndices.add(series.length - 1);
  }

  const activePoint = hoverIdx !== null ? series[hoverIdx] : series[series.length - 1];

  return (
    <div dir="rtl" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex flex-wrap items-center gap-5 text-slate-600 dark:text-slate-300">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-xs bg-sky-600 dark:bg-sky-500" />
            رحلات مجدولة في الجداول
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-xs bg-emerald-600 dark:bg-emerald-500" />
            حركات تشغيلية مرصودة (ADS-B / الحالة)
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-xs bg-amber-500" />
            مشاركات رمز تسويقية
          </span>
        </div>
        {activePoint && (
          <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-slate-700 tabular-nums dark:text-slate-200">
            <span className="dir-ltr font-semibold">{activePoint.flight_date}</span>
            <span className="text-slate-400">·</span>
            <span>مجدول: {activePoint.scheduled.toLocaleString('en-US')}</span>
            <span className="text-slate-400">·</span>
            <span className="text-emerald-700 dark:text-emerald-400">
              مرصود: {activePoint.operational.toLocaleString('en-US')}
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-amber-700 dark:text-amber-400">
              مشاركة رمز: {activePoint.codeshare.toLocaleString('en-US')}
            </span>
          </div>
        )}
      </div>

      <div dir="rtl" className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-64 w-full min-w-[620px] select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          {yTicks.map((tick) => {
            const y = padTop + plotH - (tick / yMax) * plotH;
            return (
              <g key={tick}>
                <line
                  x1={padLeft}
                  x2={width - padRight}
                  y1={y}
                  y2={y}
                  className="stroke-slate-200 dark:stroke-slate-800"
                  strokeWidth={1}
                />
                <text
                  x={width - padRight + 8}
                  y={y + 4}
                  textAnchor="start"
                  style={{ direction: 'ltr', unicodeBidi: 'isolate' }}
                  className="fill-slate-500 font-mono text-[10px] dark:fill-slate-400"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {series.map((d, i) => {
            const cx = width - padRight - (i * stepX + stepX / 2);
            const schedH = (d.scheduled / yMax) * plotH;
            const opsH = (d.operational / yMax) * plotH;
            const csH = (d.codeshare / yMax) * plotH;
            const isHovered = hoverIdx === i;

            return (
              <g
                key={d.flight_date}
                onMouseEnter={() => setHoverIdx(i)}
                className="cursor-crosshair"
              >
                <rect
                  x={cx - stepX / 2}
                  y={padTop}
                  width={stepX}
                  height={plotH}
                  className={isHovered ? 'fill-slate-200/50 dark:fill-slate-800/60' : 'fill-transparent'}
                />
                <rect
                  x={cx - barW / 2}
                  y={padTop + plotH - schedH}
                  width={Math.max(2, barW * 0.55)}
                  height={Math.max(0, schedH)}
                  rx={1}
                  className="fill-sky-600/80 dark:fill-sky-500/80"
                />
                <rect
                  x={cx + (barW * 0.08)}
                  y={padTop + plotH - opsH}
                  width={Math.max(2, barW * 0.45)}
                  height={Math.max(0, opsH)}
                  rx={1}
                  className="fill-emerald-600 dark:fill-emerald-500"
                />
                {d.codeshare > 0 && (
                  <rect
                    x={cx + (barW * 0.08)}
                    y={padTop + plotH - opsH - csH}
                    width={Math.max(2, barW * 0.45)}
                    height={Math.max(0, csH)}
                    rx={1}
                    className="fill-amber-500"
                  />
                )}
                {labelIndices.has(i) && (
                  <text
                    x={cx}
                    y={height - 10}
                    textAnchor="middle"
                    style={{ direction: 'ltr', unicodeBidi: 'isolate' }}
                    className="fill-slate-500 font-mono text-[10px] dark:fill-slate-400"
                  >
                    {d.flight_date.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

interface HourlyPoint {
  hour_local: string;
  hour_label: string;
  arrivals: number;
  departures: number;
  total: number;
}

export function HourlyDistributionChart({ hours }: { hours: HourlyPoint[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!hours || hours.length === 0) return null;

  const width = 860;
  const height = 220;
  const padLeft = 16;
  const padRight = 38;
  const padTop = 16;
  const padBottom = 30;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxVal = Math.max(5, ...hours.map((h) => h.total));
  const yMax = Math.ceil(maxVal / 10) * 10;
  const stepX = plotW / hours.length;
  const barW = Math.max(8, stepX * 0.62);
  const active = hoverIdx !== null ? hours[hoverIdx] : null;

  return (
    <div dir="rtl" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex flex-wrap items-center gap-5 text-slate-600 dark:text-slate-300">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-xs bg-sky-600 dark:bg-sky-500" />
            الرحلات القادمة المجدولة
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-xs bg-slate-700 dark:bg-slate-400" />
            الرحلات المغادرة المجدولة
          </span>
        </div>
        <div className="font-mono text-xs text-slate-600 tabular-nums dark:text-slate-300">
          {active ? (
            <>
              <span className="dir-ltr inline-block">{active.hour_label}</span> · الإجمالي{' '}
              {active.total.toLocaleString('en-US')} (وصول {active.arrivals.toLocaleString('en-US')} / مغادرة{' '}
              {active.departures.toLocaleString('en-US')})
            </>
          ) : (
            <>
              توقيت دمشق المحلي (<span className="dir-ltr inline-block">Asia/Damascus · UTC+3</span>)
            </>
          )}
        </div>
      </div>

      <div dir="rtl" className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-56 w-full min-w-[560px] select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          {[0, 0.5, 1].map((t) => {
            const val = Math.round(yMax * t);
            const y = padTop + plotH - t * plotH;
            return (
              <g key={t}>
                <line
                  x1={padLeft}
                  x2={width - padRight}
                  y1={y}
                  y2={y}
                  className="stroke-slate-200 dark:stroke-slate-800"
                  strokeWidth={1}
                />
                <text
                  x={width - padRight + 8}
                  y={y + 4}
                  textAnchor="start"
                  style={{ direction: 'ltr', unicodeBidi: 'isolate' }}
                  className="fill-slate-500 font-mono text-[10px] dark:fill-slate-400"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {hours.map((h, i) => {
            const cx = width - padRight - (i * stepX + stepX / 2);
            const arrH = (h.arrivals / yMax) * plotH;
            const depH = (h.departures / yMax) * plotH;
            return (
              <g key={h.hour_local} onMouseEnter={() => setHoverIdx(i)} className="cursor-pointer">
                <rect
                  x={cx - stepX / 2}
                  y={padTop}
                  width={stepX}
                  height={plotH}
                  className={hoverIdx === i ? 'fill-slate-200/50 dark:fill-slate-800/60' : 'fill-transparent'}
                />
                <rect
                  x={cx - barW / 2}
                  y={padTop + plotH - arrH}
                  width={barW}
                  height={arrH}
                  className="fill-sky-600 dark:fill-sky-500"
                />
                <rect
                  x={cx - barW / 2}
                  y={padTop + plotH - arrH - depH}
                  width={barW}
                  height={depH}
                  className="fill-slate-700 dark:fill-slate-400"
                />
                {i % 2 === 0 && (
                  <text
                    x={cx}
                    y={height - 10}
                    textAnchor="middle"
                    style={{ direction: 'ltr', unicodeBidi: 'isolate' }}
                    className="fill-slate-500 font-mono text-[10px] dark:fill-slate-400"
                  >
                    {h.hour_local}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
