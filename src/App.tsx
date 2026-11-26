import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Archive,
  ArrowUpDown,
  Building2,
  Database,
  Download,
  FileSpreadsheet,
  Filter,
  GitFork,
  Globe,
  Grid3X3,
  LayoutGrid,
  Menu,
  Minus,
  Plane,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Table2,
  X,
} from 'lucide-react';
import type {
  AirportRecord,
  AirTrafficKpisResponse,
  ComparisonDay,
  CorridorsResponse,
  CountryChoroplethStat,
  CoverageDailyCell,
  CoverageMonthlyCell,
  FlightCorridor,
  MovementStatsResponse,
  WorkspaceView,
} from './types/aviation';
import type { MatrixPoint } from './components/DottedMatrixChart';
import {
  NetworkGraphCanvas,
  type CategoryKey,
  type CategoryNode,
  type LeafNode,
} from './components/NetworkGraphCanvas';
import { CorridorMapCanvas, type MapMetricMode } from './components/CorridorMapCanvas';
import { CoverageMatrixHeatmap } from './components/CoverageMatrixHeatmap';
import { InspectorPanel, type InspectorData } from './components/InspectorPanel';
import { OverviewView } from './components/OverviewView';
import { FlightOpsView } from './components/FlightOpsView';
import { MonitorView } from './components/MonitorView';
import { ArchivedFidsView } from './components/ArchivedFidsView';
import { CoverageAuditView } from './components/CoverageAuditView';
import { ExportsView } from './components/ExportsView';
import {
  normalizeArabicText,
  resolveArabicSearchToken,
  SYRIAN_AIRPORT_NAMES_AR,
  SYRIAN_CITY_SHORT_AR,
  translateAirline,
  translateAirportType,
  translateCarrierRole,
  translateCity,
  translateCountry,
  translateCoverageClass,
  translateOperationalStatus,
} from './i18n/ar';

interface FidsAirlineRow {
  displayed_airline_brand_ar: string;
  displayed_airline_brand_en: string;
  source_iata_code: string | null;
  carrier_role_classification: string;
  total_displayed_records: number;
  arrival_records: number;
  departure_records: number;
  distinct_flight_numbers: number;
  active_days_count: number;
  first_active_date: string;
  last_active_date: string;
  percentage_of_total: string;
  percentage_value: number;
  daily_frequency_active_days: number;
}

interface FidsDailyRow {
  flight_date: string;
  total_scheduled_records: number;
  arrival_records: number;
  departure_records: number;
}

interface TimelineMonthRow {
  source_period: string;
  geographic_scope: string;
  dataset_category: string;
  evidence_level: string;
  record_count: number;
  explicit_warning: string;
  is_dam_specific: boolean;
}

interface AuditResponse {
  audit_version: string;
  total_mislabeled_evidence_records: number;
  original_takeoffs_reclassified: number;
  original_touchdowns_reclassified: number;
  immutable_ledger_policy: string;
}

interface FidsSummaryResponse {
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

const WORKSPACE_NAV: Array<{ id: WorkspaceView; label: string; shortLabel: string; icon: typeof GitFork }> = [
  { id: 'explorer', label: 'المستكشف المكاني والخريطة', shortLabel: 'المستكشف', icon: GitFork },
  { id: 'flights', label: 'سجل أحداث الرحلات', shortLabel: 'سجل الرحلات', icon: Plane },
  { id: 'monitor', label: 'مراقب الحركة الجوية', shortLabel: 'المراقب', icon: Activity },
  { id: 'fids', label: 'تحليلات FIDS المؤرشفة', shortLabel: 'أرشيف FIDS', icon: Archive },
  { id: 'coverage', label: 'تدقيق التغطية والإثباتات', shortLabel: 'التغطية', icon: ShieldCheck },
  { id: 'overview', label: 'نظرة عامة على العمليات', shortLabel: 'النظرة العامة', icon: LayoutGrid },
  { id: 'exports', label: 'التصدير والملفات الوصفية', shortLabel: 'التصدير', icon: FileSpreadsheet },
];

const AIRPORT_SCOPE_LIST = [
  { id: 'all', label: 'جميع المطارات السورية' },
  { id: 'DAM', label: 'DAM · دمشق الدولي' },
  { id: 'ALP', label: 'ALP · حلب الدولي' },
  { id: 'DEZ', label: 'DEZ · دير الزور' },
  { id: 'LTK', label: 'LTK · اللاذقية الدولي' },
  { id: 'KAC', label: 'KAC · القامشلي' },
];

type RecordFilterMode = 'all' | 'observed' | 'scheduled';
type DirectionFilterMode = 'all' | 'arrival' | 'departure';
type SpatialMode = 'graph' | 'map' | 'heatmap';

export default function App() {
  const [activeView, setActiveView] = useState<WorkspaceView>('explorer');
  const [spatialMode, setSpatialMode] = useState<SpatialMode>('graph');
  const [selectedAirport, setSelectedAirport] = useState<string>('all');
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);

  // Spatial Explorer state
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('airlines');
  const [selectedLeafId, setSelectedLeafId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [recordFilter, setRecordFilter] = useState<RecordFilterMode>('all');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilterMode>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // D3 Corridor Map state
  const [corridorsData, setCorridorsData] = useState<CorridorsResponse | null>(null);
  const [corridorsLoading, setCorridorsLoading] = useState<boolean>(true);
  const [mapMetricMode, setMapMetricMode] = useState<MapMetricMode>('combined');
  const [selectedCorridor, setSelectedCorridor] = useState<FlightCorridor | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<CountryChoroplethStat | null>(null);
  const [mapResetSignal, setMapResetSignal] = useState<number>(0);

  // Coverage Matrix Heatmap inspector state
  const [selectedHeatmapDay, setSelectedHeatmapDay] = useState<CoverageDailyCell | null>(null);
  const [selectedHeatmapMonth, setSelectedHeatmapMonth] = useState<CoverageMonthlyCell | null>(null);

  // Pre-filter bridge when jumping from Inspector/Query bar into FlightOpsView
  const [ledgerPrefill, setLedgerPrefill] = useState<{
    airportId: string;
    airlineQuery: string;
    movementType: string;
    recordNature: string;
    destination: string;
  }>({ airportId: '', airlineQuery: '', movementType: '', recordNature: '', destination: '' });

  // Live backend data for Network Explorer & Inspector
  const [airports, setAirports] = useState<AirportRecord[]>([]);
  const [stats, setStats] = useState<MovementStatsResponse | null>(null);
  const [comparison, setComparison] = useState<ComparisonDay[]>([]);
  const [kpis, setKpis] = useState<AirTrafficKpisResponse | null>(null);
  const [fidsSummary, setFidsSummary] = useState<FidsSummaryResponse['summary'] | null>(null);
  const [fidsAirlines, setFidsAirlines] = useState<FidsAirlineRow[]>([]);
  const [fidsDaily, setFidsDaily] = useState<FidsDailyRow[]>([]);
  const [timeline, setTimeline] = useState<TimelineMonthRow[]>([]);
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [loadingExplorer, setLoadingExplorer] = useState<boolean>(true);

  const searchInputFocusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  // Fetch core telemetry & explorer data
  useEffect(() => {
    let active = true;
    setLoadingExplorer(true);

    const kpiQuery = selectedAirport !== 'all' ? `?airport_id=${encodeURIComponent(selectedAirport)}` : '';

    Promise.all([
      fetch('/api/airports').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/movements/stats').then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/movements/comparison?airport_id=${encodeURIComponent(selectedAirport)}`).then((r) =>
        r.ok ? r.json() : { comparison: [] }
      ),
      fetch(`/api/air-traffic/kpis${kpiQuery}`).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/archived-fids/summary').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/archived-fids/airlines').then((r) => (r.ok ? r.json() : { airlines: [] })),
      fetch('/api/archived-fids/daily').then((r) => (r.ok ? r.json() : { daily_records: [] })),
      fetch('/api/historical-coverage/timeline').then((r) => (r.ok ? r.json() : { timeline: [] })),
      fetch('/api/evidence/audit').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([apJson, stJson, cmpJson, kpiJson, fSumJson, fAirJson, fDayJson, tlJson, audJson]) => {
        if (!active) return;
        setAirports(Array.isArray(apJson) ? apJson : []);
        setStats(stJson);
        setComparison(Array.isArray(cmpJson?.comparison) ? cmpJson.comparison : []);
        setKpis(kpiJson);
        setFidsSummary(fSumJson?.summary ?? null);
        setFidsAirlines(Array.isArray(fAirJson?.airlines) ? fAirJson.airlines : []);
        setFidsDaily(Array.isArray(fDayJson?.daily_records) ? fDayJson.daily_records : []);
        setTimeline(Array.isArray(tlJson?.timeline) ? tlJson.timeline : []);
        setAudit(audJson);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingExplorer(false);
      });

    return () => {
      active = false;
    };
  }, [selectedAirport]);

