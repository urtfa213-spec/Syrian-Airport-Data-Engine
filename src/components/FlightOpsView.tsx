import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import type { EvidenceItem, FlightEvent } from '../types/aviation';
import {
  resolveArabicSearchToken,
  translateAirline,
  translateEvidenceLevel,
  translateEvidenceType,
  translateFlightStatus,
  translateLedgerStatus,
  translateMovementType,
  translateRecordNature,
} from '../i18n/ar';

interface FlightOpsViewProps {
  selectedAirport: string;
  initialAirport?: string;
  initialAirlineQuery?: string;
  initialMovementType?: string;
  initialRecordNature?: string;
  initialDestination?: string;
}

const RECORD_NATURES = [
  { key: '', label: 'جميع السجلات' },
  { key: 'physical_movement', label: 'حركات مرصودة' },
  { key: 'scheduled_service', label: 'مجدولة' },
  { key: 'marketing_codeshare', label: 'مشاركة رمز' },
  { key: 'unverified_movement', label: 'غير موثقة' },
];

export function FlightOpsView({
  selectedAirport,
  initialAirport,
  initialAirlineQuery = '',
  initialMovementType = '',
  initialRecordNature = '',
  initialDestination = '',
}: FlightOpsViewProps) {
  const resolveScopeAirport = (scope: string, override?: string) => {
    if (override !== undefined) return override === 'all' ? '' : override;
    return scope === 'all' ? '' : scope;
  };

  const [airport, setAirport] = useState(() => resolveScopeAirport(selectedAirport, initialAirport));
  const [destination, setDestination] = useState(initialDestination);
  const [recordNature, setRecordNature] = useState(initialRecordNature);
  const [movementType, setMovementType] = useState(initialMovementType);
  const [status, setStatus] = useState('');
  const [airlineQuery, setAirlineQuery] = useState(initialAirlineQuery);
  const [offset, setOffset] = useState(0);
  const limit = 40;

  const [flights, setFlights] = useState<FlightEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeEvent, setActiveEvent] = useState<FlightEvent | null>(null);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  useEffect(() => {
    setAirport(resolveScopeAirport(selectedAirport, initialAirport));
    setOffset(0);
  }, [selectedAirport, initialAirport]);

  useEffect(() => {
    if (initialAirlineQuery !== undefined) {
      setAirlineQuery(initialAirlineQuery);
      setOffset(0);
    }
  }, [initialAirlineQuery]);

  useEffect(() => {
    setMovementType(initialMovementType);
    setOffset(0);
  }, [initialMovementType]);

  useEffect(() => {
    setRecordNature(initialRecordNature);
    setOffset(0);
  }, [initialRecordNature]);

  useEffect(() => {
    setDestination(initialDestination);
    setOffset(0);
  }, [initialDestination]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (airport) p.set('airport_id', airport);
    if (destination) p.set('destination', destination);
    if (recordNature) p.set('record_nature', recordNature);
    if (movementType) p.set('movement_type', movementType);
    if (status) p.set('status', status);
    const trimmedQuery = airlineQuery.trim();
    if (trimmedQuery) {
      p.set('airline', resolveArabicSearchToken(trimmedQuery));
    }

    fetch(`/api/flights?${p.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('تعذر تحميل سجل أحداث الرحلات');
        return res.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setFlights(Array.isArray(data.flights) ? data.flights : []);
        setTotal(Number(data.total ?? 0));
      })
      .catch((err) => {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        setError(err instanceof Error ? err.message : 'تعذر جلب الرحلات');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [airport, destination, recordNature, movementType, status, airlineQuery, offset]);

  const openInspector = async (ev: FlightEvent) => {
    setActiveEvent(ev);
    setEvidence([]);
    setEvidenceLoading(true);
    try {
      const [detailRes, evRes] = await Promise.all([
        fetch(`/api/events/${encodeURIComponent(ev.event_id)}`),
        fetch(`/api/events/${encodeURIComponent(ev.event_id)}/evidence?include_retracted=true&forensic=true`),
      ]);
      if (detailRes.ok) {
        setActiveEvent(await detailRes.json());
      }
      if (evRes.ok) {
        const json = await evRes.json();
        setEvidence(Array.isArray(json.evidence) ? json.evidence : []);
      }
    } finally {
      setEvidenceLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-900">
            {RECORD_NATURES.map((rn) => (
              <button
                key={rn.key || 'all'}
                onClick={() => {
                  setRecordNature(rn.key);
                  setOffset(0);
                }}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  recordNature === rn.key
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-50'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {rn.label}
              </button>
            ))}
          </div>

          <select
            value={airport}
            onChange={(e) => {
              setAirport(e.target.value);
              setOffset(0);
            }}
            aria-label="تصفية حسب المطار"
            className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="">جميع المطارات</option>
            <option value="DAM">DAM · دمشق الدولي</option>
            <option value="ALP">ALP · حلب الدولي</option>
            <option value="DEZ">DEZ · دير الزور</option>
            <option value="LTK">LTK · اللاذقية الدولي</option>
            <option value="KAC">KAC · القامشلي</option>
          </select>

          <select
            value={movementType}
            onChange={(e) => {
              setMovementType(e.target.value);
              setOffset(0);
            }}
            aria-label="تصفية حسب الاتجاه"
            className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="">جميع الاتجاهات</option>
            <option value="arrival">القادمة</option>
            <option value="departure">المغادرة</option>
          </select>

          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
            aria-label="تصفية حسب الحالة"
            className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="">جميع الحالات</option>
            <option value="landed">هبطت</option>
            <option value="active">في الجو</option>
            <option value="scheduled">مجدولة</option>
            <option value="cancelled">ملغاة</option>
            <option value="diverted">محوّلة</option>
          </select>

          {destination && (
            <button
              type="button"
              onClick={() => {
                setDestination('');
                setOffset(0);
              }}
              className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300 hover:bg-amber-500/20 whitespace-nowrap"
            >
              <span>المسار: <span className="font-mono">{destination.split(',').filter(Boolean).join('، ')}</span></span>
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="relative min-w-[250px]">
          <Search className="pointer-events-none absolute start-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={airlineQuery}
            onChange={(e) => {
              setAirlineQuery(e.target.value);
              setOffset(0);
            }}
            placeholder="ابحث برقم الرحلة، الشركة، IATA، أو المدينة..."
            className="w-full rounded border border-slate-200 bg-white py-1.5 ps-8 pe-7 text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          {airlineQuery && (
            <button
              type="button"
              onClick={() => {
                setAirlineQuery('');
                setOffset(0);
              }}
              aria-label="مسح نص البحث"
              className="absolute end-2 top-1.5 rounded p-0.5 text-slate-400 hover:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Flight Events Data Grid */}
      <div className="rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 text-xs dark:border-slate-800">
          <span className="font-medium text-slate-700 dark:text-slate-200">
            سجل أحداث الرحلات الموحد · انقر على أي صف للفحص الجنائي للطوابع الزمنية والإثباتات
          </span>
          <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {total.toLocaleString('en-US')} سجل مطابق
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-start text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-4 py-2.5 font-medium">التاريخ</th>
                <th className="px-3 py-2.5 font-medium">المطار</th>
                <th className="px-3 py-2.5 font-medium">الرحلة</th>
                <th className="px-3 py-2.5 font-medium">شركة الطيران</th>
                <th className="px-3 py-2.5 font-medium">المسار</th>
                <th className="px-3 py-2.5 font-medium">التصنيف</th>
                <th className="px-3 py-2.5 font-medium">الحالة</th>
                <th className="px-3 py-2.5 font-medium">المجدول / الفعلي</th>
                <th className="px-4 py-2.5 font-medium text-end">أرصاد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {loading ? (
                Array.from({ length: 10 }).map((_, idx) => (
                  <tr key={idx} className="h-10">
                    <td colSpan={9} className="px-4 py-2">
                      <div className="h-4 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                    </td>
                  </tr>
                ))
              ) : flights.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                    لا توجد سجلات رحلات تطابق معايير التصفية المختارة.{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setAirport('');
                        setDestination('');
                        setRecordNature('');
                        setMovementType('');
                        setStatus('');
                        setAirlineQuery('');
                        setOffset(0);
                      }}
                      className="font-medium text-sky-700 underline dark:text-sky-400"
                    >
                      إعادة ضبط الفلاتر
                    </button>
                  </td>
                </tr>
              ) : (
                flights.map((f) => {
                  const nat = translateRecordNature(f.record_nature);
                  const schedTime = f.movement_type === 'arrival' ? f.scheduled_arr_time : f.scheduled_dep_time;
                  const actTime = f.movement_type === 'arrival' ? f.actual_arr_time : f.actual_dep_time;
                  const route =
                    f.movement_type === 'arrival'
                      ? `${f.connected_airport_iata || '—'} → ${f.airport_id}`
                      : `${f.airport_id} → ${f.connected_airport_iata || '—'}`;
                  return (
                    <tr
                      key={f.event_id}
                      onClick={() => void openInspector(f)}
                      className="h-10 cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <td className="px-4 py-2 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {f.flight_date}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        <span className="font-mono">{f.airport_id}</span>
                        <span className="ms-1.5 text-[11px] font-normal text-slate-400">
                          {translateMovementType(f.movement_type)}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {f.flight_number || '—'}
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2 text-slate-700 dark:text-slate-200">
                        {translateAirline(f.airline_name)}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        <span className="dir-ltr inline-block">{route}</span>
                      </td>
                      <td className={`px-3 py-2 font-medium whitespace-nowrap ${nat.tone}`}>
                        {nat.text}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                        {translateFlightStatus(f.flight_status)}
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        <span className="dir-ltr inline-block">
                          {schedTime ? schedTime.slice(11, 16) : '--:--'}
                          <span className="mx-1 text-slate-400">/</span>
                          <span className={actTime ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400'}>
                            {actTime ? actTime.slice(11, 16) : '—'}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-2 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {f.independent_observation_count}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
          <span className="font-mono tabular-nums">
            عرض <span className="dir-ltr inline-block">{total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)}</span> من أصل {total.toLocaleString('en-US')}
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
              className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 font-medium disabled:opacity-40 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" /> السابق
            </button>
            <button
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
              className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 font-medium disabled:opacity-40 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              التالي <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
            </button>
          </div>
        </div>
      </div>

      {/* Forensic Inspector Drawer */}
      {activeEvent && (
        <div
          onClick={() => setActiveEvent(null)}
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-[1px]"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-2xl flex-col border-s border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-[#0F172A]"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  <span className="dir-ltr font-mono inline-block">
                    {activeEvent.flight_number || activeEvent.event_id} · {activeEvent.airport_id}
                  </span>{' '}
                  · {translateMovementType(activeEvent.movement_type)}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {translateAirline(activeEvent.airline_name)} ·{' '}
                  <span className="dir-ltr font-mono inline-block">{activeEvent.flight_date}</span> · معرف الحدث{' '}
                  <span className="dir-ltr font-mono inline-block">{activeEvent.event_id}</span>
                </p>
              </div>
              <button
                onClick={() => setActiveEvent(null)}
                aria-label="إغلاق الفحص الجنائي"
                className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto p-6 text-xs">
              <div>
                <h4 className="mb-2 font-semibold text-slate-900 dark:text-slate-100">
                  أصل الحقول الزمنية الستة المنفصلة
                </h4>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-slate-200 bg-slate-200 dark:border-slate-800 dark:bg-slate-800">
                  {[
                    ['المغادرة المجدولة', activeEvent.scheduled_dep_time],
                    ['الوصول المجدول', activeEvent.scheduled_arr_time],
                    ['المغادرة التقديرية', activeEvent.estimated_dep_time],
                    ['الوصول التقديري', activeEvent.estimated_arr_time],
                    ['المغادرة الفعلية', activeEvent.actual_dep_time],
                    ['الوصول الفعلي', activeEvent.actual_arr_time],
                  ].map(([label, val]) => (
                    <div key={String(label)} className="bg-white p-3 dark:bg-[#111827]">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
                      <div className="dir-ltr mt-1 font-mono text-slate-900 tabular-nums dark:text-slate-100 inline-block">
                        {val || 'غير مسجل (null)'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-semibold text-slate-900 dark:text-slate-100">
                  البيانات التشغيلية وبيانات الهيكل الجوي
                </h4>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">طبيعة السجل</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">
                      {translateRecordNature(activeEvent.record_nature).text}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">مستوى الإثبات</dt>
                    <dd className="text-slate-900 dark:text-slate-100">
                      {translateEvidenceLevel(activeEvent.evidence_level)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">طراز الطائرة / التسجيل</dt>
                    <dd className="dir-ltr font-mono text-slate-900 dark:text-slate-100 inline-block">
                      {activeEvent.aircraft_model || '—'} / {activeEvent.aircraft_registration || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">رمز ICAO24 السداسي</dt>
                    <dd className="dir-ltr font-mono text-slate-900 dark:text-slate-100 inline-block">
                      {activeEvent.aircraft_icao24 || 'غير متوفر'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">توقيت الرصد المصدري (UTC)</dt>
                    <dd className="dir-ltr font-mono text-slate-900 dark:text-slate-100 inline-block">
                      {activeEvent.source_observed_at || 'غير متوفر'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">تاريخ الاستيعاب</dt>
                    <dd className="dir-ltr font-mono text-slate-900 dark:text-slate-100 inline-block">
                      {activeEvent.ingested_at || 'غير متوفر'}
                    </dd>
                  </div>
                </dl>
              </div>

              <div>
                <h4 className="mb-2 font-semibold text-slate-900 dark:text-slate-100">
                  دفتر الإثباتات غير القابل للتعديل ({evidence.length} عنصر)
                </h4>
                {evidenceLoading ? (
                  <div className="h-24 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                ) : evidence.length === 0 ? (
                  <p className="text-slate-500 dark:text-slate-400">لا توجد صفوف إثبات نشطة أو مسحوبة مرتبطة.</p>
                ) : (
                  <div className="divide-y divide-slate-200 rounded border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                    {evidence.map((item) => (
                      <div key={item.evidence_id} className="space-y-1 p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {translateEvidenceType(item.evidence_type)}
                          </span>
                          <span
                            className={
                              item.ledger_status === 'active'
                                ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                                : 'text-red-700 dark:text-red-400 font-medium'
                            }
                          >
                            {translateLedgerStatus(item.ledger_status)}
                          </span>
                        </div>
                        <div className="text-slate-600 dark:text-slate-300">
                          المصدر: <span className="font-mono">{item.source_name}</span> · القيمة:{' '}
                          <span className="dir-ltr font-mono inline-block">{item.observed_value || '—'}</span>
                        </div>
                        {item.is_estimated && (
                          <div className="text-amber-700 dark:text-amber-400">
                            تم تطبيق تصحيح دلالي عند القراءة: التصنيف الأصلي{' '}
                            <span className="font-mono">{item.original_evidence_type}</span> (من الحقل{' '}
                            <span className="font-mono">{item.original_raw_source_field || 'حقل تقديري'}</span>)
                          </div>
                        )}
                        {item.retraction_reason && (
                          <div className="text-red-700 dark:text-red-400">
                            مسحوب: {item.retraction_reason}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
