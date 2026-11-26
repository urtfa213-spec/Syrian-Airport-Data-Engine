import { useState, type FormEvent } from 'react';
import {
  Activity,
  ArrowRight,
  Building2,
  ChevronRight,
  Database,
  Layers,
  Plane,
  Route,
  Search,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import type { WorkspaceView } from '../types/aviation';
import { DottedMatrixChart, type MatrixPoint } from './DottedMatrixChart';
import type { CategoryKey } from './NetworkGraphCanvas';
import { TrendIndicator } from './TrendIndicator';
import { AnimatedStatValue } from './AnimatedStatValue';

export interface InspectorMetricTile {
  label: string;
  value: string;
  icon: 'plane' | 'layers' | 'building' | 'shield' | 'route' | 'activity';
  trendPct?: number | null;
  trendLabel?: string;
  trendSuffix?: string;
  trendPositiveIsGood?: boolean;
}

export interface InspectorData {
  contextPrompt: string;
  categoryKey: CategoryKey;
  categoryLabel: string;
  title: string;
  statusLabel: string;
  statusTone: 'emerald' | 'amber' | 'sky';
  provenanceLine: string;
  exploreTarget: WorkspaceView;
  exploreLabel?: string;
  exploreAirport?: string;
  exploreSearchQuery?: string;
  exploreNature?: string;
  exploreDestination?: string;
  chartTitle: string;
  chartBadge: string;
  headlineValue: string;
  headlineDelta: string;
  headlineTrendPct?: number | null;
  headlineTrendLabel?: string;
  matrixPoints: MatrixPoint[];
  accentColor: 'gold' | 'emerald' | 'sky';
  tiles: [InspectorMetricTile, InspectorMetricTile, InspectorMetricTile, InspectorMetricTile];
  findingTitle: string;
  findingBody: string;
}

interface InspectorPanelProps {
  data: InspectorData;
  scopeLabel: string;
  matchCountHint?: number | null;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onSubmitSearch: (query: string) => void;
  onExploreDetails: (
    target: WorkspaceView,
    opts?: { airportId?: string; airlineQuery?: string; recordNature?: string; destination?: string }
  ) => void;
  onClearSearch: () => void;
}

const CAT_ICON_MAP: Record<CategoryKey, typeof Plane> = {
  airports: Building2,
  layers: Layers,
  airlines: Plane,
  routes: Route,
  audits: ShieldCheck,
};

function renderTileIcon(kind: InspectorMetricTile['icon']) {
  const cls = 'h-4 w-4 shrink-0 text-[#d9be8b]/85';
  switch (kind) {
    case 'plane':
      return <Plane className={cls} />;
    case 'layers':
      return <Layers className={cls} />;
    case 'building':
      return <Building2 className={cls} />;
    case 'shield':
      return <ShieldCheck className={cls} />;
    case 'route':
      return <Route className={cls} />;
    default:
      return <Activity className={cls} />;
  }
}

export function InspectorPanel({
  data,
  scopeLabel,
  matchCountHint,
  searchQuery,
  onSearchQueryChange,
  onSubmitSearch,
  onExploreDetails,
  onClearSearch,
}: InspectorPanelProps) {
  const [inputFocused, setInputFocused] = useState(false);
  const CatIcon = CAT_ICON_MAP[data.categoryKey] ?? Database;

  const statusPillClass =
    data.statusTone === 'emerald'
      ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-300'
      : data.statusTone === 'amber'
        ? 'border-[#d9be8b]/50 bg-[#d9be8b]/10 text-[#ebd8ab]'
        : 'border-sky-400/50 bg-sky-500/10 text-sky-300';

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmitSearch(searchQuery);
  };

  return (
    <aside className="flex h-full flex-col gap-2.5">
      {/* Top Context Strip matching reference */}
      <div className="rounded-xl border border-white/10 bg-[#0b1516]/85 px-4 py-2 text-xs text-slate-300 backdrop-blur-md">
        <span className="truncate block">{data.contextPrompt}</span>
      </div>

      {/* Main Frosted Obsidian-Emerald Detail Panel */}
      <div className="relative flex flex-1 flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-[#081213]/92 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.75)] backdrop-blur-xl">
        {/* Ambient top-left teal inner luminescence (RTL reading start) */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 8% 4%, rgba(56, 152, 142, 0.22) 0%, rgba(16, 46, 46, 0.06) 40%, transparent 65%)',
          }}
        />

        <div className="relative z-10 flex flex-col">
          {/* Category Badge */}
          <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
            <CatIcon className="h-4 w-4 text-[#d9be8b]" />
            <span>{data.categoryLabel}</span>
          </div>

          {/* Large Display Title */}
          <h1 className="mt-2 font-display text-xl font-semibold leading-snug text-white sm:text-[22px]">
            {data.title}
          </h1>

          {/* Status & Explore Details Row */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <span
                className={`inline-flex items-center rounded border px-2 py-0.5 text-[10.5px] font-medium ${statusPillClass}`}
              >
                {data.statusLabel}
              </span>
              <p className="text-[11px] leading-snug text-slate-400">
                {data.provenanceLine}
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                onExploreDetails(data.exploreTarget, {
                  airportId: data.exploreAirport,
                  airlineQuery: data.exploreSearchQuery,
                  recordNature: data.exploreNature,
                  destination: data.exploreDestination,
                })
              }
              className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/[0.06] px-3.5 py-2 text-xs font-medium text-slate-100 transition-colors hover:border-[#d9be8b]/50 hover:bg-white/[0.11] whitespace-nowrap shrink-0"
            >
              <span>{data.exploreLabel ?? 'استكشاف التفاصيل'}</span>
              <ChevronRight className="h-3.5 w-3.5 text-slate-300 rtl:rotate-180" />
            </button>
          </div>

          {/* Featured Dotted Matrix Chart Card */}
          <div className="kpi-card-animate mt-4 rounded-xl border border-white/10 bg-gradient-to-b from-[#0d191a]/90 to-[#081011]/95 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-200">{data.chartTitle}</span>
              <span className="dir-ltr rounded border border-[#d9be8b]/40 bg-[#d9be8b]/10 px-2.5 py-0.5 font-mono text-[10px] font-medium text-[#ebd8ab]">
                {data.chartBadge}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-1 items-end gap-4 sm:grid-cols-12">
              <div className="sm:col-span-5">
                <div className="font-display text-3xl font-semibold tracking-tight text-white tabular-nums">
                  <AnimatedStatValue value={data.headlineValue} durationMs={520} />
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                  <TrendingUp className="h-3.5 w-3.5 shrink-0 text-[#d9be8b]" />
                  <span className="truncate">{data.headlineDelta}</span>
                </div>
                {data.headlineTrendPct !== undefined && data.headlineTrendPct !== null && (
                  <div className="mt-1">
                    <TrendIndicator
                      pct={data.headlineTrendPct}
                      comparisonLabel={data.headlineTrendLabel ?? 'من الشهر الماضي'}
                      compact
                    />
                  </div>
                )}
              </div>
              <div className="sm:col-span-7">
                <DottedMatrixChart points={data.matrixPoints} accentColor={data.accentColor} />
              </div>
            </div>
          </div>

          {/* 2x2 Metric Grid */}
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {data.tiles.map((tile, idx) => {
              const delayClass =
                idx === 0
                  ? '[animation-delay:0ms]'
                  : idx === 1
                    ? '[animation-delay:55ms]'
                    : idx === 2
                      ? '[animation-delay:110ms]'
                      : '[animation-delay:165ms]';
              const isShortCode = /^[A-Za-z]{2,5}$/.test(tile.value.trim());
              return (
                <div
                  key={`${tile.label}-${idx}`}
                  className={`kpi-card-animate ${delayClass} rounded-xl border border-white/10 bg-[#0d1819]/75 p-3 transition-colors hover:border-white/20`}
                >
                  <div className="flex items-center gap-2">
                    {renderTileIcon(tile.icon)}
                    <span className="font-display text-xl font-semibold tracking-tight text-white tabular-nums">
                      {isShortCode ? (
                        <span className="kpi-value-fade">{tile.value}</span>
                      ) : (
                        <AnimatedStatValue value={tile.value} durationMs={500} />
                      )}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] leading-tight text-slate-400">{tile.label}</div>
                  {tile.trendPct !== undefined && tile.trendPct !== null && (
                    <div className="mt-1">
                      <TrendIndicator
                        pct={tile.trendPct}
                        comparisonLabel={tile.trendLabel ?? 'من الشهر الماضي'}
                        suffix={tile.trendSuffix ?? '%'}
                        positiveIsGood={tile.trendPositiveIsGood ?? true}
                        compact
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Empirical Assessment Block */}
          <div className="mt-3.5 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
              <ShieldCheck className="h-3.5 w-3.5 text-[#d9be8b]" />
              <span>التقييم التجريبي والموثوقية</span>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#0b1415]/90 p-3.5">
              <div className="text-xs font-semibold text-white">{data.findingTitle}</div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">
                {data.findingBody}
              </p>
            </div>
          </div>
        </div>

        {/* Bottom Luminous Data Query / Filter Bar */}
        <form
          onSubmit={handleFormSubmit}
          className={`relative z-10 mt-4 rounded-2xl border p-2 transition-all ${
            inputFocused
              ? 'border-[#d9be8b]/50 bg-[#0f1f20]/95 shadow-[0_0_36px_rgba(62,158,148,0.28)]'
              : 'border-white/15 bg-[#0d1a1b]/95 shadow-[0_0_24px_rgba(32,94,88,0.20)]'
          }`}
        >
          <div className="flex items-center gap-2 rounded-xl bg-gradient-to-b from-[#eff6f5] to-[#d0e2df] px-3 py-2 shadow-inner">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-600" />
            <input
              type="text"
              value={searchQuery}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="ابحث عن مطار أو شركة طيران أو رمز IATA (مثل DAM، RB، DXB)..."
              aria-label="تصفية عقد الرسم أو الاستعلام في سجل الرحلات"
              className="w-full bg-transparent text-xs font-medium text-slate-900 placeholder:text-slate-500 focus:outline-none"
            />
            <button
              type="submit"
              aria-label="فتح الرحلات المصفاة في السجل"
              title="فتح الرحلات المصفاة في سجل العمليات"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0b2326] text-white transition-colors hover:bg-[#14393e]"
            >
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between px-1.5 text-[11px] text-slate-300">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="inline-flex items-center gap-1 rounded bg-white/5 px-2 py-0.5 text-[10.5px] text-slate-200 whitespace-nowrap">
                النطاق: <span className="font-mono">{scopeLabel}</span>
              </span>
              {searchQuery.trim() ? (
                <button
                  type="button"
                  onClick={onClearSearch}
                  className="text-[11px] text-[#d9be8b] hover:underline whitespace-nowrap"
                >
                  مسح الفلتر
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onExploreDetails('flights')}
                  className="text-[11px] text-slate-400 hover:text-white whitespace-nowrap"
                >
                  فتح سجل الرحلات
                </button>
              )}
            </div>
            <span className="text-[10.5px] text-slate-400 whitespace-nowrap tabular-nums">
              {typeof matchCountHint === 'number'
                ? `${matchCountHint} عقدة مطابقة`
                : 'تصفية السجل'}
            </span>
          </div>
        </form>
      </div>
    </aside>
  );
}