  // Dynamically fetch active D3 flight corridors & country choropleth whenever airport or filters change
  useEffect(() => {
    let active = true;
    setCorridorsLoading(true);
    const p = new URLSearchParams({ airport_id: selectedAirport });
    if (recordFilter === 'observed') p.set('record_nature', 'physical_movement');
    else if (recordFilter === 'scheduled') p.set('record_nature', 'scheduled_service');
    if (directionFilter !== 'all') p.set('movement_type', directionFilter);

    fetch(`/api/corridors?${p.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: CorridorsResponse | null) => {
        if (!active || !json) return;
        setCorridorsData(json);
        // Clear stale corridor selection if not in updated corridor set
        setSelectedCorridor((prev) =>
          prev && json.corridors.some((c) => c.id === prev.id) ? prev : null
        );
        setSelectedCountry((prev) =>
          prev && json.country_totals.some((c) => c.country_iso_num === prev.country_iso_num) ? prev : null
        );
      })
      .catch(() => {})
      .finally(() => {
        if (active) setCorridorsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedAirport, recordFilter, directionFilter]);

  const compTotals = useMemo(
    () =>
      comparison.reduce(
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
      ),
    [comparison]
  );

  const aptBreakdownMap = useMemo(() => {
    const map = new Map<string, { cnt: number; min_date: string; max_date: string; dates_count: number }>();
    if (stats?.airport_events_breakdown) {
      for (const b of stats.airport_events_breakdown) {
        map.set(b.airport_id, b);
      }
    }
    return map;
  }, [stats]);

  // Level-1 5 Category Nodes
  const categories: CategoryNode[] = useMemo(() => {
    const totalAerodromes = airports.length || 7;
    const airlinesCount = fidsAirlines.length || stats?.total_unique_airlines || 14;
    const routesCount = corridorsData?.summary?.active_corridors || stats?.top_connected_airports?.length || 12;
    const timelineCount = timeline.length || 34;

    return [
      {
        key: 'airports',
        countLabel: String(totalAerodromes),
        label: 'المطارات السورية',
        subtitle: 'المحاور المسجلة',
      },
      {
        key: 'layers',
        countLabel: '4',
        label: 'طبقات الإثبات',
        subtitle: 'مستويات مفصولة',
      },
      {
        key: 'airlines',
        countLabel: String(airlinesCount),
        label: 'شركات أرشيف FIDS',
        subtitle: 'العلامات المعروضة',
      },
      {
        key: 'routes',
        countLabel: String(routesCount),
        label: 'الممرات المتصلة',
        subtitle: 'أزواج المغادرة/الوصول',
      },
      {
        key: 'audits',
        countLabel: String(timelineCount),
        label: 'التغطية والتدقيق',
        subtitle: 'أشهر مدققة',
      },
    ];
  }, [airports.length, corridorsData?.summary?.active_corridors, fidsAirlines.length, stats, timeline.length]);

  // Build Level-2 Leaves per Category from real API payloads
  const leavesByCategory: Record<CategoryKey, LeafNode[]> = useMemo(() => {
    const airportLeaves: LeafNode[] = airports.map((ap) => {
      const bd = aptBreakdownMap.get(ap.airport_id);
      const cnt = bd?.cnt ?? 0;
      const isActiveHub = cnt > 0;
      const code = ap.iata_code || ap.icao_code;
      const cityLabel = SYRIAN_CITY_SHORT_AR[ap.airport_id] || ap.city_ar || translateCity(ap.city);
      return {
        id: `apt:${ap.airport_id}`,
        category: 'airports',
        title: `${code} · ${cityLabel}`,
        metricLabel: isActiveHub ? `${cnt.toLocaleString('en-US')} حدث` : translateAirportType(ap.airport_type),
        metricValue: cnt,
        barsCount: cnt > 500 ? 3 : cnt > 0 ? 2 : 1,
        tone: cnt > 500 ? 'emerald' : cnt > 0 ? 'sky' : 'amber',
        meta: {
          airport: ap,
          breakdown: bd ?? null,
          searchBlob: [ap.airport_id, ap.iata_code, ap.icao_code, ap.name, ap.name_ar, ap.city, ap.city_ar, cityLabel]
            .filter(Boolean)
            .join(' '),
        },
      };
    });

    const layerLeaves: LeafNode[] = [
      {
        id: 'layer:physical_movement',
        category: 'layers',
        title: 'الأحداث التشغيلية المرصودة',
        metricLabel: `${compTotals.operational.toLocaleString('en-US')} حركة`,
        metricValue: compTotals.operational,
        barsCount: 3,
        tone: 'emerald',
        meta: { layer: 'physical_movement', count: compTotals.operational },
      },
      {
        id: 'layer:scheduled_service',
        category: 'layers',
        title: 'خانات الجداول المجدولة',
        metricLabel: `${compTotals.scheduled.toLocaleString('en-US')} مجدول`,
        metricValue: compTotals.scheduled,
        barsCount: 3,
        tone: 'sky',
        meta: { layer: 'scheduled_service', count: compTotals.scheduled },
      },
      {
        id: 'layer:marketing_codeshare',
        category: 'layers',
        title: 'إدراجات مشاركة الرمز',
        metricLabel: `${compTotals.codeshares.toLocaleString('en-US')} رمز مشترك`,
        metricValue: compTotals.codeshares,
        barsCount: 2,
        tone: 'amber',
        meta: { layer: 'marketing_codeshare', count: compTotals.codeshares },
      },
      {
        id: 'layer:unverified_movement',
        category: 'layers',
        title: 'حركات لوحة غير موثقة',
        metricLabel: `${compTotals.unverified.toLocaleString('en-US')} غير موثق`,
        metricValue: compTotals.unverified,
        barsCount: 1,
        tone: 'red',
        meta: { layer: 'unverified_movement', count: compTotals.unverified },
      },
      {
        id: 'layer:archived_fids',
        category: 'layers',
        title: 'أرشيف واي باك FIDS (دمشق)',
        metricLabel: `${(fidsSummary?.total_archived_fids_records ?? 6923).toLocaleString('en-US')} FIDS`,
        metricValue: fidsSummary?.total_archived_fids_records ?? 6923,
        barsCount: 3,
        tone: 'sky',
        meta: { layer: 'archived_fids', count: fidsSummary?.total_archived_fids_records ?? 6923 },
      },
      {
        id: 'layer:historical_2024',
        category: 'layers',
        title: 'الإجمالي الإقليمي 2024 (DAM_ALP_LTK)',
        metricLabel: `${(stats?.historical_2024_rows ?? 438).toLocaleString('en-US')} إجمالي`,
        metricValue: stats?.historical_2024_rows ?? 438,
        barsCount: 2,
        tone: 'amber',
        meta: { layer: 'historical_2024', count: stats?.historical_2024_rows ?? 438 },
      },
    ];

    const airlineLeaves: LeafNode[] = fidsAirlines.map((al) => {
      const count =
        directionFilter === 'arrival'
          ? al.arrival_records
          : directionFilter === 'departure'
            ? al.departure_records
            : al.total_displayed_records;
      const pct = al.percentage_value;
      const arName = al.displayed_airline_brand_ar || translateAirline(al.displayed_airline_brand_en);
      return {
        id: `airline:${al.displayed_airline_brand_en}`,
        category: 'airlines',
        title: `${arName}${al.source_iata_code ? ` (${al.source_iata_code})` : ''}`,
        metricLabel: `${pct.toFixed(1)}% · ${count.toLocaleString('en-US')}`,
        metricValue: count,
        barsCount: pct >= 15 ? 3 : pct >= 4 ? 2 : 1,
        tone: pct >= 15 ? 'emerald' : pct >= 4 ? 'sky' : 'amber',
        meta: {
          airline: al,
          searchBlob: [al.displayed_airline_brand_en, al.displayed_airline_brand_ar, arName, al.source_iata_code]
            .filter(Boolean)
            .join(' '),
        },
      };
    });

    const routeLeaves: LeafNode[] = (corridorsData?.corridors ?? []).map((corr) => ({
      id: `route:${corr.id}`,
      category: 'routes',
      title: `${corr.origin_iata} ↔ ${corr.destination_iata} (${translateCity(corr.destination_city)})`,
      metricLabel: `${(corr.total_events + corr.fids_slots).toLocaleString('en-US')} حدث`,
      metricValue: corr.total_events + corr.fids_slots,
      barsCount: corr.observed_events >= 5 ? 3 : corr.total_events > 20 ? 2 : 1,
      tone: corr.observed_events >= 5 ? 'emerald' : corr.total_events > 0 ? 'sky' : 'amber',
      meta: {
        corridor: corr,
        searchBlob: [
          corr.origin_iata,
          corr.origin_city,
          translateCity(corr.origin_city),
          corr.destination_iata,
          corr.destination_city,
          translateCity(corr.destination_city),
          corr.country_name,
          translateCountry(corr.country_name),
          ...corr.airlines.flatMap((a) => [a, translateAirline(a)]),
        ]
          .filter(Boolean)
          .join(' '),
      },
    }));

    const auditLeaves: LeafNode[] = [
      {
        id: 'audit:evidence_reclassification',
        category: 'audits',
        title: 'إعادة تصنيف الإثباتات عند القراءة',
        metricLabel: `${audit?.total_mislabeled_evidence_records ?? 76} مصحح`,
        metricValue: audit?.total_mislabeled_evidence_records ?? 76,
        barsCount: 3,
        tone: 'amber',
        meta: { type: 'evidence_audit', audit },
      },
      {
        id: 'audit:timeline_2024_agg',
        category: 'audits',
        title: 'الإجمالي الإقليمي الكلي 2024',
        metricLabel: `${timeline.filter((t) => t.dataset_category === 'regional_aggregate').length} شهراً`,
        metricValue: timeline.filter((t) => t.dataset_category === 'regional_aggregate').length,
        barsCount: 2,
        tone: 'amber',
        meta: { type: 'timeline_cat', cat: 'regional_aggregate' },
      },
      {
        id: 'audit:timeline_gaps',
        category: 'audits',
        title: 'فجوات بيانات المنصة غير المسترجعة',
        metricLabel: `${timeline.filter((t) => t.dataset_category === 'no_verified_dam_data').length} شهراً`,
        metricValue: timeline.filter((t) => t.dataset_category === 'no_verified_dam_data').length,
        barsCount: 1,
        tone: 'red',
        meta: { type: 'timeline_cat', cat: 'no_verified_dam_data' },
      },
      {
        id: 'audit:timeline_fids',
        category: 'audits',
        title: 'جداول FIDS المؤرشفة (دمشق)',
        metricLabel: `${timeline.filter((t) => t.dataset_category === 'dam_scheduled_fids').length} شهور`,
        metricValue: timeline.filter((t) => t.dataset_category === 'dam_scheduled_fids').length,
        barsCount: 3,
        tone: 'sky',
        meta: { type: 'timeline_cat', cat: 'dam_scheduled_fids' },
      },
      {
        id: 'audit:timeline_adsb',
        category: 'audits',
        title: 'عينة ADS-B الإقليمية المباشرة',
        metricLabel: `${timeline.filter((t) => t.dataset_category === 'live_regional_adsb').length} شهر`,
        metricValue: timeline.filter((t) => t.dataset_category === 'live_regional_adsb').length,
        barsCount: 2,
        tone: 'emerald',
        meta: { type: 'timeline_cat', cat: 'live_regional_adsb' },
      },
    ];

    return {
      airports: airportLeaves,
      layers: layerLeaves,
      airlines: airlineLeaves,
      routes: routeLeaves,
      audits: auditLeaves,
    };
  }, [airports, aptBreakdownMap, audit, compTotals, corridorsData, directionFilter, fidsAirlines, fidsSummary, stats, timeline]);

  const rawCategoryLeaves = leavesByCategory[activeCategory] ?? [];
  const visibleLeaves = useMemo(() => {
    let list = rawCategoryLeaves;
    if (activeCategory === 'layers' && recordFilter !== 'all') {
      list = list.filter((l) =>
        recordFilter === 'observed'
          ? l.id.includes('physical') || l.id.includes('unverified')
          : l.id.includes('scheduled') || l.id.includes('fids') || l.id.includes('codeshare')
      );
    }
    if (searchQuery.trim()) {
      const q = normalizeArabicText(searchQuery);
      return list.filter((l) => {
        const blob = typeof l.meta?.searchBlob === 'string' ? l.meta.searchBlob : '';
        return (
          normalizeArabicText(l.id).includes(q) ||
          normalizeArabicText(l.title).includes(q) ||
          normalizeArabicText(l.metricLabel).includes(q) ||
          normalizeArabicText(blob).includes(q)
        );
      });
    }
    return list;
  }, [activeCategory, rawCategoryLeaves, recordFilter, searchQuery]);

  const selectedLeaf = useMemo(
    () => visibleLeaves.find((l) => l.id === selectedLeafId) ?? null,
    [visibleLeaves, selectedLeafId]
  );

  const comparisonMatrixPoints: MatrixPoint[] = useMemo(() => {
    if (comparison.length === 0) {
      return fidsDaily.slice(-20).map((d) => ({
        label: d.flight_date.slice(5),
        value: d.total_scheduled_records,
      }));
    }
    const byDate = new Map<string, number>();
    for (const row of comparison) {
      const val =
        recordFilter === 'observed'
          ? Number(row.commercial_operational_event_count || 0)
          : recordFilter === 'scheduled'
            ? Number(row.scheduled_record_count || 0)
            : Number(row.total_records || 0);
      byDate.set(row.flight_date, (byDate.get(row.flight_date) ?? 0) + val);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, val]) => ({ label: date.slice(5), value: val }));
  }, [comparison, fidsDaily, recordFilter]);

  const fidsMatrixPoints: MatrixPoint[] = useMemo(
    () =>
      fidsDaily.slice(-24).map((d) => ({
        label: d.flight_date.slice(5),
        value:
          directionFilter === 'arrival'
            ? d.arrival_records
            : directionFilter === 'departure'
              ? d.departure_records
              : d.total_scheduled_records,
      })),
    [fidsDaily, directionFilter]
  );

  // Build dynamic InspectorData (adapts to D3 Corridor / Country selection OR Network Graph selection)
  const inspectorData: InspectorData = useMemo(() => {
    const scopeText =
      selectedAirport === 'all'
        ? 'جميع المطارات السورية (DAM، ALP، DEZ، LTK، KAC)'
        : SYRIAN_AIRPORT_NAMES_AR[selectedAirport] || selectedAirport;

    // Priority 1: D3 Map Corridor selected
    if (spatialMode === 'map' && selectedCorridor) {
      const totalCombined = selectedCorridor.total_events + selectedCorridor.fids_slots;
      const destCityAr = translateCity(selectedCorridor.destination_city);
      const originCityAr = translateCity(selectedCorridor.origin_city);
      const countryAr = translateCountry(selectedCorridor.country_name);
      return {
        contextPrompt: `قياس الممر الجوي · ${selectedCorridor.origin_iata} ↔ ${selectedCorridor.destination_iata} (${countryAr})`,
        categoryKey: 'routes',
        categoryLabel: `${originCityAr} ↔ ${destCityAr}`,
        title: `${selectedCorridor.origin_iata} ↔ ${selectedCorridor.destination_iata} · ${destCityAr}`,
        statusLabel: selectedCorridor.observed_events > 0 ? 'ممر مرصود فعلياً' : 'مجدول / أرشيف FIDS',
        statusTone: selectedCorridor.observed_events > 0 ? 'emerald' : 'amber',
        provenanceLine: `${countryAr} · آخر تاريخ في السجل: ${selectedCorridor.last_flight_date ?? '2026-09-09'}`,
        exploreTarget: 'flights',
        exploreLabel: 'فحص رحلات الممر',
        exploreDestination: selectedCorridor.destination_iata,
        chartTitle: 'وتيرة النشاط اليومي لمطار الأصل',
        chartBadge: `${selectedCorridor.origin_iata}-${selectedCorridor.destination_iata}`,
        headlineValue: totalCombined.toLocaleString('en-US'),
        headlineDelta: `${selectedCorridor.observed_events} مرصودة · ${selectedCorridor.fids_slots.toLocaleString('en-US')} خانة FIDS`,
        matrixPoints: selectedCorridor.origin_iata === 'DAM' && selectedCorridor.fids_slots > 0 ? fidsMatrixPoints : comparisonMatrixPoints,
        accentColor: selectedCorridor.observed_events > 0 ? 'emerald' : 'gold',
        tiles: [
          { label: 'حركات مرصودة', value: selectedCorridor.observed_events.toLocaleString('en-US'), icon: 'plane' },
          { label: 'سجل مجدول', value: selectedCorridor.scheduled_events.toLocaleString('en-US'), icon: 'layers' },
          { label: 'خانات FIDS المؤرشفة', value: selectedCorridor.fids_slots.toLocaleString('en-US'), icon: 'activity' },
          {
            label: 'وصول / مغادرة',
            value: `${selectedCorridor.arrivals}/${selectedCorridor.departures}`,
            icon: 'route',
          },
        ],
        findingTitle:
          selectedCorridor.airlines.length > 0
            ? `الشركات الناقلة: ${selectedCorridor.airlines.map((a) => translateAirline(a)).join('، ')}`
            : 'ممر FIDS المؤرشف (دمشق)',
        findingBody: `ترتبط ${destCityAr} (${selectedCorridor.destination_iata}) مع ${originCityAr} (${selectedCorridor.origin_iata}). تبقى الأحداث التجارية المرصودة وخانات الجداول المؤرشفة مفصولة تماماً دون خلط.`,
      };
    }

    // Priority 2: D3 Map Choropleth Country selected
    if (spatialMode === 'map' && selectedCountry) {
      const combined = selectedCountry.total_events + selectedCountry.fids_slots;
      const countryAr = translateCountry(selectedCountry.country_name);
      return {
        contextPrompt: `خريطة الدول المتصلة · ${countryAr} (${selectedCountry.airports.join('، ')})`,
        categoryKey: 'routes',
        categoryLabel: `التغطية الجغرافية · ISO ${selectedCountry.country_iso_num}`,
        title: `الممرات الجوية مع ${countryAr}`,
        statusLabel: selectedCountry.observed_events > 0 ? 'حركة مرصودة' : 'رحلات مجدولة فقط',
        statusTone: selectedCountry.observed_events > 0 ? 'emerald' : 'sky',
        provenanceLine: `المطارات المتصلة: ${selectedCountry.airports.join('، ')} · الأصل: ${selectedAirport === 'all' ? 'كافة مطارات سوريا' : selectedAirport}`,
        exploreTarget: 'flights',
        exploreLabel: 'عرض رحلات الدولة',
        exploreDestination: selectedCountry.airports.join(','),
        chartTitle: 'حجم الممرات في الشبكة',
        chartBadge: `${selectedCountry.corridor_count} ممراً`,
        headlineValue: combined.toLocaleString('en-US'),
        headlineDelta: `${selectedCountry.observed_events} مرصودة · ${selectedCountry.fids_slots.toLocaleString('en-US')} FIDS`,
        matrixPoints: comparisonMatrixPoints,
        accentColor: 'gold',
        tiles: [
          { label: 'الممرات النشطة', value: String(selectedCountry.corridor_count), icon: 'route' },
          { label: 'حركات مرصودة', value: selectedCountry.observed_events.toLocaleString('en-US'), icon: 'plane' },
          { label: 'سجلات الدفتر', value: selectedCountry.total_events.toLocaleString('en-US'), icon: 'layers' },
          { label: 'خانات FIDS المؤرشفة', value: selectedCountry.fids_slots.toLocaleString('en-US'), icon: 'activity' },
        ],
        findingTitle: 'التوزيع الجغرافي للممرات',
        findingBody: `ترتبط ${countryAr} مع ${selectedAirport === 'all' ? 'المطارات السورية' : SYRIAN_AIRPORT_NAMES_AR[selectedAirport] || selectedAirport} عبر ${selectedCountry.airports.length} مطاراً: ${selectedCountry.airports.join('، ')}.`,
      };
    }

    // Priority 3: Specific Graph Leaf Node selected
    if (selectedLeaf) {
      if (selectedLeaf.category === 'airports') {
        const ap = selectedLeaf.meta?.airport as AirportRecord;
        const bd = selectedLeaf.meta?.breakdown as
          | { cnt: number; min_date: string; max_date: string; dates_count: number }
          | null;
        const apNameAr = ap.name_ar || SYRIAN_AIRPORT_NAMES_AR[ap.airport_id] || ap.name;
        const apCityAr = SYRIAN_CITY_SHORT_AR[ap.airport_id] || ap.city_ar || translateCity(ap.city);
        return {
          contextPrompt: `ملف المطار · ${apNameAr} (${ap.iata_code || ap.icao_code})`,
          categoryKey: 'airports',
          categoryLabel: `${translateAirportType(ap.airport_type)} · ${ap.icao_code}`,
          title: `${apNameAr} (${ap.iata_code || ap.icao_code})`,
          statusLabel: bd ? 'تغطية نشطة' : translateOperationalStatus(ap.operational_status),
          statusTone: bd ? 'emerald' : 'amber',
          provenanceLine: bd
            ? `نطاق الرصد: ${bd.min_date} إلى ${bd.max_date} (${bd.dates_count} يوماً)`
            : `${apCityAr} · الارتفاع ${ap.elevation_ft ?? 'غير محدد'} قدم · لا توجد تغذية FIDS مباشرة مسترجعة`,
          exploreTarget: 'flights',
          exploreLabel: 'فحص رحلات المطار',
          exploreAirport: ap.airport_id,
          exploreSearchQuery: '',
          chartTitle: 'حجم الأحداث اليومية',
          chartBadge: ap.iata_code || ap.icao_code,
          headlineValue: bd ? bd.cnt.toLocaleString('en-US') : '0',
          headlineDelta: bd ? `${bd.dates_count} يوماً مغطى` : 'لا توجد صفوف أحداث مباشرة',
          matrixPoints: comparisonMatrixPoints,
          accentColor: 'emerald',
          tiles: [
            { label: 'الأحداث المسجلة', value: (bd?.cnt ?? 0).toLocaleString('en-US'), icon: 'plane' },
            { label: 'الأيام النشطة', value: String(bd?.dates_count ?? 0), icon: 'activity' },
            {
              label: 'الارتفاع (قدم)',
              value: ap.elevation_ft !== null ? ap.elevation_ft.toLocaleString('en-US') : '—',
              icon: 'building',
            },
            { label: 'المدارج المسجلة', value: String(ap.runways?.length ?? 1), icon: 'route' },
          ],
          findingTitle: ap.iata_code === 'DAM' ? 'المحور التحليلي لمطار دمشق' : `نطاق مطار ${apCityAr}`,
          findingBody:
            ap.iata_code === 'DAM'
              ? 'البوابة الرئيسية التي توحّد جداول FIDS المؤرشفة في واي باك (2026-07 إلى 2026-09) مع التغذية التشغيلية التجارية لشهر أكتوبر. لا يتوفر رصد راداري أرضي مباشر للمدرج.'
              : `${apNameAr} (${ap.icao_code}) عند الإحداثيات (${ap.latitude?.toFixed(3) ?? '—'}، ${ap.longitude?.toFixed(3) ?? '—'}). تشير الفجوات التاريخية إلى غياب تغذية مسترجعة لا إلى إغلاق المطار.`,
        };
      }

      if (selectedLeaf.category === 'airlines') {
        const al = selectedLeaf.meta?.airline as FidsAirlineRow;
        const arName = al.displayed_airline_brand_ar || translateAirline(al.displayed_airline_brand_en);
        return {
          contextPrompt: `تحليلات الناقل الجوي · بيانات أرشيف FIDS لشركة ${arName}`,
          categoryKey: 'airlines',
          categoryLabel: `${translateCarrierRole(al.carrier_role_classification)} · ${al.source_iata_code || 'FIDS'}`,
          title: `${arName} · ${al.displayed_airline_brand_en}`,
          statusLabel: 'أرشيف FIDS',
          statusTone: 'sky',
          provenanceLine: `الرحلات المعروضة من ${al.first_active_date} إلى ${al.last_active_date} · ${al.active_days_count} يوماً نشطاً`,
          exploreTarget: 'flights',
          exploreLabel: 'استعراض رحلات الشركة',
          exploreSearchQuery: al.source_iata_code || al.displayed_airline_brand_en,
          chartTitle: 'الحصة والوتيرة في الأرشيف',
          chartBadge: al.percentage_of_total,
          headlineValue: al.total_displayed_records.toLocaleString('en-US'),
          headlineDelta: `${al.daily_frequency_active_days} رحلة / يوم نشط`,
          matrixPoints: fidsMatrixPoints,
          accentColor: 'gold',
          tiles: [
            { label: 'خانات الوصول', value: al.arrival_records.toLocaleString('en-US'), icon: 'plane' },
            { label: 'خانات المغادرة', value: al.departure_records.toLocaleString('en-US'), icon: 'route' },
            { label: 'أرقام الرحلات الفريدة', value: al.distinct_flight_numbers.toLocaleString('en-US'), icon: 'layers' },
            { label: 'أيام FIDS النشطة', value: String(al.active_days_count), icon: 'activity' },
          ],
          findingTitle: 'العلامة المعروضة مقابل التشغيل الفعلي',
          findingBody:
            'تعكس الأعداد القوائم المجدولة الظاهرة على شاشات FIDS المسترجعة من أرشيف damairport.gov.sy (من 2026-07-05 إلى 2026-09-09)، ويُفصل التحقق الفعلي عبر ADS-B في طبقة مستقلة.',
        };
      }

      if (selectedLeaf.category === 'layers') {
        const layerKey = String(selectedLeaf.meta?.layer || '');
        const count = Number(selectedLeaf.meta?.count || 0);
        const natureMap: Record<string, string> = {
          physical_movement: 'physical_movement',
          scheduled_service: 'scheduled_service',
          marketing_codeshare: 'marketing_codeshare',
          unverified_movement: 'unverified_movement',
        };
        return {
          contextPrompt: `تصنيف الإثبات · ${selectedLeaf.title}`,
          categoryKey: 'layers',
          categoryLabel: 'طبقة الإثبات المنهجية',
          title: selectedLeaf.title,
          statusLabel: layerKey === 'physical_movement' ? 'تشغيلي مرصود' : 'طبقة مفصولة',
          statusTone: layerKey === 'physical_movement' ? 'emerald' : 'amber',
          provenanceLine: `النطاق: ${scopeText} · سجل مصدري غير مدمج`,
          exploreTarget: layerKey === 'archived_fids' ? 'fids' : layerKey === 'historical_2024' ? 'coverage' : 'flights',
          exploreLabel: 'استكشاف التفاصيل',
          exploreNature: natureMap[layerKey] || '',
          chartTitle: 'توزيع الطبقة عبر التواريخ',
          chartBadge: layerKey,
          headlineValue: count.toLocaleString('en-US'),
          headlineDelta: 'عدد غير مدمج صارم',
          matrixPoints: layerKey === 'archived_fids' ? fidsMatrixPoints : comparisonMatrixPoints,
          accentColor: layerKey === 'physical_movement' ? 'emerald' : 'gold',
          tiles: [
            { label: 'تشغيلي مرصود', value: compTotals.operational.toLocaleString('en-US'), icon: 'plane' },
            { label: 'خانات مجدولة', value: compTotals.scheduled.toLocaleString('en-US'), icon: 'layers' },
            { label: 'مشاركات رمز', value: compTotals.codeshares.toLocaleString('en-US'), icon: 'building' },
            { label: 'غير موثقة', value: compTotals.unverified.toLocaleString('en-US'), icon: 'shield' },
          ],
          findingTitle: 'قاعدة الفصل المصدري الصارم',
          findingBody:
            'تُعزل الأحداث التشغيلية وعروض الجداول وقوائم الرمز المشترك ومجاميع 2024 الكلية لمنع تضخيم أعداد حركات الطائرات الفعلية.',
        };
      }

      if (selectedLeaf.category === 'routes') {
        const corr = selectedLeaf.meta?.corridor as FlightCorridor;
        const destCityAr = translateCity(corr.destination_city);
        const countryAr = translateCountry(corr.country_name);
        return {
          contextPrompt: `قياس الممر الجوي · ${corr.origin_iata} ↔ ${corr.destination_iata}`,
          categoryKey: 'routes',
          categoryLabel: `ممر جوي متصل · ${countryAr}`,
          title: `${corr.origin_iata} ↔ ${corr.destination_iata} (${destCityAr})`,
          statusLabel: corr.observed_events > 0 ? 'ممر مرصود فعلياً' : 'مجدول / أرشيف FIDS',
          statusTone: corr.observed_events > 0 ? 'emerald' : 'sky',
          provenanceLine: `${destCityAr} · ${countryAr}`,
          exploreTarget: 'flights',
          exploreLabel: 'فتح رحلات الممر',
          exploreDestination: corr.destination_iata,
          chartTitle: 'حجم الممرات في الشبكة',
          chartBadge: corr.destination_iata,
          headlineValue: (corr.total_events + corr.fids_slots).toLocaleString('en-US'),
          headlineDelta: `${corr.observed_events} مرصودة · ${corr.fids_slots.toLocaleString('en-US')} FIDS`,
          matrixPoints: comparisonMatrixPoints,
          accentColor: 'sky',
          tiles: [
            { label: 'حركات مرصودة', value: corr.observed_events.toLocaleString('en-US'), icon: 'plane' },
            { label: 'سجل مجدول', value: corr.scheduled_events.toLocaleString('en-US'), icon: 'layers' },
            { label: 'خانات FIDS المؤرشفة', value: corr.fids_slots.toLocaleString('en-US'), icon: 'activity' },
            { label: 'وصول / مغادرة', value: `${corr.arrivals}/${corr.departures}`, icon: 'route' },
          ],
          findingTitle: 'أصل بيانات الممر',
          findingBody: `انتقل إلى خريطة المسارات في الشريط العلوي لمعاينة ${corr.origin_iata} ↔ ${corr.destination_iata} جغرافياً، أو افتح السجل لتصفية الرحلات التفصيلية.`,
        };
      }

      return {
        contextPrompt: `التدقيق الجنائي · ${selectedLeaf.title}`,
        categoryKey: 'audits',
        categoryLabel: 'سلامة البيانات والتدقيق التاريخي',
        title: selectedLeaf.title,
        statusLabel: 'تدقيق موثق',
        statusTone: 'amber',
        provenanceLine: `نافذة التدقيق: 2024-01 إلى 2026-10 (34 شهراً) · الإصدار ${audit?.audit_version ?? 'V2.20.6'}`,
        exploreTarget: 'coverage',
        exploreLabel: 'فتح تدقيق التغطية',
        chartTitle: 'الجدول الزمني للتدقيق التاريخي',
        chartBadge: '2024–2026',
        headlineValue: `${selectedLeaf.metricValue}`,
        headlineDelta: selectedLeaf.metricLabel,
        matrixPoints: timeline.map((t) => ({ label: t.source_period.slice(2), value: t.record_count })),
        accentColor: 'gold',
        tiles: [
          {
            label: 'صفوف مصححة عند القراءة',
            value: String(audit?.total_mislabeled_evidence_records ?? 76),
            icon: 'shield',
          },
          {
            label: 'إقلاعات معاد تصنيفها',
            value: String(audit?.original_takeoffs_reclassified ?? 0),
            icon: 'plane',
          },
          {
            label: 'عمليات هبوط معاد تصنيفها',
            value: String(audit?.original_touchdowns_reclassified ?? 0),
            icon: 'activity',
          },
          { label: 'الأشهر المدققة', value: String(timeline.length || 34), icon: 'layers' },
        ],
        findingTitle: 'خط الأساس التوثيقي غير القابل للتعديل',
        findingBody:
          'تبقى صفوف الإثبات الأصلية في قاعدة البيانات محفوظة دون تغيير؛ وتُصحَّح الطوابع التقديرية المُساء تصنيفها ديناميكياً عند القراءة.',
      };
    }

    // Priority 4: D3 Map Overview when no specific corridor/country selected
    if (spatialMode === 'map') {
      const topCountry = corridorsData?.country_totals?.find((c) => c.country_iso_num !== '760');
      return {
        contextPrompt: `خريطة الممرات · النطاق الجغرافي لـ ${scopeText}`,
        categoryKey: 'routes',
        categoryLabel: 'خريطة المسارات الجوية والدول المتصلة',
        title:
          selectedAirport === 'all'
            ? 'الممرات الجوية النشطة للمطارات السورية'
            : `الممرات الجوية النشطة لمطار ${SYRIAN_CITY_SHORT_AR[selectedAirport] || selectedAirport}`,
        statusLabel: 'نشط',
        statusTone: 'emerald',
        provenanceLine: `${corridorsData?.summary?.active_corridors ?? 0} ممراً نشطاً نحو ${corridorsData?.summary?.countries_reached ?? 0} دولة وجهة`,
        exploreTarget: 'flights',
        exploreLabel: 'استكشاف التفاصيل',
        chartTitle: 'الحجم اليومي للعمليات والجداول',
        chartBadge: selectedAirport === 'all' ? 'ALL SYR' : selectedAirport,
        headlineValue: String(corridorsData?.summary?.active_corridors ?? 0),
        headlineDelta: topCountry
          ? `أبرز وجهة: ${translateCountry(topCountry.country_name)} (${(topCountry.total_events + topCountry.fids_slots).toLocaleString('en-US')})`
          : 'انقر على أي مسار أو دولة',
        headlineTrendPct: kpis?.trends?.active_destinations_pct ?? null,
        headlineTrendLabel: 'مسار عن الشهر الماضي',
        matrixPoints: comparisonMatrixPoints,
        accentColor: 'emerald',
        tiles: [
          {
            label: 'الممرات النشطة',
            value: String(corridorsData?.summary?.active_corridors ?? 0),
            icon: 'route',
            trendPct: kpis?.trends?.active_destinations_pct ?? null,
            trendLabel: 'من الشهر الماضي',
          },
          { label: 'الدول المتصلة', value: String(corridorsData?.summary?.countries_reached ?? 0), icon: 'building' },
          {
            label: 'حركات مرصودة على الممرات',
            value: (corridorsData?.summary?.total_observed_events ?? 0).toLocaleString('en-US'),
            icon: 'plane',
            trendPct: kpis?.trends?.observed_sample_day_pct ?? null,
            trendLabel: kpis?.trends?.observed_sample_prev_date
              ? `مقارنة بـ ${kpis.trends.observed_sample_prev_date.slice(5)}`
              : 'تغير العينة',
          },
          {
            label: 'خانات FIDS المؤرشفة',
            value: (corridorsData?.summary?.total_fids_slots ?? 0).toLocaleString('en-US'),
            icon: 'layers',
            trendPct: kpis?.trends?.scheduled_daily_avg_pct ?? null,
            trendLabel: 'معدل يومي عن الشهر الماضي',
          },
        ],
        findingTitle: 'خريطة الكوروبليث والمسارات العظمى التفاعلية',
        findingBody:
          'انقر على أي محور مطار سوري (DAM، ALP، DEZ، LTK، KAC) لعزل مساراته القادمة والمغادرة، أو اختر أي دولة أو قوس ممر لفحص سجلاته.',
      };
    }

    // Priority 4b: Coverage Matrix Heatmap view
    if (spatialMode === 'heatmap') {
      if (selectedHeatmapDay) {
        const totalDay =
          selectedHeatmapDay.verified_movements_count +
          selectedHeatmapDay.commercial_records_count +
          selectedHeatmapDay.fids_records_count;
        const stationAr = SYRIAN_CITY_SHORT_AR[selectedHeatmapDay.airport_id] || selectedHeatmapDay.airport_id;
        return {
          contextPrompt: `خريطة التغطية · ${stationAr} (${selectedHeatmapDay.airport_id}) في ${selectedHeatmapDay.flight_date}`,
          categoryKey: 'audits',
          categoryLabel: `خلية مصفوفة التغطية · ${selectedHeatmapDay.airport_id}`,
          title: `${stationAr} (${selectedHeatmapDay.airport_id}) · ${selectedHeatmapDay.flight_date}`,
          statusLabel: translateCoverageClass(selectedHeatmapDay.coverage_classification),
          statusTone:
            selectedHeatmapDay.verified_movements_count > 0
              ? 'emerald'
              : totalDay > 0
                ? 'sky'
                : 'amber',
          provenanceLine: selectedHeatmapDay.sources_checked || 'خلية مصفوفة تغطية المنصة',
          exploreTarget: 'coverage',
          exploreLabel: 'تدقيق التغطية الكامل',
          chartTitle: 'كثافة السجلات التاريخية (34 شهراً)',
          chartBadge: selectedHeatmapDay.flight_date,
          headlineValue: totalDay.toLocaleString('en-US'),
          headlineDelta:
            totalDay === 0
              ? 'فجوة بيانات أو يوم غير مفحوص'
              : `${selectedHeatmapDay.verified_movements_count} موثقة · ${selectedHeatmapDay.fids_records_count} FIDS`,
          matrixPoints: timeline.map((t) => ({ label: t.source_period.slice(2), value: t.record_count })),
          accentColor: selectedHeatmapDay.verified_movements_count > 0 ? 'emerald' : 'gold',
          tiles: [
            { label: 'حركات موثقة', value: String(selectedHeatmapDay.verified_movements_count), icon: 'plane' },
            { label: 'سجل تجاري', value: String(selectedHeatmapDay.commercial_records_count), icon: 'layers' },
            { label: 'أرشيف FIDS', value: String(selectedHeatmapDay.fids_records_count), icon: 'activity' },
            { label: 'المحطة', value: selectedHeatmapDay.airport_id, icon: 'building' },
          ],
          findingTitle: 'أساس إثبات الخلية',
          findingBody: `${selectedHeatmapDay.evidence_basis} ${selectedHeatmapDay.notes}`.trim(),
        };
      }

      if (selectedHeatmapMonth) {
        const totalMo = selectedHeatmapMonth.direct_density_records + selectedHeatmapMonth.fids_records;
        const stationAr = SYRIAN_CITY_SHORT_AR[selectedHeatmapMonth.airport_id] || selectedHeatmapMonth.airport_id;
        return {
          contextPrompt: `خريطة التغطية · ${stationAr} (${selectedHeatmapMonth.year_month})`,
          categoryKey: 'audits',
          categoryLabel: `كثافة التغطية الشهرية · ${selectedHeatmapMonth.airport_id}`,
          title: `تغطية ${stationAr} · ${selectedHeatmapMonth.year_month}`,
          statusLabel: totalMo > 0 ? 'نافذة مغطاة' : 'فجوة بيانات',
          statusTone: totalMo > 0 ? 'emerald' : 'amber',
          provenanceLine: `${selectedHeatmapMonth.non_gap_days}/${selectedHeatmapMonth.total_days} يوماً مغطى في ${selectedHeatmapMonth.year_month}`,
          exploreTarget: 'coverage',
          exploreLabel: 'تدقيق التغطية الكامل',
          chartTitle: 'كثافة السجلات التاريخية (34 شهراً)',
          chartBadge: selectedHeatmapMonth.year_month,
          headlineValue: totalMo.toLocaleString('en-US'),
          headlineDelta: `${selectedHeatmapMonth.verified_records} موثقة · ${selectedHeatmapMonth.fids_records} FIDS`,
          matrixPoints: timeline.map((t) => ({ label: t.source_period.slice(2), value: t.record_count })),
          accentColor: 'emerald',
          tiles: [
            { label: 'عمليات موثقة', value: selectedHeatmapMonth.verified_records.toLocaleString('en-US'), icon: 'plane' },
            { label: 'سجل تجاري', value: selectedHeatmapMonth.commercial_records.toLocaleString('en-US'), icon: 'layers' },
            { label: 'أرشيف FIDS', value: selectedHeatmapMonth.fids_records.toLocaleString('en-US'), icon: 'activity' },
            { label: 'الأيام النشطة', value: `${selectedHeatmapMonth.non_gap_days}/${selectedHeatmapMonth.total_days}`, icon: 'shield' },
          ],
          findingTitle: 'نزاهة التغطية الشهرية',
          findingBody:
            selectedHeatmapMonth.sem_2024_macro_ops > 0
              ? `إجمالي المرصد الاقتصادي 2024 (${selectedHeatmapMonth.sem_2024_macro_ops} عملية عبر DAM_ALP_LTK) مستبعد من الإحصاءات الفردية للمحطة لتجنب الخلط.`
              : 'تدل الدرجات الخضراء الداكنة على كثافة تجريبية أعلى؛ بينما تشير الخلايا الفاتحة إلى فجوات بيانات غير مسترجعة.',
        };
      }

      return {
        contextPrompt: `خريطة مصفوفة التغطية · الكثافة الشهرية واليومية عبر 5 محطات`,
        categoryKey: 'audits',
        categoryLabel: 'مصفوفة التغطية التاريخية (5 مستويات)',
        title: 'مصفوفة تغطية بيانات المطارات السورية',
        statusLabel: '5,175 خلية يومية',
        statusTone: 'emerald',
        provenanceLine: 'من 2024-01-01 إلى 2026-10-31 عبر DAM و ALP و DEZ و LTK و KAC',
        exploreTarget: 'coverage',
        exploreLabel: 'تدقيق التغطية الكامل',
        chartTitle: 'كثافة السجلات التاريخية (34 شهراً)',
        chartBadge: '2024–2026',
        headlineValue: '5,175',
        headlineDelta: 'مصفوفة التغطية (مطار × يوم)',
        matrixPoints: timeline.map((t) => ({ label: t.source_period.slice(2), value: t.record_count })),
        accentColor: 'emerald',
        tiles: [
          { label: 'المحطات المشمولة', value: '5', icon: 'building' },
          { label: 'الأشهر المدققة', value: String(timeline.length || 34), icon: 'layers' },
          { label: 'أرصاد أكتوبر', value: compTotals.operational.toLocaleString('en-US'), icon: 'plane' },
          { label: 'أرشيف FIDS', value: (fidsSummary?.total_archived_fids_records ?? 6923).toLocaleString('en-US'), icon: 'activity' },
        ],
        findingTitle: 'سياسة شفافية الفجوات',
        findingBody:
          'تمثل الخلايا الفاتحة فجوات بيانات غير مسترجعة من المصادر (ولا تعني أبداً انعدام الرحلات)، فيما تميز الدرجات الخضراء الداكنة التغطية الموثقة وكثافة الجداول.',
      };
    }

    // Priority 5: Category Overview in Network Graph
    if (activeCategory === 'airlines') {
      const totalFids = fidsSummary?.total_archived_fids_records ?? 6923;
      const topBrand = fidsAirlines[0];
      const julFids = fidsDaily.filter((d) => d.flight_date.startsWith('2026-07'));
      const augFids = fidsDaily.filter((d) => d.flight_date.startsWith('2026-08'));
      const fidsDailyShiftPct =
        julFids.length > 0 && augFids.length > 0
          ? (() => {
              const julAvg =
                julFids.reduce((s, r) => s + r.total_scheduled_records, 0) / julFids.length;
              const augAvg =
                augFids.reduce((s, r) => s + r.total_scheduled_records, 0) / augFids.length;
              return julAvg > 0 ? Math.round(((augAvg - julAvg) / julAvg) * 1000) / 10 : null;
            })()
          : null;

      const topBrandAr = topBrand
        ? topBrand.displayed_airline_brand_ar || translateAirline(topBrand.displayed_airline_brand_en)
        : '';

      return {
        contextPrompt: `القياسات التشغيلية · أرشيف FIDS وتوزيع الناقلين (${scopeText})`,
        categoryKey: 'airlines',
        categoryLabel: 'أرشيف شاشات دمشق (FIDS) · توزيع الناقلين',
        title: 'محرك بيانات المطارات السورية — الناقلون المؤرشفون وجداول التشغيل',
        statusLabel: 'نشط',
        statusTone: 'emerald',
        provenanceLine: `نافذة الرصد: ${fidsSummary?.date_range?.earliest_scheduled_date ?? '2026-07-05'} إلى ${fidsSummary?.date_range?.latest_scheduled_date ?? '2026-09-09'} · ${fidsSummary?.calendar_days_covered ?? 67} يوم FIDS`,
        exploreTarget: 'fids',
        exploreLabel: 'استكشاف التفاصيل',
        chartTitle: 'الحجم اليومي لأرشيف FIDS',
        chartBadge: 'أرشيف 67 يوماً',
        headlineValue: totalFids.toLocaleString('en-US'),
        headlineDelta: topBrand
          ? `الصدارة لـ ${topBrandAr} (${topBrand.percentage_of_total})`
          : '14 علامة تجارية معروضة',
        headlineTrendPct: fidsDailyShiftPct,
        headlineTrendLabel: 'متوسط آب مقابل تموز اليومي',
        matrixPoints: fidsMatrixPoints,
        accentColor: 'gold',
        tiles: [
          {
            label: 'العلامات المعروضة',
            value: String(fidsSummary?.displayed_airline_brands_count ?? fidsAirlines.length),
            icon: 'plane',
            trendPct: kpis?.trends?.active_airlines_pct ?? null,
            trendLabel: 'من الشهر الماضي',
          },
          {
            label: 'الخانات المجدولة',
            value: (kpis?.kpis?.scheduled_flights ?? compTotals.scheduled).toLocaleString('en-US'),
            icon: 'layers',
            trendPct: kpis?.trends?.scheduled_daily_avg_pct ?? null,
            trendLabel: 'معدل يومي عن الشهر الماضي',
          },
          {
            label: 'عمليات مرصودة',
            value: compTotals.operational.toLocaleString('en-US'),
            icon: 'activity',
            trendPct:
              kpis?.trends?.observed_movements_month_pct ??
              kpis?.trends?.observed_sample_day_pct ??
              null,
            trendLabel: kpis?.trends?.observed_sample_prev_date
              ? `مقارنة بعينة ${kpis.trends.observed_sample_prev_date.slice(5)}`
              : 'من الشهر الماضي',
          },
          {
            label: 'أرقام رحلات فريدة',
            value: (fidsSummary?.unique_scheduled_flight_numbers ?? 0).toLocaleString('en-US'),
            icon: 'route',
            trendPct: kpis?.trends?.active_destinations_pct ?? null,
            trendLabel: 'مسارات عن الشهر الماضي',
          },
        ],
        findingTitle: 'الفصل بين الجداول وقياسات المدرج الفعلية',
        findingBody:
          'تُفصل لقطات Wayback FIDS (6,923 خانة معروضة) بشكل صارم عن عمليات أكتوبر التجارية المبلّغ عنها (131 حدثاً) وعن مجاميع 2024 الإقليمية DAM_ALP_LTK (438 صفاً).',
      };
    }

    if (activeCategory === 'airports') {
      return {
        contextPrompt: `شبكة المطارات · البنية التحتية وتوزيع الأحداث (${scopeText})`,
        categoryKey: 'airports',
        categoryLabel: 'سجل المطارات المدنية السورية',
        title: '7 مطارات مدنية سورية وبوابات إقليمية مسجلة',
        statusLabel: 'نشط',
        statusTone: 'emerald',
        provenanceLine: `قياسات نشطة عبر ${stats?.airport_events_breakdown?.length ?? 5} مطارات · التوقيت: Asia/Damascus`,
        exploreTarget: 'overview',
        exploreLabel: 'استكشاف التفاصيل',
        chartTitle: 'الحجم اليومي لأحداث الشبكة',
        chartBadge: 'جميع المطارات',
        headlineValue: (stats?.total_verified_flights ?? compTotals.total).toLocaleString('en-US'),
        headlineDelta: `${airports.length || 7} محطات مسجلة`,
        matrixPoints: comparisonMatrixPoints,
        accentColor: 'emerald',
        tiles: [
          { label: 'المحطات المسجلة', value: String(airports.length || 7), icon: 'building' },
          { label: 'إجمالي صفوف السجل', value: compTotals.total.toLocaleString('en-US'), icon: 'layers' },
          {
            label: 'تسجيلات طائرات مميزة',
            value: String(stats?.distinct_reported_aircraft_registrations ?? 0),
            icon: 'plane',
          },
          { label: 'صفوف 2024 الكلية', value: String(stats?.historical_2024_rows ?? 438), icon: 'shield' },
        ],
        findingTitle: 'سياسة عدم تجميع المحطات',
        findingBody:
          'يحظى مطار دمشق الدولي (DAM) بأعمق تغطية لشاشات FIDS وحالات التشغيل التجاري. بينما تغطي صفوف 2024 التاريخية DAM_ALP_LTK مجتمعة دون تفكيك على مستوى المطار.',
      };
    }

    if (activeCategory === 'routes') {
      const topCorr = corridorsData?.corridors?.[0];
      return {
        contextPrompt: `قياسات الممرات · الوجهات الإقليمية والدولية (${scopeText})`,
        categoryKey: 'routes',
        categoryLabel: 'ممرات المطارات المتصلة',
        title: 'الممرات الجوية الإقليمية والدولية الرئيسية',
        statusLabel: 'نشط',
        statusTone: 'emerald',
        provenanceLine: `أبرز ممر: ${topCorr ? `${topCorr.origin_iata} ↔ ${topCorr.destination_iata}` : 'DAM ↔ DXB'} · ${corridorsData?.summary?.countries_reached ?? 0} دولة`,
        exploreTarget: 'monitor',
        exploreLabel: 'استكشاف التفاصيل',
        chartTitle: 'الوتيرة التشغيلية والمجدولة',
        chartBadge: 'أبرز الممرات',
        headlineValue: String(corridorsData?.summary?.active_corridors ?? stats?.top_connected_airports?.length ?? 0),
        headlineDelta: topCorr ? `الممر الأعلى: ${topCorr.destination_iata} (${translateCity(topCorr.destination_city)})` : 'مسارات نشطة',
        headlineTrendPct: kpis?.trends?.active_destinations_pct ?? null,
        headlineTrendLabel: 'مسار عن الشهر الماضي',
        matrixPoints: comparisonMatrixPoints,
        accentColor: 'sky',
        tiles: [
          {
            label: 'الممرات النشطة',
            value: String(corridorsData?.summary?.active_corridors ?? 0),
            icon: 'route',
            trendPct: kpis?.trends?.active_destinations_pct ?? null,
            trendLabel: 'من الشهر الماضي',
          },
          {
            label: 'الدول المتصلة',
            value: String(corridorsData?.summary?.countries_reached ?? 0),
            icon: 'building',
          },
          {
            label: 'الأحداث المرصودة',
            value: compTotals.operational.toLocaleString('en-US'),
            icon: 'activity',
            trendPct: kpis?.trends?.observed_sample_day_pct ?? null,
            trendLabel: kpis?.trends?.observed_sample_prev_date
              ? `مقارنة بعينة ${kpis.trends.observed_sample_prev_date.slice(5)}`
              : 'تغير العينة',
          },
          {
            label: 'الخانات المجدولة',
            value: compTotals.scheduled.toLocaleString('en-US'),
            icon: 'layers',
            trendPct: kpis?.trends?.scheduled_daily_avg_pct ?? null,
            trendLabel: 'معدل يومي عن الشهر الماضي',
          },
        ],
        findingTitle: 'أصل بيانات الممرات الجوية',
        findingBody:
          'انتقل إلى خريطة المسارات في الشريط العلوي لاستعراض خريطة الكوروبليث والمسارات الدائرية D3، أو انقر «استكشاف التفاصيل» للتصفية في مراقب الحركة الجوية.',
      };
    }

    if (activeCategory === 'audits') {
      return {
        contextPrompt: `تدقيق التغطية · التحقق الاستدلالي عبر 34 شهراً وتصحيحات القراءة`,
        categoryKey: 'audits',
        categoryLabel: 'تدقيق التغطية الجنائي والمصدرية',
        title: 'التغطية التاريخية (34 شهراً) وتدقيق الإثباتات غير القابل للتعديل',
        statusLabel: 'مدقق',
        statusTone: 'amber',
        provenanceLine: `خط أساس التدقيق: ${audit?.audit_version ?? 'V2.20.6'} · من 2024-01 إلى 2026-10`,
        exploreTarget: 'coverage',
        exploreLabel: 'استكشاف التفاصيل',
        chartTitle: 'حجم التغطية الشهرية (34 شهراً)',
        chartBadge: 'مصفوفة التدقيق',
        headlineValue: String(audit?.total_mislabeled_evidence_records ?? 76),
        headlineDelta: 'تصحيحات إثبات عند القراءة',
        matrixPoints: timeline.map((t) => ({ label: t.source_period.slice(2), value: t.record_count })),
        accentColor: 'gold',
        tiles: [
          { label: 'الأشهر المدققة', value: String(timeline.length || 34), icon: 'layers' },
          {
            label: 'سجلات معاد تصنيفها',
            value: String(audit?.total_mislabeled_evidence_records ?? 76),
            icon: 'shield',
          },
          { label: 'صفوف 2024 الكلية', value: String(stats?.historical_2024_rows ?? 438), icon: 'building' },
          { label: 'رصد رادار المدرج', value: '0', icon: 'activity' },
        ],
        findingTitle: 'غياب القياس لا يعني أبداً انعدام الرحلات',
        findingBody:
          'تمثل نوافذ الرصد المفقودة لقطات منصات غير مسترجعة ولا تعني إغلاق المطارات. وتبقى الطوابع التقديرية مفصولة تماماً عن ادعاءات الرادار الفيزيائي.',
      };
    }

    const obsRatio =
      compTotals.total > 0 ? Math.round((compTotals.operational / compTotals.total) * 100) : 0;
    return {
      contextPrompt: `القياسات التشغيلية · الحركات التجريبية وطبقات الإثبات (${scopeText})`,
      categoryKey: 'layers',
      categoryLabel: 'معمارية الفصل المنهجي',
      title: 'عمليات الرحلات المفصولة وطبقات الإثبات',
      statusLabel: 'نشط',
      statusTone: 'emerald',
      provenanceLine: `آخر نافذة سجل: 2026-10-10 · ${compTotals.total.toLocaleString('en-US')} حدثاً معيارياً`,
      exploreTarget: 'flights',
      exploreLabel: 'استكشاف التفاصيل',
      chartTitle: 'نسبة الأحداث التشغيلية',
      chartBadge: 'تقسيم الإثباتات',
      headlineValue: `${obsRatio}%`,
      headlineDelta: `${compTotals.operational.toLocaleString('en-US')} مرصود / ${compTotals.total.toLocaleString('en-US')} إجمالي`,
      headlineTrendPct: kpis?.trends?.observed_sample_day_pct ?? null,
      headlineTrendLabel: kpis?.trends?.observed_sample_prev_date
        ? `مقارنة بعينة ${kpis.trends.observed_sample_prev_date.slice(5)}`
        : 'تغير العينة',
      matrixPoints: comparisonMatrixPoints,
      accentColor: 'emerald',
      tiles: [
        {
          label: 'الخانات المجدولة',
          value: compTotals.scheduled.toLocaleString('en-US'),
          icon: 'layers',
          trendPct: kpis?.trends?.scheduled_daily_avg_pct ?? null,
          trendLabel: 'معدل يومي عن الشهر الماضي',
        },
        {
          label: 'العمليات المرصودة',
          value: compTotals.operational.toLocaleString('en-US'),
          icon: 'plane',
          trendPct: kpis?.trends?.observed_sample_day_pct ?? null,
          trendLabel: kpis?.trends?.observed_sample_prev_date
            ? `مقارنة بعينة ${kpis.trends.observed_sample_prev_date.slice(5)}`
            : 'تغير العينة',
        },
        {
          label: 'مشاركات الرمز',
          value: compTotals.codeshares.toLocaleString('en-US'),
          icon: 'building',
          trendPct: kpis?.trends?.non_verified_share_pp ?? null,
          trendSuffix: ' ن.م',
          trendPositiveIsGood: false,
          trendLabel: 'حصة عن الشهر الماضي',
        },
        { label: 'ادعاءات غير موثقة', value: compTotals.unverified.toLocaleString('en-US'), icon: 'shield' },
      ],
      findingTitle: 'عزل صارم حسب مستوى الإثبات',
      findingBody:
        'يُصنَّف كل سجل إلى حركة فعلية (physical_movement) أو خدمة مجدولة (scheduled_service) أو مشاركة رمز تسويقية (marketing_codeshare) أو حركة غير موثقة مع مسار تدقيق موثوق.',
    };
  }, [
    activeCategory,
    airports.length,
    audit,
    compTotals,
    comparisonMatrixPoints,
    corridorsData,
    fidsAirlines,
    fidsDaily,
    fidsMatrixPoints,
    fidsSummary,
    kpis,
    selectedAirport,
    selectedCountry,
    selectedCorridor,
    selectedHeatmapDay,
    selectedHeatmapMonth,
    selectedLeaf,
    spatialMode,
    stats,
    timeline,
  ]);

  const handleExploreDetails = (
    target: WorkspaceView,
    opts?: { airlineQuery?: string; recordNature?: string; destination?: string; airportId?: string }
  ) => {
    setLedgerPrefill({
      airportId: opts?.airportId ?? '',
      airlineQuery: opts?.airlineQuery ?? '',
      movementType: directionFilter === 'all' ? '' : directionFilter,
      recordNature:
        opts?.recordNature ??
        (recordFilter === 'observed'
          ? 'physical_movement'
          : recordFilter === 'scheduled'
            ? 'scheduled_service'
            : ''),
      destination: opts?.destination ?? '',
    });
    setActiveView(target);
  };

  const handleSubmitQuery = (query: string) => {
    const clean = query.trim();
    if (!clean) {
      handleExploreDetails('flights');
      return;
    }
    const upper = clean.toUpperCase();
    const normClean = normalizeArabicText(clean);
    const matchedAirport = airports.find(
      (a) =>
        a.airport_id === upper ||
        a.iata_code === upper ||
        a.icao_code === upper ||
        (a.name_ar && normalizeArabicText(a.name_ar).includes(normClean)) ||
        (SYRIAN_CITY_SHORT_AR[a.airport_id] && normalizeArabicText(SYRIAN_CITY_SHORT_AR[a.airport_id]).includes(normClean))
    );
    if (matchedAirport) {
      setSelectedAirport(matchedAirport.airport_id);
      setActiveCategory('airports');
      setSelectedLeafId(`apt:${matchedAirport.airport_id}`);
      setSelectedCorridor(null);
      setSelectedCountry(null);
      setSelectedHeatmapDay(null);
      setSelectedHeatmapMonth(null);
      return;
    }

    const matchedCorridor = corridorsData?.corridors.find(
      (c) =>
        c.destination_iata === upper ||
        normalizeArabicText(c.destination_city).includes(normClean) ||
        normalizeArabicText(translateCity(c.destination_city)).includes(normClean) ||
        normalizeArabicText(c.country_name).includes(normClean) ||
        normalizeArabicText(translateCountry(c.country_name)).includes(normClean) ||
        c.airlines.some(
          (a) => normalizeArabicText(a).includes(normClean) || normalizeArabicText(translateAirline(a)).includes(normClean)
        )
    );
    if (matchedCorridor && spatialMode === 'map') {
      setSelectedCountry(null);
      setSelectedCorridor(matchedCorridor);
      return;
    }

    setLedgerPrefill({
      airportId: '',
      airlineQuery: matchedCorridor && !matchedCorridor.airlines.some((a) => normalizeArabicText(translateAirline(a)).includes(normClean))
        ? ''
        : resolveArabicSearchToken(clean),
      movementType: directionFilter === 'all' ? '' : directionFilter,
      recordNature:
        recordFilter === 'observed'
          ? 'physical_movement'
          : recordFilter === 'scheduled'
            ? 'scheduled_service'
            : '',
      destination: matchedCorridor ? matchedCorridor.destination_iata : '',
    });
    setActiveView('flights');
  };

  const cycleRecordFilter = () => {
    setRecordFilter((prev) => (prev === 'all' ? 'observed' : prev === 'observed' ? 'scheduled' : 'all'));
  };

  const cycleDirectionFilter = () => {
    setDirectionFilter((prev) => (prev === 'all' ? 'arrival' : prev === 'arrival' ? 'departure' : 'all'));
  };

  const handleResetExplorer = () => {
    setSelectedAirport('all');
    setActiveCategory('airlines');
    setSelectedLeafId(null);
    setSelectedCorridor(null);
    setSelectedCountry(null);
    setSelectedHeatmapDay(null);
    setSelectedHeatmapMonth(null);
    setRecordFilter('all');
    setDirectionFilter('all');
    setSearchQuery('');
    setZoom(1);
    setMapResetSignal((s) => s + 1);
    setActiveView('explorer');
  };

  const filterContextLabel = useMemo(() => {
    const parts: string[] = [];
    if (recordFilter === 'observed') parts.push('مرصود فقط');
    else if (recordFilter === 'scheduled') parts.push('مجدول فقط');
    if (directionFilter === 'arrival') parts.push('وصول فقط');
    else if (directionFilter === 'departure') parts.push('مغادرة فقط');
    return parts.length > 0 ? parts.join(' · ') : undefined;
  }, [recordFilter, directionFilter]);

  const mapSearchMatchCount = useMemo(() => {
    const q = normalizeArabicText(searchQuery);
    if (!q || !corridorsData?.corridors) return 0;
    return corridorsData.corridors.filter(
      (c) =>
        c.destination_iata.toLowerCase().includes(q) ||
        normalizeArabicText(c.destination_city).includes(q) ||
        normalizeArabicText(translateCity(c.destination_city)).includes(q) ||
        normalizeArabicText(c.country_name).includes(q) ||
        normalizeArabicText(translateCountry(c.country_name)).includes(q) ||
        c.origin_iata.toLowerCase().includes(q) ||
        c.airlines.some(
          (a) => normalizeArabicText(a).includes(q) || normalizeArabicText(translateAirline(a)).includes(q)
        )
    ).length;
  }, [corridorsData, searchQuery]);

  const matchCountHint = useMemo(() => {
    if (!searchQuery.trim()) return null;
    if (spatialMode === 'graph') return visibleLeaves.length;
    if (spatialMode === 'map') return mapSearchMatchCount;
    return null;
  }, [mapSearchMatchCount, searchQuery, spatialMode, visibleLeaves.length]);

  const zoomControlsDisabled = activeView !== 'explorer' || spatialMode === 'heatmap';

  const recordFilterLabel =
    recordFilter === 'all' ? 'الكل' : recordFilter === 'observed' ? 'مرصود' : 'مجدول';
  const directionFilterLabel =
    directionFilter === 'all' ? 'الاتجاهين' : directionFilter === 'arrival' ? 'وصول' : 'مغادرة';

  const activeScopeTitle =
    selectedAirport === 'all'
      ? 'شبكة الطيران المدني السورية'
      : airports.find((a) => a.airport_id === selectedAirport)?.name_ar ||
        SYRIAN_AIRPORT_NAMES_AR[selectedAirport] ||
        airports.find((a) => a.airport_id === selectedAirport)?.name ||
        selectedAirport;

  return (
    <div className="relative flex min-h-screen flex-col text-slate-100">
      {/* Top Floating Chrome Bar */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-white/[0.06] bg-[#040909]/80 px-4 backdrop-blur-xl sm:px-6">
        {/* Start: Drawer Button + Gold Emblem Brand */}
        <div className="flex items-center gap-3.5 min-w-0">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="فتح قائمة مساحات العمل"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 transition-colors hover:border-[#d9be8b]/40 hover:text-white"
          >
            <Menu className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setActiveView('explorer')}
            className="flex items-center gap-2.5 text-start min-w-0"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#d9be8b]/40 bg-gradient-to-br from-[#d9be8b]/25 to-[#0d2222] text-[#ebd8ab] shadow-[0_0_16px_rgba(217,190,139,0.2)]">
              <Plane className="h-4 w-4" />
            </span>
            <span className="flex flex-col leading-tight min-w-0">
              <span className="font-display text-xs font-semibold text-white whitespace-nowrap sm:text-[13px]">
                المطارات السورية
              </span>
              <span className="text-[11px] text-slate-400 whitespace-nowrap">
                محرك البيانات
              </span>
            </span>
          </button>
        </div>

        {/* Center Segmented Dark-Glass Dock */}
        <div className="hidden md:flex items-center gap-1.5 rounded-2xl border border-white/10 bg-[#0a1314]/90 p-1 shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          {/* Explorer (Graph | Route Map | Matrix) vs Ledger Quick Toggle */}
          <div className="flex items-center rounded-xl bg-white/[0.03] p-0.5">
            <button
              type="button"
              onClick={() => {
                setActiveView('explorer');
                setSpatialMode('graph');
              }}
              title="الشبكة المكانية التفاعلية"
              aria-label="الشبكة المكانية التفاعلية"
              className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                activeView === 'explorer' && spatialMode === 'graph'
                  ? 'border border-[#d9be8b]/40 bg-[#142322] text-[#f0ddb2]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <GitFork className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">الشبكة</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveView('explorer');
                setSpatialMode('map');
              }}
              title="خريطة المسارات الجوية والممرات (D3)"
              aria-label="خريطة المسارات الجوية والممرات (D3)"
              className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                activeView === 'explorer' && spatialMode === 'map'
                  ? 'border border-[#d9be8b]/40 bg-[#142322] text-[#f0ddb2]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Globe className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">خريطة المسارات</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveView('explorer');
                setSpatialMode('heatmap');
              }}
              title="خريطة مصفوفة التغطية"
              aria-label="خريطة مصفوفة التغطية"
              className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                activeView === 'explorer' && spatialMode === 'heatmap'
                  ? 'border border-[#d9be8b]/40 bg-[#142322] text-[#f0ddb2]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Grid3X3 className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">المصفوفة</span>
            </button>
            <button
              type="button"
              onClick={() => handleExploreDetails('flights')}
              title="سجل أحداث الرحلات"
              aria-label="سجل أحداث الرحلات"
              className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                activeView === 'flights'
                  ? 'border border-[#d9be8b]/40 bg-[#142322] text-[#f0ddb2]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Table2 className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">السجل</span>
            </button>
          </div>

          <span className="h-5 w-px bg-white/10" aria-hidden="true" />

          {/* Zoom Controls */}
          <div className="flex items-center gap-0.5 px-0.5">
            <button
              type="button"
              disabled={zoomControlsDisabled}
              onClick={() => setZoom((z) => Math.min(2.4, Number((z + 0.15).toFixed(2))))}
              aria-label="تكبير"
              title={zoomControlsDisabled ? 'التكبير غير متاح في عرض المصفوفة' : 'تكبير'}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-slate-300"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={zoomControlsDisabled}
              onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.15).toFixed(2))))}
              aria-label="تصغير"
              title={zoomControlsDisabled ? 'التصغير غير متاح في عرض المصفوفة' : 'تصغير'}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-slate-300"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
          </div>

          <span className="h-5 w-px bg-white/10" aria-hidden="true" />

          {/* Evidence Filter Toggle */}
          <button
            type="button"
            onClick={cycleRecordFilter}
            title={`تصفية الإثبات: ${recordFilterLabel}`}
            className="relative flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.07] hover:text-white whitespace-nowrap"
          >
            <Filter className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">{recordFilterLabel}</span>
            {recordFilter !== 'all' && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#d9be8b] px-1 font-mono text-[9px] font-bold text-slate-950">
                1
              </span>
            )}
          </button>

          {/* Direction Filter Toggle */}
          <button
            type="button"
            onClick={cycleDirectionFilter}
            title={`تصفية الاتجاه: ${directionFilterLabel}`}
            className="relative flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.07] hover:text-white whitespace-nowrap"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">{directionFilterLabel}</span>
            {directionFilter !== 'all' && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-400 px-1 font-mono text-[9px] font-bold text-slate-950">
                1
              </span>
            )}
          </button>

          <span className="h-5 w-px bg-white/10" aria-hidden="true" />

          {/* Reset Explorer */}
          <button
            type="button"
            onClick={handleResetExplorer}
            title="إعادة ضبط المستكشف المكاني"
            aria-label="إعادة ضبط المستكشف المكاني"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/[0.07] hover:text-[#d9be8b]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* End Actions: Scope Select + Export CSV + Search Trigger */}
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={selectedAirport}
            onChange={(e) => {
              setSelectedAirport(e.target.value);
              setSelectedLeafId(null);
              setSelectedCorridor(null);
              setSelectedCountry(null);
            }}
            aria-label="نطاق المطار"
            className="hidden sm:block rounded-lg border border-white/15 bg-[#0a1415] px-2.5 py-1.5 text-xs text-slate-200 focus:border-[#d9be8b]/50 focus:outline-none"
          >
            {AIRPORT_SCOPE_LIST.map((ap) => (
              <option key={ap.id} value={ap.id}>
                {ap.label}
              </option>
            ))}
          </select>

          <a
            href="/api/export/all_syrian_flight_events?format=csv&include_metadata=true"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:border-[#d9be8b]/50 hover:bg-white/[0.12] whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-[#d9be8b]" />
            <span>تصدير CSV</span>
          </a>

          <button
            type="button"
            onClick={() => {
              setActiveView('explorer');
              setTimeout(() => {
                const input = document.querySelector<HTMLInputElement>(
                  'input[aria-label="تصفية عقد الرسم أو الاستعلام في سجل الرحلات"]'
                );
                input?.focus();
              }, 50);
            }}
            aria-label="الانتقال إلى حقل البحث"
            className="hidden sm:flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Mobile Explorer quick-control bar (< md) */}
      {activeView === 'explorer' && (
        <div className="flex md:hidden items-center justify-between gap-2 overflow-x-auto border-b border-white/[0.06] bg-[#071011]/90 px-4 py-2">
          <div className="flex items-center gap-1 rounded-lg bg-white/[0.04] p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setSpatialMode('graph')}
              className={`rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap ${
                spatialMode === 'graph' ? 'bg-[#142322] text-[#f0ddb2]' : 'text-slate-400'
              }`}
            >
              الشبكة
            </button>
            <button
              type="button"
              onClick={() => setSpatialMode('map')}
              className={`rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap ${
                spatialMode === 'map' ? 'bg-[#142322] text-[#f0ddb2]' : 'text-slate-400'
              }`}
            >
              خريطة المسارات
            </button>
            <button
              type="button"
              onClick={() => setSpatialMode('heatmap')}
              className={`rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap ${
                spatialMode === 'heatmap' ? 'bg-[#142322] text-[#f0ddb2]' : 'text-slate-400'
              }`}
            >
              المصفوفة
            </button>
            <button
              type="button"
              onClick={() => handleExploreDetails('flights')}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-slate-400 whitespace-nowrap"
            >
              السجل
            </button>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <select
              value={selectedAirport}
              onChange={(e) => {
                setSelectedAirport(e.target.value);
                setSelectedLeafId(null);
                setSelectedCorridor(null);
                setSelectedCountry(null);
              }}
              aria-label="نطاق المطار للجوال"
              className="sm:hidden rounded-md border border-white/15 bg-[#0a1415] px-2 py-1 text-[11px] text-slate-200"
            >
              {AIRPORT_SCOPE_LIST.map((ap) => (
                <option key={ap.id} value={ap.id}>
                  {ap.id === 'all' ? 'كل المطارات' : ap.id}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={cycleRecordFilter}
              className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-300 whitespace-nowrap"
            >
              {recordFilterLabel}
            </button>
            <button
              type="button"
              onClick={cycleDirectionFilter}
              className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-300 whitespace-nowrap"
            >
              {directionFilterLabel}
            </button>
            <button
              type="button"
              onClick={handleResetExplorer}
              aria-label="إعادة ضبط المستكشف"
              className="rounded-md border border-white/10 bg-white/[0.04] p-1 text-slate-300"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Sub-workspace Ribbon when inside secondary analytical modules */}
      {activeView !== 'explorer' && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#071011]/90 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-2 overflow-x-auto">
            {WORKSPACE_NAV.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'border border-[#d9be8b]/40 bg-[#142322] text-[#f0ddb2]'
                      : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.shortLabel}</span>
                </button>
              );
            })}
          </div>
          <span className="text-[11px] text-slate-400">
            التوقيت المحلي: <span className="dir-ltr font-mono">Asia/Damascus</span> · {activeScopeTitle}
          </span>
        </div>
      )}

      {/* Slide-over Navigation Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/65 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="relative flex w-80 max-w-[85vw] flex-col border-e border-white/10 bg-[#071011]/95 p-5 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#d9be8b]/40 bg-[#d9be8b]/15 text-[#ebd8ab]">
                  <Plane className="h-4 w-4" />
                </span>
                <div>
                  <div className="font-display text-sm font-semibold text-white">
                    محرك بيانات المطارات السورية
                  </div>
                  <div className="font-mono text-[10px] text-slate-400 dir-ltr">v2.21 · Asia/Damascus</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="إغلاق قائمة التنقل"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 flex-1 space-y-6 overflow-y-auto">
              <div>
                <p className="px-2 pb-2 text-[11px] font-medium text-slate-400">
                  مساحات العمل التحليلية
                </p>
                <nav className="space-y-1">
                  {WORKSPACE_NAV.map((item) => {
                    const Icon = item.icon;
                    const active = activeView === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setActiveView(item.id);
                          if (item.id === 'explorer') setSpatialMode('graph');
                          setDrawerOpen(false);
                        }}
                        className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-xs font-medium transition-colors whitespace-nowrap ${
                          active
                            ? 'border border-[#d9be8b]/40 bg-[#132221] text-[#f0ddb2]'
                            : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView('explorer');
                      setSpatialMode('map');
                      setDrawerOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-xs font-medium transition-colors whitespace-nowrap ${
                      activeView === 'explorer' && spatialMode === 'map'
                        ? 'border border-[#d9be8b]/40 bg-[#132221] text-[#f0ddb2]'
                        : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                    }`}
                  >
                    <Globe className="h-4 w-4 shrink-0" />
                    <span>خريطة الممرات الدائرية D3</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView('explorer');
                      setSpatialMode('heatmap');
                      setDrawerOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-xs font-medium transition-colors whitespace-nowrap ${
                      activeView === 'explorer' && spatialMode === 'heatmap'
                        ? 'border border-[#d9be8b]/40 bg-[#132221] text-[#f0ddb2]'
                        : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                    }`}
                  >
                    <Grid3X3 className="h-4 w-4 shrink-0" />
                    <span>خريطة كثافة التغطية</span>
                  </button>
                </nav>
              </div>

              <div className="border-t border-white/10 pt-5">
                <p className="px-2 pb-2 text-[11px] font-medium text-slate-400">
                  نطاق المطار
                </p>
                <div className="space-y-1">
                  {AIRPORT_SCOPE_LIST.map((ap) => {
                    const isSel = selectedAirport === ap.id;
                    return (
                      <button
                        key={ap.id}
                        type="button"
                        onClick={() => {
                          setSelectedAirport(ap.id);
                          setSelectedLeafId(null);
                          setSelectedCorridor(null);
                          setSelectedCountry(null);
                          setDrawerOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-start text-xs transition-colors whitespace-nowrap ${
                          isSel
                            ? 'bg-white text-slate-950 font-semibold'
                            : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                        }`}
                      >
                        <span>{ap.label}</span>
                        {isSel && <Building2 className="h-3.5 w-3.5" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-white/10 px-2 pt-4 text-[11px] leading-relaxed text-slate-400">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-slate-200">
                  <Database className="h-3.5 w-3.5 text-[#d9be8b]" />
                  الثابت المنهجي
                </div>
                تبقى قوائم FIDS المجدولة والعمليات المبلّغ عنها تجارياً ومجاميع 2024 الكلية (DAM_ALP_LTK) مفصولة بصرامة، ولا يُحوَّل غياب القياسات أبداً إلى صفر.
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Main Viewport */}
      {activeView === 'explorer' ? (
        <main className="mx-auto flex w-full max-w-[1540px] flex-1 flex-col px-4 py-4 sm:px-6 lg:py-5">
          <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Start ~62%: Switchable between Radial Network Graph, D3 Corridor Choropleth Map, and Heatmap */}
            <section className="relative flex min-h-[580px] flex-col justify-between lg:col-span-7 xl:col-span-8">
              {spatialMode === 'heatmap' ? (
                <CoverageMatrixHeatmap
                  selectedAirport={selectedAirport}
                  compact
                  onSelectDailyCell={(cell) => {
                    setSelectedHeatmapMonth(null);
                    setSelectedHeatmapDay(cell);
                  }}
                  onSelectMonthCell={(cell) => {
                    setSelectedHeatmapDay(null);
                    setSelectedHeatmapMonth(cell);
                  }}
                />
              ) : spatialMode === 'map' ? (
                <CorridorMapCanvas
                  data={corridorsData}
                  loading={corridorsLoading}
                  selectedAirport={selectedAirport}
                  selectedCorridorId={selectedCorridor?.id ?? null}
                  selectedCountryIso={selectedCountry?.country_iso_num ?? null}
                  metricMode={mapMetricMode}
                  onMetricModeChange={setMapMetricMode}
                  onSelectOrigin={(apId) => {
                    setSelectedAirport(apId);
                    setSelectedCorridor(null);
                    setSelectedCountry(null);
                  }}
                  onSelectCorridor={(corr) => {
                    setSelectedCountry(null);
                    setSelectedCorridor(corr);
                  }}
                  onSelectCountry={(country) => {
                    setSelectedCorridor(null);
                    setSelectedCountry(country);
                  }}
                  zoom={zoom}
                  resetSignal={mapResetSignal}
                  searchQuery={searchQuery}
                  filterContextLabel={filterContextLabel}
                />
              ) : loadingExplorer && airports.length === 0 ? (
                <div className="flex h-full min-h-[580px] items-center justify-center rounded-2xl border border-white/10 bg-[#071011]/60 text-xs text-slate-400">
                  جارٍ تهيئة شبكة قياسات المطارات السورية...
                </div>
              ) : (
                <NetworkGraphCanvas
                  rootTitle={
                    selectedAirport === 'all' ? 'المطارات السورية' : `بوابة ${SYRIAN_CITY_SHORT_AR[selectedAirport] || selectedAirport}`
                  }
                  rootSubtitle={
                    selectedAirport === 'all' ? 'DAM · ALP · DEZ · LTK · KAC' : activeScopeTitle
                  }
                  rootGapLabel={`${(stats?.total_verified_flights ?? compTotals.total).toLocaleString('en-US')} حدث · ${audit?.total_mislabeled_evidence_records ?? 76} مدقق`}
                  categories={categories}
                  activeCategory={activeCategory}
                  onSelectCategory={(cat) => {
                    setActiveCategory(cat);
                    setSelectedLeafId(null);
                  }}
                  leaves={visibleLeaves}
                  selectedLeafId={selectedLeafId}
                  onSelectLeaf={(leaf) => {
                    setSelectedLeafId((prev) => (prev === leaf.id ? null : leaf.id));
                  }}
                  zoom={zoom}
                />
              )}

              {/* Bottom quick-switch strip */}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-2 text-[11px] text-slate-400">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setSpatialMode((m) =>
                        m === 'graph' ? 'map' : m === 'map' ? 'heatmap' : 'graph'
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-[#d9be8b]/40 bg-[#142322]/90 px-2.5 py-1 text-[11px] font-medium text-[#f0ddb2] transition-colors hover:bg-[#1c3230] whitespace-nowrap"
                  >
                    {spatialMode === 'graph' ? (
                      <>
                        <Globe className="h-3 w-3" />
                        <span>خريطة المسارات D3</span>
                      </>
                    ) : spatialMode === 'map' ? (
                      <>
                        <Grid3X3 className="h-3 w-3" />
                        <span>خريطة التغطية</span>
                      </>
                    ) : (
                      <>
                        <GitFork className="h-3 w-3" />
                        <span>الشبكة المكانية</span>
                      </>
                    )}
                  </button>

                  {WORKSPACE_NAV.slice(1, 6).map((nav) => (
                    <button
                      key={nav.id}
                      type="button"
                      onClick={() => handleExploreDetails(nav.id)}
                      className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:border-[#d9be8b]/40 hover:bg-white/[0.07] hover:text-white whitespace-nowrap"
                    >
                      {nav.shortLabel}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-slate-500">
                  {spatialMode === 'heatmap'
                    ? 'الأخضر الداكن = كثافة أعلى · الفاتح = فجوات بيانات'
                    : spatialMode === 'map'
                      ? 'انقر على أي محور مطار سوري أو دولة أو قوس ممر'
                      : 'انقر على أي فئة أو عقدة ذهبية لاستعراض القياسات'}
                </span>
              </div>
            </section>

            {/* End ~38%: Frosted Obsidian-Emerald Inspector Panel */}
            <div ref={searchInputFocusRef} className="lg:col-span-5 xl:col-span-4">
              <InspectorPanel
                data={inspectorData}
                scopeLabel={selectedAirport === 'all' ? 'كل المطارات' : selectedAirport}
                matchCountHint={matchCountHint}
                searchQuery={searchQuery}
                onSearchQueryChange={setSearchQuery}
                onSubmitSearch={handleSubmitQuery}
                onExploreDetails={handleExploreDetails}
                onClearSearch={() => setSearchQuery('')}
              />
            </div>
          </div>
        </main>
      ) : (
        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 sm:p-6">
          {activeView === 'overview' && (
            <OverviewView
              selectedAirport={selectedAirport}
              onSelectAirport={setSelectedAirport}
              onNavigate={setActiveView}
            />
          )}
          {activeView === 'flights' && (
            <FlightOpsView
              selectedAirport={selectedAirport}
              initialAirport={ledgerPrefill.airportId || undefined}
              initialAirlineQuery={ledgerPrefill.airlineQuery}
              initialMovementType={ledgerPrefill.movementType}
              initialRecordNature={ledgerPrefill.recordNature}
              initialDestination={ledgerPrefill.destination}
            />
          )}
          {activeView === 'monitor' && <MonitorView selectedAirport={selectedAirport} />}
          {activeView === 'fids' && <ArchivedFidsView />}
          {activeView === 'coverage' && <CoverageAuditView />}
          {activeView === 'exports' && <ExportsView />}
        </main>
      )}
    </div>
  );
}
