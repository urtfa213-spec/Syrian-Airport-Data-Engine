import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { HourlyDistributionChart } from './Charts';
import { TrendIndicator } from './TrendIndicator';
import { AnimatedStatValue } from './AnimatedStatValue';
import {
  WEEKDAY_AR,
  translateAirline,
  translateMovementType,
} from '../i18n/ar';

interface FidsSummary {
  summary: {
    total_archived_fids_records: number;
    scheduled_arrivals: number;
    scheduled_departures: number;
    calendar_days_covered: number;
    displayed_airline_brands_count: number;
    unique_scheduled_flight_numbers: number;
    duplicate_candidates_count: number;
    date_range: { earliest_scheduled_date: string; latest_scheduled_date: string };
  };
}

interface AirlineRow {
  displayed_airline_brand_en: string;
  displayed_airline_brand_ar: string;
  source_iata_code: string;
  total_displayed_records: number;
  arrival_records: number;
  departure_records: number;
  percentage_of_total: string;
  daily_frequency_active_days: number;
}

interface RouteRow {
  route_pair: string;
  movement_type: string;
  scheduled_records_count: number;
  unique_displayed_flight_numbers: number;
  airlines_list: string;
}

interface WeekdayRow {
  weekday_name: string;
  day_occurrences: number;
  total_flights: number;
  average_flights_per_weekday: number;
}

interface DailyRow {
  flight_date: string;
  total_scheduled_records: number;
  arrival_records: number;
  departure_records: number;
  unique_displayed_flight_numbers: number;
  unique_displayed_airline_brands: number;
  duplicate_candidates_count: number;
}

