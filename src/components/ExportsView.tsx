import { useState } from 'react';
import { Download, Eye, X } from 'lucide-react';

interface DatasetEntry {
  key: string;
  title: string;
  scope: string;
  period: string;
  description: string;
  supportsXlsx?: boolean;
  xlsxEndpoint?: string;
}

const DATASETS: DatasetEntry[] = [
  {
    key: 'all_syrian_flight_events',
    title: 'أحداث رحلات جميع المطارات السورية',
    scope: 'DAM, ALP, LTK, DEZ, KAC',
    period: '2026-07-05 → 2026-10-10',
    description: 'الأحداث التشغيلية الموحّدة وخانات الجداول المجدولة عبر كافة المطارات السورية.',
    supportsXlsx: true,
    xlsxEndpoint: '/api/air-traffic/export/events',
  },
  {
    key: 'damascus_flight_events',
    title: 'أحداث رحلات مطار دمشق الدولي',
    scope: 'DAM / OSDI',
    period: '2026-07-05 → 2026-10-10',
    description: 'سجلات رحلات دمشق التفصيلية مع فصل تام للطوابع الزمنية المجدولة والتقديرية والفعلية.',
  },
  {
    key: 'daily_airport_movements',
    title: 'الملخص اليومي لحركات المطارات',
    scope: 'جميع المطارات السورية',
    period: '2026-07-05 → 2026-10-10',
    description: 'إجماليات الحركة اليومية مقسمة حسب كل مطار سوري.',
  },
  {
    key: 'historical_2024',
    title: 'إجمالي البوابة الجويّة 2024 — المرصد الاقتصادي السوري',
    scope: 'DAM_ALP_LTK (3 مطارات مجمّعة)',
    period: '2024-01-01 → 2024-10-15',
    description: 'السلسلة الزمنية الإقليمية المجمّعة الصادرة عن البنك الدولي / Data Partnership.',
  },
  {
    key: 'historical_coverage_matrix',
    title: 'مصفوفة التغطية التاريخية (2024–2026)',
    scope: 'DAM, ALP, LTK, DEZ, KAC',
    period: '2024-01-01 → 2026-10-11',
    description: 'تصنيف يومي من 5 مستويات يفصل التغطية الموثقة والجداول المجدولة وفجوات البيانات.',
  },
  {
    key: 'v2_19_2_physical_movement_audit',
    title: 'تدقيق أصل الحركات التشغيلية',
    scope: '131 سجل physical_movement',
    period: '2026-10-09 → 2026-10-10',
    description: 'تدقيق جنائي يؤكد المصدر التجاري المبلّغ عن الحركات التشغيلية.',
  },
  {
    key: 'v2_20_6_mislabeled_evidence_audit',
    title: 'سجل تدقيق الإثباتات المعاد تصنيفها',
    scope: '76 صف إثبات مصحح',
    period: '2026-10-09 → 2026-10-10',
    description: 'جرد لصفوف الإثبات المشتقة من الحقول التقديرية والتي جرى تصحيحها عند القراءة.',
  },
  {
    key: 'syrian_airports',
    title: 'السجل المعتمد للمطارات السورية',
    scope: '7 مطارات سورية',
    period: '2026-10-11',
    description: 'أبعاد المدارج والإحداثيات والارتفاع عن سطح البحر والتصنيفات المدنية والعسكرية.',
  },
];

export function ExportsView() {
  const [selectedMeta, setSelectedMeta] = useState<Record<string, unknown> | null>(null);
  const [metaKey, setMetaKey] = useState<string | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const inspectMetadata = async (key: string) => {
    setMetaKey(key);
    setMetaError(null);
    try {
      const res = await fetch(`/api/export/${encodeURIComponent(key)}/metadata`);
      if (!res.ok) throw new Error(`تعذر جلب ملف البيانات الوصفية للمجموعة ${key}`);
      setSelectedMeta(await res.json());
    } catch (err) {
      setSelectedMeta(null);
      setMetaError(err instanceof Error ? err.message : 'تعذر تحميل ملف البيانات الوصفية');
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            تصدير مجموعات البيانات المقروءة آلياً وملفات التعريف المرافقة
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            يتضمن كل ملف CSV أو JSON أو XLSX توثيقاً صريحاً للنطاق الجغرافي وفترة الرصد والقيود المنهجية المعروفة.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-start text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-5 py-2.5 font-medium">مجموعة البيانات</th>
                <th className="px-3 py-2.5 font-medium">النطاق الجغرافي</th>
                <th className="px-3 py-2.5 font-medium">نافذة الرصد</th>
                <th className="px-5 py-2.5 font-medium text-end">التنزيل والبيانات الوصفية</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {DATASETS.map((ds) => (
                <tr key={ds.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{ds.title}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{ds.description}</div>
                  </td>
                  <td className="px-3 py-3.5 text-slate-700 dark:text-slate-300">
                    <span className="font-mono">{ds.scope}</span>
                  </td>
                  <td className="px-3 py-3.5 font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    <span className="dir-ltr inline-block">{ds.period}</span>
                  </td>
                  <td className="px-5 py-3.5 text-end whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <a
                        href={`/api/export/${ds.key}?format=csv&include_metadata=true`}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Download className="h-3 w-3" /> CSV
                      </a>
                      <a
                        href={`/api/export/${ds.key}?format=json&include_metadata=true`}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        JSON
                      </a>
                      {ds.supportsXlsx && ds.xlsxEndpoint && (
                        <a
                          href={`${ds.xlsxEndpoint}?format=xlsx`}
                          className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 px-2.5 py-1 font-medium text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300"
                        >
                          XLSX
                        </a>
                      )}
                      <button
                        onClick={() => void inspectMetadata(ds.key)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 font-medium text-sky-700 hover:underline dark:text-sky-400"
                      >
                        <Eye className="h-3 w-3" /> ملف التعريف
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {metaError && (
        <div className="rounded-md border border-red-900/60 bg-red-950/30 px-4 py-3 text-xs text-red-300">
          {metaError}
        </div>
      )}

      {selectedMeta && (
        <section className="rounded-md border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
          <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              ملف البيانات الوصفية المرافق · <span className="font-mono">{metaKey}</span>
            </h3>
            <div className="flex items-center gap-3">
              <a
                href={`/api/export/${metaKey}/sidecar`}
                className="text-xs font-medium text-sky-700 hover:underline dark:text-sky-400"
              >
                تنزيل <span className="dir-ltr font-mono inline-block">.metadata.json</span>
              </a>
              <button
                type="button"
                onClick={() => {
                  setSelectedMeta(null);
                  setMetaKey(null);
                }}
                aria-label="إغلاق ملف البيانات الوصفية"
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <pre
            dir="ltr"
            className="overflow-x-auto text-left font-mono text-xs leading-relaxed text-slate-700 dark:text-slate-300"
          >
            {JSON.stringify(selectedMeta, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
