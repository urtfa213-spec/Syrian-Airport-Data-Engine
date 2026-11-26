import { useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import type {
  AirportRecord,
  AirTrafficKpisResponse,
  ComparisonDay,
  MovementStatsResponse,
  WorkspaceView,
} from '../types/aviation';
import { ComparisonSeriesChart } from './Charts';
import { TrendIndicator } from './TrendIndicator';
import { AnimatedStatValue } from './AnimatedStatValue';
import {
  SYRIAN_AIRPORT_NAMES_AR,
  SYRIAN_CITY_SHORT_AR,
  translateAirportType,
  translateFlightStatus,
  translateOperationalStatus,
} from '../i18n/ar';

interface OverviewViewProps {
  selectedAirport: string;
  onSelectAirport: (airportId: string) => void;
  onNavigate: (view: WorkspaceView) => void;
}

export function OverviewView({
  selectedAirport,
  onSelectAirport,
  onNavigate,
}: OverviewViewProps) {
  const [stats, setStats] = useState<MovementStatsResponse | null>(null);
  const [airports, setAirports] = useState<AirportRecord[]>([]);
  const [comparison, setComparison] = useState<ComparisonDay[]>([]);
  const [kpis, setKpis] = useState<AirTrafficKpisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async (airport: string) => {
    setLoading(true);
    setError(null);
    const kpiQs = airport !== 'all' ? `?airport_id=${encodeURIComponent(airport)}` : '';
    try {
      const [statsRes, airportsRes, compRes, kpisRes] = await Promise.all([
        fetch('/api/movements/stats'),
        fetch('/api/airports'),
        fetch(`/api/movements/comparison?airport_id=${encodeURIComponent(airport)}`),
        fetch(`/api/air-traffic/kpis${kpiQs}`),
      ]);
      if (!statsRes.ok || !airportsRes.ok || !compRes.ok) {
        throw new Error('تعذر تحميل بيانات النظرة العامة التشغيلية');
      }
      const [statsJson, airportsJson, compJson, kpisJson] = await Promise.all([
        statsRes.json(),
        airportsRes.json(),
        compRes.json(),
        kpisRes.ok ? kpisRes.json() : Promise.resolve(null),
      ]);
      setStats(statsJson);
      setAirports(Array.isArray(airportsJson) ? airportsJson : []);
      setComparison(Array.isArray(compJson.comparison) ? compJson.comparison : []);
      setKpis(kpisJson);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات النظرة العامة');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData(selectedAirport);
  }, [selectedAirport]);

  const totals = comparison.reduce(
    (acc, row) => {
      acc.scheduled += Number(row.scheduled_record_count || 0);
      acc.operational += Number(row.commercial_operational_event_count || 0);
      acc.resolved += Number(row.resolved_commercial_movement_count || 0);
      acc.codeshares += Number(row.codeshare_record_count || 0);
      acc.unverified += Number(row.unverified_record_count || 0);
      acc.total += Number(row.total_records || 0);
      return acc;
    },
    { scheduled: 0, operational: 0, resolved: 0, codeshares: 0, unverified: 0, total: 0 }
  );

  const aptCountMap = new Map<string, { cnt: number; min_date: string; max_date: string; dates_count: number }>();
  if (stats?.airport_events_breakdown) {
    for (const item of stats.airport_events_breakdown) {
      aptCountMap.set(item.airport_id, item);
    }
  }

  return (
    <div className="space-y-6">
      {/* Error State */}
      {error && (
        <div className="flex items-center justify-between rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          <span>{error}</span>
          <button
            onClick={() => void loadData(selectedAirport)}
            className="font-medium underline underline-offset-2 whitespace-nowrap shrink-0"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* 4-Column Flat KPI Strip */}
      <section className="grid grid-cols-1 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white sm:grid-cols-2 sm:divide-x rtl:sm:divide-x-reverse sm:divide-y-0 lg:grid-cols-4 dark:divide-slate-800 dark:border-slate-800 dark:bg-[#111827]">
        <div className="kpi-card-animate p-5 [animation-delay:0ms]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            الرحلات المجدولة في الجداول
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-slate-50">
            <AnimatedStatValue value={totals.scheduled} loading={loading} />
          </p>
          <div className="mt-1.5">
            <TrendIndicator
              pct={kpis?.trends?.scheduled_daily_avg_pct}
              comparisonLabel="معدل يومي عن الشهر الماضي"
              neutralWhenNull="لا يوجد خط أساس للشهر السابق"
            />
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {selectedAirport === 'all'
              ? 'كافة المطارات السورية'
              : SYRIAN_AIRPORT_NAMES_AR[selectedAirport] || selectedAirport}{' '}
            · {comparison.length} يوماً نشطاً
          </p>
        </div>

        <div className="kpi-card-animate p-5 [animation-delay:60ms]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            الحركات التشغيلية المرصودة
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-emerald-700 tabular-nums dark:text-emerald-400">
            <AnimatedStatValue value={totals.operational} loading={loading} />
          </p>
          <div className="mt-1.5">
            <TrendIndicator
              pct={
                kpis?.trends?.observed_movements_month_pct ??
                kpis?.trends?.observed_sample_day_pct
              }
              comparisonLabel={
                kpis?.trends?.observed_movements_month_pct !== null &&
                kpis?.trends?.observed_movements_month_pct !== undefined
                  ? 'عن الشهر الماضي'
                  : kpis?.trends?.observed_sample_prev_date
                    ? `مقارنة بعينة ${kpis.trends.observed_sample_prev_date.slice(5)}`
                    : 'عن العينة السابقة'
              }
              neutralWhenNull="عينة ليوم واحد أو نطاق غير مراقب"
            />
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {totals.resolved.toLocaleString('en-US')} مقاطع مؤكدة · عينة 9–10 أكتوبر
          </p>
        </div>

        <div className="kpi-card-animate p-5 [animation-delay:120ms]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            مشاركات الرمز والسجلات غير الموثقة
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-amber-700 tabular-nums dark:text-amber-400">
            <AnimatedStatValue value={totals.codeshares + totals.unverified} loading={loading} />
          </p>
          <div className="mt-1.5">
            <TrendIndicator
              pct={kpis?.trends?.non_verified_share_pp}
              suffix="pp"
              positiveIsGood={false}
              comparisonLabel="عن الشهر الماضي"
              neutralWhenNull="لا يوجد خط أساس للشهر السابق"
            />
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {totals.codeshares} إدراج تسويقي · {totals.unverified} غير موثق
          </p>
        </div>

        <div className="kpi-card-animate p-5 [animation-delay:180ms]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            تسجيلات الأسطول والشركات
          </p>
          <p className="dir-ltr mt-2 font-mono text-2xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-slate-50 inline-block">
            <AnimatedStatValue
              value={
                stats
                  ? `${stats.distinct_reported_aircraft_registrations} / ${stats.total_unique_airlines}`
                  : '—'
              }
              loading={loading || !stats}
            />
          </p>
          <div className="mt-1.5">
            <TrendIndicator
              pct={kpis?.trends?.active_airlines_pct}
              comparisonLabel="شركة نشطة عن الشهر الماضي"
              neutralWhenNull="لا يوجد خط أساس للشهر السابق"
            />
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            رموز الطائرات / شركات الطيران · {stats?.historical_2024_rows ?? 0} سجل إجمالي 2024
          </p>
        </div>
      </section>

      {/* Primary Focal Analytical Anchor */}
      <section className="rounded-md border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800/80">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              توافر الجداول المجدولة مقابل الأرصاد التشغيلية التجارية
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              فصل يومي صارم بين خانات الجداول المنشورة وأحداث الحالة التشغيلية / رصد ADS-B. تشير التواريخ غير المراقبة إلى غياب التغطية المصدرية وليس انعدام الرحلات.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => void loadData(selectedAirport)}
              className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              تحديث
            </button>
            <button
              onClick={() => onNavigate('flights')}
              className="inline-flex items-center gap-1.5 rounded bg-sky-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-800 whitespace-nowrap shrink-0 dark:bg-sky-600 dark:hover:bg-sky-500"
            >
              فحص سجل الرحلات
              <ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
            </button>
          </div>
        </div>

        <ComparisonSeriesChart data={comparison} loading={loading} />
      </section>

      {/* Two-Column Split: Aerodromes Registry + Top Connected Corridors */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-md border border-slate-200 bg-white lg:col-span-2 dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                سجل المطارات السورية وتغطية قاعدة البيانات
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                اختر أي مطار لتصفية الرسوم البيانية ومؤشرات الأداء حسب ذلك المطار
              </p>
            </div>
            {selectedAirport !== 'all' && (
              <button
                onClick={() => onSelectAirport('all')}
                className="text-xs font-medium text-sky-700 hover:underline whitespace-nowrap shrink-0 dark:text-sky-400"
              >
                عرض جميع المطارات
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-start text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-5 py-2.5 font-medium">الرمز</th>
                  <th className="px-3 py-2.5 font-medium">المطار</th>
                  <th className="px-3 py-2.5 font-medium">الفئة والحالة</th>
                  <th className="px-3 py-2.5 font-medium text-end">الأحداث</th>
                  <th className="px-3 py-2.5 font-medium text-end">الأيام</th>
                  <th className="px-5 py-2.5 font-medium text-end">النافذة الزمنية</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {airports.map((ap) => {
                  const bd = aptCountMap.get(ap.airport_id);
                  const isActive = selectedAirport.toUpperCase() === ap.airport_id;
                  return (
                    <tr
                      key={ap.airport_id}
                      onClick={() => onSelectAirport(isActive ? 'all' : ap.airport_id)}
                      className={`h-10 cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-sky-50/70 dark:bg-sky-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="px-5 py-2 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        <span className="dir-ltr inline-block">
                          {ap.airport_id}
                          <span className="ms-1.5 font-normal text-slate-400">{ap.icao_code}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {ap.name_ar || SYRIAN_AIRPORT_NAMES_AR[ap.airport_id] || ap.name}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {SYRIAN_CITY_SHORT_AR[ap.airport_id] || ap.city_ar || ap.name}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {translateAirportType(ap.airport_type)} · {translateOperationalStatus(ap.operational_status)}
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {bd ? bd.cnt.toLocaleString('en-US') : '0'}
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {bd ? bd.dates_count : '0'}
                      </td>
                      <td className="px-5 py-2 text-end font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {bd ? (
                          <span className="dir-ltr inline-block">
                            {bd.min_date.slice(5)} → {bd.max_date.slice(5)}
                          </span>
                        ) : (
                          'لا توجد أحداث'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
          <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              أبرز المطارات المتصلة
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              المحطات الأكثر تكراراً للمغادرة والوصول
            </p>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
            {(stats?.top_connected_airports ?? []).map((item, idx) => {
              const maxCnt = stats?.top_connected_airports?.[0]?.cnt || 1;
              const widthPct = Math.max(8, Math.round((item.cnt / maxCnt) * 100));
              return (
                <div key={item.connected_airport_iata} className="px-5 py-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="dir-ltr font-mono font-semibold text-slate-900 dark:text-slate-100">
                      0{idx + 1}. {item.connected_airport_iata}
                    </span>
                    <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {item.cnt.toLocaleString('en-US')} حدثاً
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-xs bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full bg-sky-600 dark:bg-sky-500"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-slate-200 px-5 py-3.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            توزيع الحالات:{' '}
            {Object.entries(stats?.flight_statuses ?? {})
              .map(([k, v]) => `${translateFlightStatus(k)}: ${v.toLocaleString('en-US')}`)
              .join(' · ') || 'جارٍ التحميل...'}
          </div>
        </div>
      </section>
    </div>
  );
}
