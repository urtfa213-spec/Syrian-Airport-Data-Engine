import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { AirTrafficKpisResponse, MonthlySummaryRow } from '../types/aviation';
import { TrendIndicator } from './TrendIndicator';
import { AnimatedStatValue } from './AnimatedStatValue';
import {
  SYRIAN_AIRPORT_NAMES_AR,
  translateAirline,
  translateCity,
  translateKpiStatus,
} from '../i18n/ar';

interface MonitorViewProps {
  selectedAirport: string;
}

interface FilterOptions {
  airports: Array<{ airport_id: string; name: string; name_ar: string }>;
  months: string[];
  airlines: string[];
  destinations: Array<{ connected_airport_iata: string; connected_city: string }>;
}

export function MonitorView({ selectedAirport }: MonitorViewProps) {
  const [options, setOptions] = useState<FilterOptions>({
    airports: [],
    months: [],
    airlines: [],
    destinations: [],
  });
  const [airport, setAirport] = useState(selectedAirport === 'all' ? '' : selectedAirport);
  const [month, setMonth] = useState('2026-10');
  const [airline, setAirline] = useState('');
  const [destination, setDestination] = useState('');

  const [kpis, setKpis] = useState<AirTrafficKpisResponse | null>(null);
  const [monthly, setMonthly] = useState<MonthlySummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAirport(selectedAirport === 'all' ? '' : selectedAirport);
  }, [selectedAirport]);

  useEffect(() => {
    fetch('/api/air-traffic/filter-options')
      .then((r) => r.json())
      .then((d) => setOptions(d))
      .catch(() => {});
  }, []);

  const buildQuery = (includeMonth: boolean) => {
    const p = new URLSearchParams();
    if (airport) p.set('airport_id', airport);
    if (includeMonth && month) p.set('month', month);
    if (airline) p.set('airline', airline);
    if (destination) p.set('destination', destination);
    return p.toString();
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const kpiQs = buildQuery(true);
    const monQs = buildQuery(false);
    Promise.all([
      fetch(`/api/air-traffic/kpis?${kpiQs}`).then((r) => {
        if (!r.ok) throw new Error('تعذر تحميل مؤشرات مراقب الحركة الجوية');
        return r.json();
      }),
      fetch(`/api/air-traffic/monthly-summary?${monQs}`).then((r) => {
        if (!r.ok) throw new Error('تعذر تحميل الملخص الشهري');
        return r.json();
      }),
    ])
      .then(([kpiJson, monJson]) => {
        if (!active) return;
        setKpis(kpiJson);
        setMonthly(Array.isArray(monJson.summary) ? monJson.summary : []);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات مراقب الحركة الجوية');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [airport, month, airline, destination]);

  const exportUrl = (endpoint: string, format: 'csv' | 'xlsx') => {
    const qs = buildQuery(false);
    return `${endpoint}?${qs ? `${qs}&` : ''}format=${format}`;
  };

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={airport}
            onChange={(e) => setAirport(e.target.value)}
            aria-label="تصفية المطار في المراقب"
            className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="">جميع المطارات النشطة</option>
            {options.airports.map((a) => (
              <option key={a.airport_id} value={a.airport_id}>
                {a.airport_id} · {a.name_ar || SYRIAN_AIRPORT_NAMES_AR[a.airport_id] || a.name}
              </option>
            ))}
          </select>

          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="تصفية الشهر في المراقب"
            className="dir-ltr rounded border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            {options.months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <select
            value={airline}
            onChange={(e) => setAirline(e.target.value)}
            aria-label="تصفية شركة الطيران في المراقب"
            className="max-w-[220px] rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="">جميع شركات الطيران</option>
            {(() => {
              const counts = new Map<string, number>();
              for (const al of options.airlines) {
                const ar = translateAirline(al);
                counts.set(ar, (counts.get(ar) ?? 0) + 1);
              }
              return options.airlines.map((al) => {
                const ar = translateAirline(al);
                const label = (counts.get(ar) ?? 0) > 1 && ar !== al ? `${ar} (${al})` : ar;
                return (
                  <option key={al} value={al}>
                    {label}
                  </option>
                );
              });
            })()}
          </select>

          <select
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            aria-label="تصفية الوجهة في المراقب"
            className="max-w-[220px] rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="">جميع الوجهات</option>
            {options.destinations.map((d) => (
              <option key={d.connected_airport_iata} value={d.connected_airport_iata}>
                {d.connected_airport_iata}{' '}
                {d.connected_city ? `· ${translateCity(d.connected_city)}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a
            href={exportUrl('/api/air-traffic/export/monthly', 'csv')}
            className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            ملخص شهري CSV
          </a>
          <a
            href={exportUrl('/api/air-traffic/export/monthly', 'xlsx')}
            className="inline-flex items-center gap-1.5 rounded bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-800 whitespace-nowrap shrink-0 dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            <Download className="h-3.5 w-3.5" />
            ملخص شهري XLSX
          </a>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {/* KPI Strip */}
      <section className="grid grid-cols-1 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white sm:grid-cols-2 sm:divide-x rtl:sm:divide-x-reverse sm:divide-y-0 lg:grid-cols-4 dark:divide-slate-800 dark:border-slate-800 dark:bg-[#111827]">
        <div className="kpi-card-animate p-5 [animation-delay:0ms]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            الرحلات المجدولة (<span className="dir-ltr font-mono">{kpis?.period.month || 'الفترة'}</span>)
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-50">
            <AnimatedStatValue value={kpis?.kpis.scheduled_flights ?? 0} loading={loading || !kpis} />
          </p>
          <div className="mt-1.5">
            <TrendIndicator
              pct={kpis?.trends?.scheduled_daily_avg_pct}
              comparisonLabel="معدل يومي عن الشهر الماضي"
              neutralWhenNull="لا يوجد خط أساس للشهر السابق"
            />
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            وصول {(kpis?.kpis.scheduled_arrivals ?? 0).toLocaleString('en-US')} · مغادرة{' '}
            {(kpis?.kpis.scheduled_departures ?? 0).toLocaleString('en-US')}
          </p>
        </div>

        <div className="kpi-card-animate p-5 [animation-delay:60ms]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            حركات ADS-B المرصودة
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
            <AnimatedStatValue
              value={
                kpis?.kpis.actual_movements !== null && kpis?.kpis.actual_movements !== undefined
                  ? kpis.kpis.actual_movements
                  : 'غير متوفر (خارج الرصد)'
              }
              loading={loading || !kpis}
            />
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
              neutralWhenNull="لا يوجد رصد ADS-B سابق"
            />
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {kpis?.observation_coverage.status_ar ||
              translateKpiStatus(kpis?.observation_coverage.status)}
          </p>
        </div>

        <div className="kpi-card-animate p-5 [animation-delay:120ms]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            شركات الطيران والمسارات النشطة
          </p>
          <p className="dir-ltr mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-50 inline-block">
            <AnimatedStatValue
              value={kpis ? `${kpis.kpis.active_airlines} / ${kpis.kpis.active_destinations}` : '—'}
              loading={loading || !kpis}
            />
          </p>
          <div className="mt-1.5">
            <TrendIndicator
              pct={kpis?.trends?.active_airlines_pct}
              comparisonLabel="شركة عن الشهر الماضي"
              neutralWhenNull="لا يوجد خط أساس للشهر السابق"
            />
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            شركة / وجهة IATA متصلة
            {kpis?.trends?.active_destinations_pct !== null &&
            kpis?.trends?.active_destinations_pct !== undefined ? (
              <span className="dir-ltr ms-1 inline-block font-mono">
                · {kpis.trends.active_destinations_pct > 0 ? '+' : ''}
                {kpis.trends.active_destinations_pct.toFixed(1)}% مسار
              </span>
            ) : (
              ''
            )}
          </p>
        </div>

        <div className="kpi-card-animate p-5 [animation-delay:180ms]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            أعداد المسافرين
          </p>
          <p className="kpi-value-fade mt-2 text-2xl font-semibold text-slate-400">
            غير منشور
          </p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            قيمة فارغة صارمة — لا توجد تقديرات اصطناعية للسعة
          </p>
        </div>
      </section>

      {/* Independent Coverage Separation */}
      {kpis && (
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-md border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                بُعد تغطية الجداول المجدولة
              </h3>
              <span className="text-xs font-medium text-sky-700 dark:text-sky-400">
                {kpis.schedule_coverage.status_ar || translateKpiStatus(kpis.schedule_coverage.status)}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-xs">
              <div>
                <dt className="text-slate-500 dark:text-slate-400">الأيام المتضمنة لسجلات الجداول</dt>
                <dd className="mt-1 font-mono text-base font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                  {kpis.schedule_coverage.scheduled_dates_count} يوماً
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">النطاق الزمني</dt>
                <dd className="dir-ltr mt-1 font-mono text-sm text-slate-900 tabular-nums dark:text-slate-100 inline-block">
                  {kpis.schedule_coverage.first_scheduled_date || '—'} →{' '}
                  {kpis.schedule_coverage.last_scheduled_date || '—'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                بُعد تغطية الأرصاد الفعلية
              </h3>
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                {kpis.observation_coverage.status_ar || translateKpiStatus(kpis.observation_coverage.status)}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-xs">
              <div>
                <dt className="text-slate-500 dark:text-slate-400">أيام الرصد الفعلي المسجلة</dt>
                <dd className="mt-1 font-mono text-base font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                  {kpis.observation_coverage.observed_dates_count} يوماً
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">خارج التواريخ المرصودة</dt>
                <dd className="mt-1 font-medium text-amber-700 dark:text-amber-400">
                  {kpis.observation_coverage.monitoring_outside_status_ar ||
                    translateKpiStatus(kpis.observation_coverage.monitoring_outside_status)}
                </dd>
              </div>
            </dl>
          </div>
        </section>
      )}

      {/* Monthly Summary Matrix */}
      <section className="rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              التفصيل الشهري حسب المطار (المرجع المعتمد للتصدير)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              تبقى خانات الجداول المجدولة وحركات ADS-B التجارية المرصودة مفصولة تماماً دون دمج
            </p>
          </div>
          <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {monthly.length} سجل
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-start text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-5 py-2.5 font-medium">الشهر</th>
                <th className="px-3 py-2.5 font-medium">المطار</th>
                <th className="px-3 py-2.5 font-medium text-end">مجدول</th>
                <th className="px-3 py-2.5 font-medium text-end">مرصود فعلياً</th>
                <th className="px-3 py-2.5 font-medium text-end">مشاركة رمز</th>
                <th className="px-3 py-2.5 font-medium text-end">غير موثق</th>
                <th className="px-5 py-2.5 font-medium">حالة الرصد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {monthly.map((row) => (
                <tr key={`${row.month}-${row.airport_id}`} className="h-10 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-5 py-2 font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {row.month}
                  </td>
                  <td className="px-3 py-2 font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {row.airport_id}{' '}
                    <span className="font-sans font-normal text-slate-400">
                      · {SYRIAN_AIRPORT_NAMES_AR[row.airport_id] || ''}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-end font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {row.scheduled_flights.toLocaleString('en-US')}
                  </td>
                  <td className="px-3 py-2 text-end font-mono tabular-nums">
                    {row.actual_movements !== null ? (
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        {row.actual_movements.toLocaleString('en-US')}
                      </span>
                    ) : (
                      <span className="text-slate-400">غير مرصود</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    {row.marketing_codeshares}
                  </td>
                  <td className="px-3 py-2 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    {row.unverified_movements}
                  </td>
                  <td className="px-5 py-2 text-slate-600 dark:text-slate-300">
                    {translateKpiStatus(row.observation_coverage_status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