export function ArchivedFidsView() {
  const [direction, setDirection] = useState<'all' | 'arrival' | 'departure'>('all');
  const [summary, setSummary] = useState<FidsSummary | null>(null);
  const [hourly, setHourly] = useState<
    Array<{ hour_local: string; hour_label: string; arrivals: number; departures: number; total: number }>
  >([]);
  const [airlines, setAirlines] = useState<AirlineRow[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [weekdays, setWeekdays] = useState<WeekdayRow[]>([]);
  const [dailyRows, setDailyRows] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const qs = direction === 'all' ? '' : `?direction=${direction}`;
    Promise.all([
      fetch(`/api/archived-fids/summary${qs}`).then((r) => {
        if (!r.ok) throw new Error('تعذر تحميل ملخص شاشات FIDS المؤرشفة');
        return r.json();
      }),
      fetch(`/api/archived-fids/hourly${qs}`).then((r) => {
        if (!r.ok) throw new Error('تعذر تحميل التوزيع الساعي');
        return r.json();
      }),
      fetch(`/api/archived-fids/airlines${qs}`).then((r) => {
        if (!r.ok) throw new Error('تعذر تحميل بيانات الشركات المؤرشفة');
        return r.json();
      }),
      fetch(`/api/archived-fids/routes${qs}`).then((r) => {
        if (!r.ok) throw new Error('تعذر تحميل المسارات المؤرشفة');
        return r.json();
      }),
      fetch(`/api/archived-fids/weekly${qs}`).then((r) => {
        if (!r.ok) throw new Error('تعذر تحميل التوزيع الأسبوعي');
        return r.json();
      }),
      fetch(`/api/archived-fids/daily${qs}`).then((r) => {
        if (!r.ok) throw new Error('تعذر تحميل السجلات اليومية المؤرشفة');
        return r.json();
      }),
    ])
      .then(([sumRes, hrRes, alRes, rtRes, wkRes, dayRes]) => {
        if (!active) return;
        setSummary(sumRes);
        setHourly(Array.isArray(hrRes.hourly_distribution) ? hrRes.hourly_distribution : []);
        setAirlines(Array.isArray(alRes.airlines) ? alRes.airlines : []);
        setRoutes(Array.isArray(rtRes.top_routes) ? rtRes.top_routes : []);
        setWeekdays(Array.isArray(wkRes.weekday_distribution) ? wkRes.weekday_distribution : []);
        setDailyRows(Array.isArray(dayRes.daily_records) ? dayRes.daily_records : []);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'تعذر تحميل تحليلات FIDS المؤرشفة');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [direction, reloadTick]);

  const fidsTrends = useMemo(() => {
    const jul = dailyRows.filter((d) => d.flight_date.startsWith('2026-07'));
    const aug = dailyRows.filter((d) => d.flight_date.startsWith('2026-08'));
    if (jul.length === 0 || aug.length === 0) {
      return { totalDailyPct: null, arrDepDailyPct: null, brandsDailyPct: null, dupPct: null };
    }
    const avg = (arr: DailyRow[], pick: (r: DailyRow) => number) =>
      arr.reduce((sum, r) => sum + pick(r), 0) / arr.length;
    const pct = (curr: number, prev: number) =>
      prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : null;

    const julTotal = avg(jul, (r) => r.total_scheduled_records);
    const augTotal = avg(aug, (r) => r.total_scheduled_records);
    const julDir = avg(jul, (r) =>
      direction === 'arrival'
        ? r.arrival_records
        : direction === 'departure'
          ? r.departure_records
          : r.arrival_records + r.departure_records
    );
    const augDir = avg(aug, (r) =>
      direction === 'arrival'
        ? r.arrival_records
        : direction === 'departure'
          ? r.departure_records
          : r.arrival_records + r.departure_records
    );
    const julBrands = avg(jul, (r) => r.unique_displayed_airline_brands);
    const augBrands = avg(aug, (r) => r.unique_displayed_airline_brands);
    const julDups = avg(jul, (r) => r.duplicate_candidates_count);
    const augDups = avg(aug, (r) => r.duplicate_candidates_count);

    return {
      totalDailyPct: pct(augTotal, julTotal),
      arrDepDailyPct: pct(augDir, julDir),
      brandsDailyPct: pct(augBrands, julBrands),
      dupPct: pct(augDups, julDups),
    };
  }, [dailyRows, direction]);

  const s = summary?.summary;
  const exportHref =
    direction === 'all'
      ? '/api/archived-fids/export/csv?dataset=daily'
      : `/api/archived-fids/export/csv?dataset=daily&direction=${direction}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-900">
            {(['all', 'arrival', 'departure'] as const).map((dir) => (
              <button
                key={dir}
                onClick={() => setDirection(dir)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  direction === dir
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-50'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {dir === 'all' ? 'جميع الاتجاهات' : dir === 'arrival' ? 'القادمة' : 'المغادرة'}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            لقطة واي باك من <span className="dir-ltr font-mono inline-block">2026-07-05</span> إلى{' '}
            <span className="dir-ltr font-mono inline-block">2026-09-09</span> (عروض الجداول فقط، دون إثبات راداري فعلي)
          </span>
        </div>

        <a
          href={exportHref}
          className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Download className="h-3.5 w-3.5" />
          تصدير CSV يومي
        </a>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-md border border-red-900/60 bg-red-950/30 px-4 py-3 text-xs text-red-300">
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

      {/* KPI Strip */}
      <section className="grid grid-cols-1 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white sm:grid-cols-2 sm:divide-x rtl:sm:divide-x-reverse sm:divide-y-0 lg:grid-cols-4 dark:divide-slate-800 dark:border-slate-800 dark:bg-[#111827]">
        <div className="kpi-card-animate p-5 [animation-delay:0ms]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">سجلات FIDS المؤرشفة</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-50">
            <AnimatedStatValue value={s?.total_archived_fids_records ?? 0} loading={loading || !s} />
          </p>
          <div className="mt-1.5">
            <TrendIndicator pct={fidsTrends.totalDailyPct} comparisonLabel="متوسط أغسطس مقارنة بيوليو" />
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {s?.calendar_days_covered ?? 67} يوماً متتالياً · لوحة مطار دمشق
          </p>
        </div>
        <div className="kpi-card-animate p-5 [animation-delay:60ms]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">القادمة / المغادرة</p>
          <p className="dir-ltr mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-50 inline-block">
            <AnimatedStatValue
              value={
                s
                  ? `${s.scheduled_arrivals.toLocaleString('en-US')} / ${s.scheduled_departures.toLocaleString('en-US')}`
                  : '—'
              }
              loading={loading || !s}
            />
          </p>
          <div className="mt-1.5">
            <TrendIndicator pct={fidsTrends.arrDepDailyPct} comparisonLabel="متوسط أغسطس مقارنة بيوليو" />
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">جدول رحلات متوازن الاتجاه</p>
        </div>
        <div className="kpi-card-animate p-5 [animation-delay:120ms]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">شركات الطيران المعروضة</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-slate-50">
            <AnimatedStatValue value={s?.displayed_airline_brands_count ?? 0} loading={loading || !s} />
          </p>
          <div className="mt-1.5">
            <TrendIndicator pct={fidsTrends.brandsDailyPct} comparisonLabel="متوسط الشركات أغسطس/يوليو" />
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {s?.unique_scheduled_flight_numbers ?? 0} رقم رحلة فريد
          </p>
        </div>
        <div className="kpi-card-animate p-5 [animation-delay:180ms]">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">السجلات المكررة المحفوظة</p>
          <p className="mt-2 font-mono text-2xl font-semibold text-amber-700 tabular-nums dark:text-amber-400">
            <AnimatedStatValue value={s?.duplicate_candidates_count ?? 0} loading={loading || !s} />
          </p>
          <div className="mt-1.5">
            <TrendIndicator
              pct={fidsTrends.dupPct}
              positiveIsGood={false}
              comparisonLabel="متوسط أغسطس مقارنة بيوليو"
            />
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">محفوظة دون تعديل لأغراض التدقيق</p>
        </div>
      </section>

      {/* Hourly Damascus Wall-Clock Chart */}
      <section className="rounded-md border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
        <div className="mb-4 border-b border-slate-100 pb-3 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            توزيع الموجة التشغيلية على 24 ساعة بتوقيت دمشق المحلي (Asia/Damascus UTC+3)
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            مُجمّعة بدقة حسب ساعة دمشق المحلية الظاهرة في اللوحات قبل أي تحويل للتوقيت العالمي
          </p>
        </div>
        {loading && hourly.length === 0 ? (
          <div className="h-56 w-full animate-pulse rounded border border-slate-200 bg-slate-100/70 dark:border-slate-800 dark:bg-slate-900/60" />
        ) : (
          <HourlyDistributionChart hours={hourly} />
        )}
      </section>

      {/* Airlines + Routes + Weekdays */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
          <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              شركات الطيران المعروضة (شاشات دمشق FIDS)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-start text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-5 py-2.5 font-medium">الشركة الناقلة</th>
                  <th className="px-3 py-2.5 font-medium">IATA</th>
                  <th className="px-3 py-2.5 font-medium text-end">السجلات</th>
                  <th className="px-3 py-2.5 font-medium text-end">الحصة</th>
                  <th className="px-5 py-2.5 font-medium text-end">المعدل اليومي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {airlines.map((a) => (
                  <tr key={`${a.displayed_airline_brand_en}-${a.source_iata_code}`} className="h-10 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-5 py-2">
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {a.displayed_airline_brand_ar || translateAirline(a.displayed_airline_brand_en)}
                      </span>
                      <span className="ms-2 text-[11px] text-slate-500 dark:text-slate-400">
                        {a.displayed_airline_brand_en}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-300">
                      {a.source_iata_code || '—'}
                    </td>
                    <td className="px-3 py-2 text-end font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {a.total_displayed_records.toLocaleString('en-US')}
                    </td>
                    <td className="px-3 py-2 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {a.percentage_of_total}
                    </td>
                    <td className="px-5 py-2 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {a.daily_frequency_active_days}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
            <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                أبرز أزواج المسارات المجدولة
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-start text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="px-5 py-2.5 font-medium">الممر الجوي</th>
                    <th className="px-3 py-2.5 font-medium">الاتجاه</th>
                    <th className="px-3 py-2.5 font-medium text-end">السجلات</th>
                    <th className="px-5 py-2.5 font-medium">الشركات المشغلة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {routes.slice(0, 10).map((rt) => (
                    <tr key={`${rt.route_pair}-${rt.movement_type}`} className="h-10 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-5 py-2 font-mono font-semibold text-slate-900 dark:text-slate-100">
                        <span className="dir-ltr inline-block">{rt.route_pair}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {translateMovementType(rt.movement_type)}
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {rt.scheduled_records_count.toLocaleString('en-US')}
                      </td>
                      <td className="max-w-[200px] truncate px-5 py-2 text-slate-500 dark:text-slate-400">
                        {rt.airlines_list
                          .split(',')
                          .map((name) => translateAirline(name.trim()))
                          .join('، ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
            <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                الوتيرة الأسبوعية للرحلات المجدولة
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-start text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="px-5 py-2.5 font-medium">اليوم</th>
                    <th className="px-3 py-2.5 font-medium text-end">التكرارات</th>
                    <th className="px-3 py-2.5 font-medium text-end">الإجمالي</th>
                    <th className="px-5 py-2.5 font-medium text-end">المتوسط / يوم</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {weekdays.map((w) => (
                    <tr key={w.weekday_name} className="h-9 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-5 py-2 font-medium text-slate-900 dark:text-slate-100">
                        {WEEKDAY_AR[w.weekday_name] ?? w.weekday_name}
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {w.day_occurrences}
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {w.total_flights.toLocaleString('en-US')}
                      </td>
                      <td className="px-5 py-2 text-end font-mono tabular-nums text-sky-700 dark:text-sky-400">
                        {w.average_flights_per_weekday}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
