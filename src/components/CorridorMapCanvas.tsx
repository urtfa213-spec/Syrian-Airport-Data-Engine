import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { feature } from 'topojson-client';
import countriesAtlas from 'world-atlas/countries-50m.json';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import type {
  CorridorOrigin,
  CorridorsResponse,
  CountryChoroplethStat,
  FlightCorridor,
} from '../types/aviation';
import {
  SYRIAN_AIRPORT_NAMES_AR,
  SYRIAN_CITY_SHORT_AR,
  normalizeArabicText,
  translateAirline,
  translateCity,
  translateCountry,
} from '../i18n/ar';

export type MapMetricMode = 'combined' | 'observed' | 'fids';
export type RegionFrame = 'network' | 'levant_gulf' | 'syria';

interface CorridorMapCanvasProps {
  data: CorridorsResponse | null;
  loading: boolean;
  selectedAirport: string;
  selectedCorridorId: string | null;
  selectedCountryIso: string | null;
  metricMode: MapMetricMode;
  onMetricModeChange: (mode: MapMetricMode) => void;
  onSelectOrigin: (airportId: string) => void;
  onSelectCorridor: (corridor: FlightCorridor | null) => void;
  onSelectCountry: (country: CountryChoroplethStat | null) => void;
  zoom: number;
  resetSignal?: number;
  searchQuery?: string;
  filterContextLabel?: string;
}

interface TooltipState {
  x: number;
  y: number;
  title: string;
  subtitle: string;
  metrics: Array<{ label: string; value: string }>;
}

interface ChoroplethBin {
  index: number;
  label: string;
  min: number;
  max: number;
  color: string;
}

// High-contrast dark cartographic color system:
// Separates deep abyssal ocean, crisp state boundaries, 5 luminance-stepped emerald-slate
// choropleth tiers, and luminous gold / ice-sky corridor arcs with dark ink casings.
const MAP_PALETTE = {
  chromeBg: '#071219',
  chromeBorder: 'rgba(186, 220, 235, 0.12)',
  oceanBg: '#050b10',
  graticuleStroke: 'rgba(148, 184, 206, 0.12)',
  unconnectedLandFill: '#111d26',
  unconnectedLandStroke: '#354f61',
  connectedLandStroke: 'rgba(186, 224, 240, 0.62)',
  syriaHatchBase: '#16232b',
  syriaBorder: '#fbbf24',
  countryHoverStroke: '#fde047',
  countrySelectedStroke: '#ffffff',
  choroplethTiers: [
    '#0f2d38', // Tier 1: Abyssal Petrol
    '#14444e', // Tier 2: Deep Harbor Teal
    '#185d61', // Tier 3: Slate Teal
    '#1d7873', // Tier 4: Verdigris Emerald
    '#249383', // Tier 5: Luminous Jade
  ] as readonly string[],
  corridorCasing: '#03070b',
  observedLine: '#fbbf24', // High-luminance Amber-Gold for observed operational flights
  scheduledLine: '#7ce7ff', // High-luminance Ice-Sky for scheduled & archived FIDS
  selectedLine: '#ffffff', // Pure white highlight for active/hovered corridor
  outboundArrow: '#fef08a', // Luminous champagne-gold arrow for departures (Origin -> Dest)
  inboundArrow: '#34d399', // Luminous radar-emerald arrow for arrivals (Dest -> Origin)
  airspaceOriginStroke: '#fbbf24',
  airspaceDestStroke: '#7ce7ff',
  labelHalo: '#03070b',
  pinStroke: '#03070b',
  inactiveOriginFill: '#cbd5e1',
} as const;

const CHOROPLETH_COLORS = MAP_PALETTE.choroplethTiers;

// Geographic bounding boxes [minLon, minLat, maxLon, maxLat]
const REGION_BOUNDS: Record<RegionFrame, { label: string; box: [number, number, number, number] }> = {
  network: { label: 'الشبكة', box: [-2, 19, 61, 58] },
  levant_gulf: { label: 'المشرق والخليج', box: [25.5, 20, 59.5, 42.8] },
  syria: { label: 'مطارات سوريا', box: [34.4, 32.0, 42.8, 37.7] },
};

// MultiPoint avoids GeoJSON spherical ring-winding ambiguity so Europe/MENA fills the map canvas
const NETWORK_FIT_FEATURE: GeoJSON.Feature<GeoJSON.MultiPoint> = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'MultiPoint',
    coordinates: [
      [2, 18],
      [60, 18],
      [60, 57],
      [2, 57],
      [31, 38],
    ],
  },
};

const SYRIAN_LABEL_OFFSETS: Record<string, { dx: number; dy: number; anchor: 'start' | 'end' }> = {
  DAM: { dx: -12, dy: 2, anchor: 'end' },
  ALP: { dx: -12, dy: -9, anchor: 'end' },
  LTK: { dx: -13, dy: 3, anchor: 'end' },
  DEZ: { dx: 12, dy: 6, anchor: 'start' },
  KAC: { dx: 12, dy: -9, anchor: 'start' },
  PMS: { dx: 9, dy: 11, anchor: 'start' },
};

// Explicit [lon, lat] anchors in open polygon interiors so MultiPolygon countries (e.g. Russia) stay framed
const ATLAS_COUNTRY_LABELS: Record<string, { text: string; coords: [number, number] }> = {
  '792': { text: 'تركيا', coords: [33.8, 39.2] },
  '682': { text: 'السعودية', coords: [44.2, 23.8] },
  '368': { text: 'العراق', coords: [43.6, 33.1] },
  '818': { text: 'مصر', coords: [29.8, 26.8] },
  '364': { text: 'إيران', coords: [53.4, 32.6] },
  '512': { text: 'عُمان', coords: [56.2, 21.2] },
  '276': { text: 'ألمانيا', coords: [10.4, 50.6] },
  '642': { text: 'رومانيا', coords: [24.9, 45.9] },
  '434': { text: 'ليبيا', coords: [17.5, 27.2] },
  '643': { text: 'روسيا', coords: [41.5, 53.5] },
};

function buildCurvedArcPath(
  p1: [number, number],
  p2: [number, number],
  curveSign: number,
  spreadFactor: number
): {
  path: string;
  reversePath: string;
  mid: [number, number];
  angleDeg: number;
  distance: number;
} {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy) || 1;

  const nx = -dy / dist;
  const ny = dx / dist;

  const bend = Math.min(48, dist * 0.17) * curveSign + spreadFactor * 11;
  const cx = (x1 + x2) / 2 + nx * bend;
  const cy = (y1 + y2) / 2 + ny * bend;

  const midX = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
  const midY = 0.25 * y1 + 0.5 * cy + 0.25 * y2;
  // Tangent vector at t = 0.5 of quadratic Bezier equals p2 - p1
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

  return {
    path: `M ${x1.toFixed(1)},${y1.toFixed(1)} Q ${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`,
    reversePath: `M ${x2.toFixed(1)},${y2.toFixed(1)} Q ${cx.toFixed(1)},${cy.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`,
    mid: [midX, midY],
    angleDeg,
    distance: dist,
  };
}

export function CorridorMapCanvas({
  data,
  loading,
  selectedAirport,
  selectedCorridorId,
  selectedCountryIso,
  metricMode,
  onMetricModeChange,
  onSelectOrigin,
  onSelectCorridor,
  onSelectCountry,
  zoom,
  resetSignal = 0,
  searchQuery = '',
  filterContextLabel,
}: CorridorMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const prevZoomPropRef = useRef<number>(zoom);
  const prevResetSignalRef = useRef<number>(resetSignal);
  const zoomTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);

  const [size, setSize] = useState<{ width: number; height: number }>({ width: 920, height: 500 });
  const [regionFrame, setRegionFrame] = useState<RegionFrame>('network');
  const [zoomTransform, setZoomTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);
  const currentK = zoomTransform.k;
  const [hoveredCountryIso, setHoveredCountryIso] = useState<string | null>(null);
  const [hoveredCorridorId, setHoveredCorridorId] = useState<string | null>(null);
  const [hoveredDestIata, setHoveredDestIata] = useState<string | null>(null);
  const [hoveredBinIndex, setHoveredBinIndex] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [showFlowArrows, setShowFlowArrows] = useState<boolean>(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 120 && rect.height > 120) {
        setSize({
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const svgW = size.width;
  const svgH = size.height;

  const { countryFeatures, graticuleGeo } = useMemo(() => {
    const fc = feature(
      countriesAtlas as unknown as Parameters<typeof feature>[0],
      countriesAtlas.objects.countries as unknown as Parameters<typeof feature>[1]
    ) as unknown as GeoJSON.FeatureCollection<GeoJSON.Geometry, { name?: string }>;
    const filtered = fc.features.filter((f) => String(f.id) !== '010');
    return {
      countryFeatures: filtered,
      graticuleGeo: d3.geoGraticule().step([10, 10])(),
    };
  }, []);

  const projection = useMemo(() => {
    return d3.geoNaturalEarth1().fitExtent(
      [
        [28, 22],
        [Math.max(200, svgW - 28), Math.max(180, svgH - 22)],
      ],
      NETWORK_FIT_FEATURE
    );
  }, [svgW, svgH]);

  const pathGenerator = useMemo(() => d3.geoPath(projection), [projection]);

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.85, 10])
      .translateExtent([
        [-svgW * 0.45, -svgH * 0.45],
        [svgW * 1.45, svgH * 1.45],
      ])
      .on('zoom', (event) => {
        zoomTransformRef.current = event.transform;
        g.attr('transform', event.transform.toString());
        setZoomTransform(event.transform);
      });

    svg.call(zoomBehavior);
    // Preserve active zoom transform cleanly across container resize
    if (zoomTransformRef.current !== d3.zoomIdentity) {
      svg.call(zoomBehavior.transform, zoomTransformRef.current);
    }
    zoomBehaviorRef.current = zoomBehavior;

    return () => {
      svg.on('.zoom', null);
    };
  }, [svgW, svgH]);

  useEffect(() => {
    if (zoom === prevZoomPropRef.current) return;
    const factor = zoom / (prevZoomPropRef.current || 1);
    prevZoomPropRef.current = zoom;
    if (!svgRef.current || !zoomBehaviorRef.current || !Number.isFinite(factor) || factor <= 0) return;

    d3.select(svgRef.current)
      .transition()
      .duration(180)
      .call(zoomBehaviorRef.current.scaleBy, factor);
  }, [zoom]);

  const handleMapStepZoom = (factor: number) => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(200)
      .call(zoomBehaviorRef.current.scaleBy, factor);
  };

  const applyRegionFrame = useCallback(
    (frame: RegionFrame) => {
      setRegionFrame(frame);
      if (!svgRef.current || !zoomBehaviorRef.current) return;
      const svg = d3.select(svgRef.current);

      if (frame === 'network') {
        svg
          .transition()
          .duration(340)
          .ease(d3.easeCubicOut)
          .call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
        return;
      }

      const [minLon, minLat, maxLon, maxLat] = REGION_BOUNDS[frame].box;
      const nw = projection([minLon, maxLat]);
      const se = projection([maxLon, minLat]);
      if (!nw || !se) return;

      const dx = Math.max(10, Math.abs(se[0] - nw[0]));
      const dy = Math.max(10, Math.abs(se[1] - nw[1]));
      const cx = (nw[0] + se[0]) / 2;
      const cy = (nw[1] + se[1]) / 2;
      const k = Math.min(8.5, Math.min((svgW * 0.86) / dx, (svgH * 0.86) / dy));
      const tx = svgW / 2 - k * cx;
      const ty = svgH / 2 - k * cy;

      svg
        .transition()
        .duration(380)
        .ease(d3.easeCubicOut)
        .call(zoomBehaviorRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
    },
    [projection, svgW, svgH]
  );

  // Sync top-bar Reset button with D3 pan/zoom/region frame
  useEffect(() => {
    if (resetSignal === prevResetSignalRef.current) return;
    prevResetSignalRef.current = resetSignal;
    prevZoomPropRef.current = 1;
    applyRegionFrame('network');
  }, [resetSignal, applyRegionFrame]);

  const getCorridorValue = useCallback(
    (c: FlightCorridor): number => {
      if (metricMode === 'observed') return c.observed_events;
      if (metricMode === 'fids') return c.fids_slots;
      return c.total_events + c.fids_slots;
    },
    [metricMode]
  );

  const getCountryValue = useCallback(
    (ct: CountryChoroplethStat): number => {
      if (metricMode === 'observed') return ct.observed_events;
      if (metricMode === 'fids') return ct.fids_slots;
      return ct.total_events + ct.fids_slots;
    },
    [metricMode]
  );

  const countryStatMap = useMemo(() => {
    const map = new Map<string, CountryChoroplethStat>();
    for (const ct of data?.country_totals ?? []) {
      map.set(String(ct.country_iso_num).padStart(3, '0'), ct);
    }
    return map;
  }, [data]);

  const choroplethBins: ChoroplethBin[] = useMemo(() => {
    const destVals = (data?.country_totals ?? [])
      .filter((c) => c.country_iso_num !== '760')
      .map(getCountryValue)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);

    const maxVal = destVals.length > 0 ? destVals[destVals.length - 1] : 100;

    let cuts: [number, number, number, number];
    if (metricMode === 'observed') {
      cuts = [3, 10, 20, Math.max(30, Math.round(maxVal * 0.72))];
    } else if (maxVal <= 120) {
      cuts = [2, 8, 25, 65];
    } else {
      cuts = [15, 75, 250, 750];
    }

    const ranges: Array<[number, number]> = [
      [1, cuts[0]],
      [cuts[0] + 1, cuts[1]],
      [cuts[1] + 1, cuts[2]],
      [cuts[2] + 1, cuts[3]],
      [cuts[3] + 1, Math.max(cuts[3] + 1, maxVal)],
    ];

    return ranges.map(([min, max], idx) => ({
      index: idx,
      min,
      max,
      label: idx === 4 ? `${min.toLocaleString('en-US')}+` : `${min}-${max.toLocaleString('en-US')}`,
      color: CHOROPLETH_COLORS[idx],
    }));
  }, [data, getCountryValue, metricMode]);

  const getBinForValue = useCallback(
    (val: number): ChoroplethBin | null => {
      if (val <= 0) return null;
      for (let i = choroplethBins.length - 1; i >= 0; i--) {
        if (val >= choroplethBins[i].min) return choroplethBins[i];
      }
      return choroplethBins[0];
    },
    [choroplethBins]
  );

  const visibleCorridors = useMemo(() => {
    const list = data?.corridors ?? [];
    return [...list]
      .filter((c) => getCorridorValue(c) > 0)
      .sort((a, b) => getCorridorValue(a) - getCorridorValue(b));
  }, [data, getCorridorValue]);

  const normalizedQuery = normalizeArabicText(searchQuery);
  const matchingCorridorIds = useMemo(() => {
    if (!normalizedQuery) return null;
    const matched = new Set<string>();
    for (const c of visibleCorridors) {
      const originAr = SYRIAN_CITY_SHORT_AR[c.origin_iata] ?? '';
      const destCityAr = translateCity(c.destination_city);
      const countryAr = translateCountry(c.country_name);
      const countryCompactAr = translateCountry(c.country_name, true);
      const airlinesAr = c.airlines.map((a) => translateAirline(a)).join(' ');
      const hay = normalizeArabicText(
        `${c.origin_iata} ${originAr} ${c.destination_iata} ${c.destination_city} ${destCityAr} ${c.destination_name} ${c.country_name} ${countryAr} ${countryCompactAr} ${c.airlines.join(' ')} ${airlinesAr}`
      );
      if (hay.includes(normalizedQuery)) {
        matched.add(c.id);
      }
    }
    return matched;
  }, [visibleCorridors, normalizedQuery]);

  const maxCorridorMetric = useMemo(() => {
    return Math.max(1, ...visibleCorridors.map(getCorridorValue));
  }, [visibleCorridors, getCorridorValue]);

  const strokeWidthScale = useMemo(
    () => d3.scaleSqrt().domain([1, maxCorridorMetric]).range([1.45, 3.85]).clamp(true),
    [maxCorridorMetric]
  );

  const invScale = 1 / Math.pow(Math.max(0.85, currentK), 0.78);

  const syrianOrigins: CorridorOrigin[] = useMemo(() => {
    return (data?.origins ?? []).filter((o) => o.airport_id !== 'OMDM');
  }, [data]);

  // Unified Destination Pin Placement + Aggregated Metrics across Syrian origins
  // Computed BEFORE projectedCorridors so lines always terminate cleanly at each pin center [cx, cy]
  const destinationNodes = useMemo(() => {
    const byDest = new Map<
      string,
      {
        iata: string;
        city: string;
        country: string;
        lat: number;
        lon: number;
        metric: number;
        totalObserved: number;
        totalScheduled: number;
        totalFids: number;
        origins: string[];
        corridors: FlightCorridor[];
        topCorridor: FlightCorridor;
      }
    >();

    for (const c of visibleCorridors) {
      const m = getCorridorValue(c);
      const existing = byDest.get(c.destination_iata);
      if (!existing) {
        byDest.set(c.destination_iata, {
          iata: c.destination_iata,
          city: c.destination_city,
          country: c.country_name,
          lat: c.destination_lat,
          lon: c.destination_lon,
          metric: m,
          totalObserved: c.observed_events,
          totalScheduled: c.scheduled_events,
          totalFids: c.fids_slots,
          origins: [c.origin_iata],
          corridors: [c],
          topCorridor: c,
        });
      } else {
        existing.metric += m;
        existing.totalObserved += c.observed_events;
        existing.totalScheduled += c.scheduled_events;
        existing.totalFids += c.fids_slots;
        if (!existing.origins.includes(c.origin_iata)) existing.origins.push(c.origin_iata);
        existing.corridors.push(c);
        if (m > getCorridorValue(existing.topCorridor)) {
          existing.topCorridor = c;
        }
      }
    }

    const sorted = Array.from(byDest.values()).sort((a, b) => b.metric - a.metric);
    const placedPins: Array<{ x: number; y: number }> = [];
    const placedBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];

    // Seed Syria hub bounding boxes so foreign/domestic destination labels never overlap DAM/ALP/DEZ/LTK/KAC
    for (const orig of syrianOrigins) {
      const p = projection([orig.lon, orig.lat]);
      if (!p) continue;
      const off = SYRIAN_LABEL_OFFSETS[orig.airport_id] ?? { dx: -11, dy: -9, anchor: 'end' };
      placedBoxes.push({
        x: p[0] + (off.anchor === 'end' ? off.dx - 28 * invScale : off.dx),
        y: p[1] + off.dy - 8 * invScale,
        w: 32 * invScale,
        h: 13 * invScale,
      });
    }

    const minPinDist = 11.5 * invScale;
    const labelW = 28 * invScale;
    const labelH = 11 * invScale;

    return sorted
      .map((node, idx) => {
        const coords = projection([node.lon, node.lat]);
        if (!coords) return null;
        const [trueX, trueY] = coords;

        let cx = trueX;
        let cy = trueY;
        const clusterNeighbors = placedPins.filter(
          (p) => Math.hypot(p.x - trueX, p.y - trueY) < minPinDist
        ).length;
        if (clusterNeighbors > 0) {
          const angle = clusterNeighbors * Math.PI * 0.65 - Math.PI / 4;
          const nudge = minPinDist * 1.02;
          cx = trueX + Math.cos(angle) * nudge;
          cy = trueY + Math.sin(angle) * nudge;
        }
        placedPins.push({ x: cx, y: cy });

        const isSelected =
          node.corridors.some((c) => c.id === selectedCorridorId) ||
          selectedCountryIso === node.topCorridor.country_iso_num;
        const isSearchMatch =
          matchingCorridorIds !== null &&
          node.corridors.some((c) => matchingCorridorIds.has(c.id));

        const box = { x: cx + 4 * invScale, y: cy - 6 * invScale, w: labelW, h: labelH };
        const collides = placedBoxes.some(
          (b) =>
            box.x < b.x + b.w &&
            box.x + box.w > b.x &&
            box.y < b.y + b.h &&
            box.y + box.h > b.y
        );

        const allowLabel =
          isSelected ||
          isSearchMatch ||
          (!collides && (idx < 17 || currentK >= 1.55));
        if (allowLabel) placedBoxes.push(box);

        return {
          ...node,
          trueX,
          trueY,
          cx,
          cy,
          nudged: clusterNeighbors > 0,
          isSelected,
          isSearchMatch,
          allowLabel,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [
    visibleCorridors,
    getCorridorValue,
    projection,
    invScale,
    syrianOrigins,
    selectedCorridorId,
    selectedCountryIso,
    matchingCorridorIds,
    currentK,
  ]);

  const destPositionByIata = useMemo(() => {
    const map = new Map<string, [number, number]>();
    for (const n of destinationNodes) {
      map.set(n.iata, [n.cx, n.cy]);
    }
    return map;
  }, [destinationNodes]);

  const projectedCorridors = useMemo(() => {
    const countryPairCount = new Map<string, number>();
    return visibleCorridors
      .map((corr, idx) => {
        const p1 = projection([corr.origin_lon, corr.origin_lat]);
        const destPin = destPositionByIata.get(corr.destination_iata);
        const p2 = destPin ?? projection([corr.destination_lon, corr.destination_lat]);
        if (!p1 || !p2) return null;

        const pairKey = `${corr.origin_iata}-${corr.country_iso_num}`;
        const seen = countryPairCount.get(pairKey) ?? 0;
        countryPairCount.set(pairKey, seen + 1);

        const curveSign = corr.destination_lat >= corr.origin_lat ? 1 : -1;
        const spreadFactor =
          seen === 0 ? 0 : seen % 2 === 1 ? Math.ceil(seen / 2) : -Math.ceil(seen / 2);

        const { path, reversePath, mid, angleDeg, distance } = buildCurvedArcPath(
          [p1[0], p1[1]],
          [p2[0], p2[1]],
          curveSign,
          spreadFactor
        );

        return {
          corr,
          val: getCorridorValue(corr),
          path,
          reversePath,
          mid,
          angleDeg,
          distance,
          isMinor: idx < visibleCorridors.length - 16,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [visibleCorridors, projection, destPositionByIata, getCorridorValue]);

  const selectedOriginObj = useMemo(() => {
    if (selectedAirport === 'all') return null;
    return syrianOrigins.find((o) => o.airport_id === selectedAirport.toUpperCase()) ?? null;
  }, [selectedAirport, syrianOrigins]);

  const activeCorridorObj = useMemo(() => {
    if (!selectedCorridorId) return null;
    return visibleCorridors.find((c) => c.id === selectedCorridorId) ?? null;
  }, [selectedCorridorId, visibleCorridors]);

  const airspaceSectors = useMemo(() => {
    const sectors: Array<{
      key: string;
      outerPath: string;
      innerPath: string;
      center: [number, number];
      labelPos: [number, number];
      code: string;
      labelText: string;
      kind: 'origin' | 'destination';
      hasObserved: boolean;
    }> = [];

    if (selectedOriginObj) {
      const centerProj = projection([selectedOriginObj.lon, selectedOriginObj.lat]);
      if (centerProj) {
        const outerGeo = d3
          .geoCircle()
          .center([selectedOriginObj.lon, selectedOriginObj.lat])
          .radius(2.45)();
        const innerGeo = d3
          .geoCircle()
          .center([selectedOriginObj.lon, selectedOriginObj.lat])
          .radius(1.15)();
        const bounds = pathGenerator.bounds(outerGeo);
        sectors.push({
          key: `origin-airspace-${selectedOriginObj.airport_id}`,
          outerPath: pathGenerator(outerGeo) || '',
          innerPath: pathGenerator(innerGeo) || '',
          center: [centerProj[0], centerProj[1]],
          labelPos: [(bounds[0][0] + bounds[1][0]) / 2, bounds[0][1] - 4 * invScale],
          code: selectedOriginObj.iata_code,
          labelText: `مجال ${selectedOriginObj.iata_code} الجوي`,
          kind: 'origin',
          hasObserved: selectedOriginObj.observed_events > 0,
        });
      }
    }

    if (activeCorridorObj) {
      const destProj = projection([
        activeCorridorObj.destination_lon,
        activeCorridorObj.destination_lat,
      ]);
      if (destProj) {
        const outerGeo = d3
          .geoCircle()
          .center([activeCorridorObj.destination_lon, activeCorridorObj.destination_lat])
          .radius(1.75)();
        const innerGeo = d3
          .geoCircle()
          .center([activeCorridorObj.destination_lon, activeCorridorObj.destination_lat])
          .radius(0.85)();
        const bounds = pathGenerator.bounds(outerGeo);
        sectors.push({
          key: `dest-airspace-${activeCorridorObj.destination_iata}`,
          outerPath: pathGenerator(outerGeo) || '',
          innerPath: pathGenerator(innerGeo) || '',
          center: [destProj[0], destProj[1]],
          labelPos: [(bounds[0][0] + bounds[1][0]) / 2, bounds[0][1] - 4 * invScale],
          code: activeCorridorObj.destination_iata,
          labelText: `نطاق ${activeCorridorObj.destination_iata}`,
          kind: 'destination',
          hasObserved: activeCorridorObj.observed_events > 0,
        });
      }
    }

    return sectors;
  }, [selectedOriginObj, activeCorridorObj, projection, pathGenerator, invScale]);

  const activeFilterDirection = (data?.filters?.movement_type || 'all').toLowerCase();
  const animateFlowArrows = showFlowArrows && !prefersReducedMotion;

  const activeConnectedCountries = useMemo(() => {
    return (data?.country_totals ?? [])
      .filter((c) => c.country_iso_num !== '760' && getCountryValue(c) > 0)
      .sort((a, b) => getCountryValue(b) - getCountryValue(a));
  }, [data, getCountryValue]);

  const topCountriesPreview = useMemo(
    () => activeConnectedCountries.slice(0, 7),
    [activeConnectedCountries]
  );

  const axisTicks = useMemo(() => {
    const lonTicks = [0, 10, 20, 30, 40, 50, 60]
      .map((lon) => {
        const p = projection([lon, 30]);
        if (!p) return null;
        const x = zoomTransform.applyX(p[0]);
        if (x < 24 || x > svgW - 42) return null;
        return { label: `${lon}°E`, x };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const latTicks = [20, 30, 40, 50]
      .map((lat) => {
        const p = projection([25, lat]);
        if (!p) return null;
        const y = zoomTransform.applyY(p[1]);
        if (y < 18 || y > svgH - 22) return null;
        return { label: `${lat}°N`, y };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return { lonTicks, latTicks };
  }, [projection, zoomTransform, svgW, svgH]);

  const showRelativeTooltip = (
    evt: React.MouseEvent<SVGElement>,
    payload: Omit<TooltipState, 'x' | 'y'>
  ) => {
    if (evt.buttons !== 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rawX = evt.clientX - rect.left;
    const rawY = evt.clientY - rect.top;
    const flippedX = rawX > rect.width - 246 ? rawX - 234 : rawX + 14;
    const clampedY = Math.max(12, Math.min(rawY - 18, rect.height - 172));
    setTooltip({
      x: Math.max(12, flippedX),
      y: clampedY,
      ...payload,
    });
  };

  return (
    <div
      dir="rtl"
      className="flex h-full min-h-[580px] w-full flex-col overflow-hidden rounded-xl border select-none"
      style={{ backgroundColor: MAP_PALETTE.oceanBg, borderColor: MAP_PALETTE.chromeBorder }}
    >
      {/* Cartographic Header Strip */}
      <div
        className="flex flex-wrap items-center justify-between gap-2.5 border-b px-4 py-2.5"
        style={{ backgroundColor: MAP_PALETTE.chromeBg, borderColor: MAP_PALETTE.chromeBorder }}
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
          <h2 className="font-display text-xs font-semibold text-white whitespace-nowrap sm:text-[13px]">
            خريطة المسارات والكثافة الجغرافية
          </h2>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-[11px] text-slate-300 tabular-nums whitespace-nowrap">
            {selectedAirport === 'all' ? 'جميع البوابات السورية' : `بوابة ${SYRIAN_CITY_SHORT_AR[selectedAirport] ?? selectedAirport} (${selectedAirport})`}
            {selectedOriginObj ? ` · تظليل المجال الجوي: ${selectedOriginObj.iata_code}` : ''}
            {filterContextLabel ? ` · ${filterContextLabel}` : ''}
            {' · '}
            {visibleCorridors.length} مسار
            {' · '}
            {activeConnectedCountries.length} دولة متصلة
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Geographic Framing Presets */}
          <div className="flex items-center rounded-lg border border-white/10 bg-white/[0.03] p-0.5 text-[11px]">
            {(Object.keys(REGION_BOUNDS) as RegionFrame[]).map((frameKey) => (
              <button
                key={frameKey}
                type="button"
                onClick={() => applyRegionFrame(frameKey)}
                className={`rounded-md px-2 py-1 font-medium transition-colors whitespace-nowrap ${
                  regionFrame === frameKey
                    ? 'bg-white/15 text-white'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {REGION_BOUNDS[frameKey].label}
              </button>
            ))}
          </div>

          {/* Metric Layer Switch */}
          <div className="flex items-center rounded-lg border border-white/10 bg-white/[0.03] p-0.5 text-[11px]">
            {(
              [
                { id: 'combined', label: 'مدمج' },
                { id: 'observed', label: 'المرصود' },
                { id: 'fids', label: 'شاشات FIDS المؤرشفة' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onMetricModeChange(m.id)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                  metricMode === m.id
                    ? 'bg-[#17363e] text-[#fde68a] border border-[#fbbf24]/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Directional Flow Arrows Toggle */}
          <button
            type="button"
            onClick={() => setShowFlowArrows((v) => !v)}
            title={showFlowArrows ? 'إخفاء أسهم اتجاه الحركة المتحركة' : 'إظهار أسهم اتجاه الحركة المتحركة'}
            aria-pressed={showFlowArrows}
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
              showFlowArrows
                ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-white'
            }`}
          >
            {showFlowArrows ? 'أسهم الاتجاه: مفعلة' : 'أسهم الاتجاه: متوقفة'}
          </button>

          {/* Direct Map Zoom & Reset Controls */}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => handleMapStepZoom(1.35)}
              title="تكبير الخريطة"
              aria-label="تكبير الخريطة"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-slate-300 transition-colors hover:border-white/25 hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleMapStepZoom(0.75)}
              title="تصغير الخريطة"
              aria-label="تصغير الخريطة"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-slate-300 transition-colors hover:border-white/25 hover:text-white"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                applyRegionFrame('network');
                onSelectCountry(null);
                onSelectCorridor(null);
              }}
              title="إعادة ضبط إطار الخريطة والتحديد"
              aria-label="إعادة ضبط إطار الخريطة والتحديد"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-slate-300 transition-colors hover:border-[#fbbf24]/50 hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Responsive D3 Geo SVG Viewport */}
      <div
        ref={containerRef}
        dir="rtl"
        className="relative flex-1 overflow-hidden"
        style={{ backgroundColor: MAP_PALETTE.oceanBg }}
      >
        {loading && !data && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#050b10]/85 text-xs text-slate-200">
            جارٍ إسقاط الخرائط الجغرافية ومسارات الطيران بدقة 50م...
          </div>
        )}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="block h-full w-full cursor-grab active:cursor-grabbing"
          onMouseLeave={() => {
            setHoveredCountryIso(null);
            setHoveredCorridorId(null);
            setHoveredDestIata(null);
            setTooltip(null);
          }}
        >
          <defs>
            <pattern
              id="syriaOriginHatch"
              width={6}
              height={6}
              patternTransform="rotate(45 0 0)"
              patternUnits="userSpaceOnUse"
            >
              <rect width={6} height={6} fill={MAP_PALETTE.syriaHatchBase} />
              <line
                x1={0}
                y1={0}
                x2={0}
                y2={6}
                stroke={MAP_PALETTE.syriaBorder}
                strokeWidth={1.0}
                strokeOpacity={0.5}
              />
            </pattern>
            <radialGradient id="originAirspaceAmber" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.30" />
              <stop offset="52%" stopColor="#fbbf24" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.03" />
            </radialGradient>
            <radialGradient id="originAirspaceSky" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#7ce7ff" stopOpacity="0.28" />
              <stop offset="52%" stopColor="#7ce7ff" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#7ce7ff" stopOpacity="0.03" />
            </radialGradient>
            <radialGradient id="destAirspaceSky" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.24" />
              <stop offset="58%" stopColor="#7ce7ff" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#7ce7ff" stopOpacity="0.02" />
            </radialGradient>
          </defs>

          {/* Clickable Ocean Canvas */}
          <rect
            x={0}
            y={0}
            width={svgW}
            height={svgH}
            fill={MAP_PALETTE.oceanBg}
            onClick={() => {
              onSelectCountry(null);
              onSelectCorridor(null);
            }}
          />

          <g ref={gRef}>
            {/* 10° Navigation Graticule */}
            <path
              d={pathGenerator(graticuleGeo) || ''}
              fill="none"
              stroke={MAP_PALETTE.graticuleStroke}
              strokeWidth={0.6 * invScale}
              className="pointer-events-none"
            />

            {/* 50m Country Choropleth Layer */}
            <g>
              {countryFeatures.map((feat, idx) => {
                const iso = String(feat.id ?? idx).padStart(3, '0');
                const stat = countryStatMap.get(iso);
                const isSyria = iso === '760';
                const val = stat ? getCountryValue(stat) : 0;
                const bin = !isSyria ? getBinForValue(val) : null;

                const isSelected = selectedCountryIso === iso;
                const isHovered = hoveredCountryIso === iso;
                const isBinHighlighted = hoveredBinIndex !== null && bin?.index === hoveredBinIndex;
                const isDimmedByBin =
                  hoveredBinIndex !== null && bin !== null && bin.index !== hoveredBinIndex;

                const fillColor = isSyria
                  ? 'url(#syriaOriginHatch)'
                  : bin
                    ? bin.color
                    : MAP_PALETTE.unconnectedLandFill;

                const strokeColor = isSelected
                  ? MAP_PALETTE.countrySelectedStroke
                  : isHovered || isBinHighlighted
                    ? MAP_PALETTE.countryHoverStroke
                    : isSyria
                      ? MAP_PALETTE.syriaBorder
                      : bin
                        ? MAP_PALETTE.connectedLandStroke
                        : MAP_PALETTE.unconnectedLandStroke;

                const strokeW = isSelected
                  ? 2.0 * invScale
                  : isHovered || isBinHighlighted
                    ? 1.55 * invScale
                    : isSyria
                      ? (selectedOriginObj ? 1.85 : 1.4) * invScale
                      : bin
                        ? 0.92 * invScale
                        : 0.78 * invScale;

                const countryOpacity = isDimmedByBin
                  ? 0.28
                  : isHovered || isSelected
                    ? 1
                    : selectedOriginObj && !isSyria && !bin
                      ? 0.62
                      : 0.97;

                return (
                  <path
                    key={`${iso}-${idx}`}
                    d={pathGenerator(feat) || ''}
                    fill={fillColor}
                    fillOpacity={countryOpacity}
                    stroke={strokeColor}
                    strokeWidth={strokeW}
                    className={stat || isSyria ? 'cursor-pointer transition-opacity duration-150' : ''}
                    onMouseMove={(e) => {
                      setHoveredCountryIso(iso);
                      const rawName =
                        stat?.country_name || feat.properties?.name || `ISO ${iso}`;
                      const countryName = translateCountry(rawName);
                      if (stat || isSyria) {
                        showRelativeTooltip(e, {
                          title: countryName,
                          subtitle: isSyria
                            ? 'نطاق الأصل · الطيران المدني السوري'
                            : `${stat!.corridor_count} مسار · ${stat!.airports.join('، ')}`,
                          metrics: isSyria
                            ? [
                                {
                                  label: 'النطاق النشط',
                                  value:
                                    selectedAirport === 'all'
                                      ? 'كافة البوابات'
                                      : SYRIAN_CITY_SHORT_AR[selectedAirport] ?? selectedAirport,
                                },
                                {
                                  label: 'الدول المتصلة',
                                  value: String(activeConnectedCountries.length),
                                },
                                {
                                  label: 'الخطوط الداخلية',
                                  value: String(
                                    visibleCorridors.filter((c) => c.is_domestic).length
                                  ),
                                },
                              ]
                            : [
                                {
                                  label: 'الحجم المدمج',
                                  value: (stat!.total_events + stat!.fids_slots).toLocaleString('en-US'),
                                },
                                { label: 'أحداث السجل', value: stat!.total_events.toLocaleString('en-US') },
                                { label: 'العمليات المرصودة', value: stat!.observed_events.toLocaleString('en-US') },
                                { label: 'شاشات FIDS المؤرشفة', value: stat!.fids_slots.toLocaleString('en-US') },
                              ],
                        });
                      } else {
                        setTooltip(null);
                      }
                    }}
                    onMouseLeave={() => {
                      setHoveredCountryIso(null);
                      setTooltip(null);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (stat && !isSyria) {
                        onSelectCountry(selectedCountryIso === iso ? null : stat);
                      } else if (isSyria) {
                        onSelectCountry(null);
                        onSelectCorridor(null);
                      }
                    }}
                  />
                );
              })}
            </g>

            {/* Subtle Atlas Country Labels positioned away from IATA pins */}
            <g className="pointer-events-none">
              {Object.entries(ATLAS_COUNTRY_LABELS).map(([iso, meta]) => {
                const c = projection(meta.coords);
                if (!c || Number.isNaN(c[0]) || Number.isNaN(c[1])) return null;
                const stat = countryStatMap.get(iso);
                const hasTraffic = stat ? getCountryValue(stat) > 0 : false;
                return (
                  <text
                    key={`lbl-${iso}`}
                    x={c[0]}
                    y={c[1]}
                    textAnchor="middle"
                    style={{
                      fontSize: `${8.6 * invScale}px`,
                      paintOrder: 'stroke',
                      stroke: MAP_PALETTE.labelHalo,
                      strokeWidth: `${2.8 * invScale}px`,
                      strokeLinejoin: 'round',
                    }}
                    className={`font-sans font-semibold ${
                      hasTraffic ? 'fill-slate-100/85' : 'fill-slate-300/65'
                    }`}
                  >
                    {meta.text}
                  </text>
                );
              })}
            </g>

            {/* Airport Airspace Sector Shading (FIR/TMA geoCircles when clicking origin or destination) */}
            {airspaceSectors.length > 0 && (
              <g className="pointer-events-none">
                {airspaceSectors.map((sector) => {
                  const strokeCol =
                    sector.kind === 'origin'
                      ? sector.hasObserved
                        ? MAP_PALETTE.airspaceOriginStroke
                        : MAP_PALETTE.airspaceDestStroke
                      : '#34d399';
                  const fillUrl =
                    sector.kind === 'origin'
                      ? sector.hasObserved
                        ? 'url(#originAirspaceAmber)'
                        : 'url(#originAirspaceSky)'
                      : 'url(#destAirspaceSky)';

                  return (
                    <g key={sector.key}>
                      <path
                        d={sector.outerPath}
                        fill={fillUrl}
                        stroke={strokeCol}
                        strokeWidth={1.15 * invScale}
                        strokeOpacity={0.78}
                        strokeDasharray={`${4.4 * invScale} ${2.8 * invScale}`}
                      />
                      <path
                        d={sector.innerPath}
                        fill={strokeCol}
                        fillOpacity={0.14}
                        stroke={strokeCol}
                        strokeWidth={0.9 * invScale}
                        strokeOpacity={0.62}
                      />
                      {/* Subtle cardinal radar ticks inside airspace center */}
                      <line
                        x1={sector.center[0] - 15 * invScale}
                        y1={sector.center[1]}
                        x2={sector.center[0] + 15 * invScale}
                        y2={sector.center[1]}
                        stroke={strokeCol}
                        strokeOpacity={0.42}
                        strokeWidth={0.7 * invScale}
                      />
                      <line
                        x1={sector.center[0]}
                        y1={sector.center[1] - 15 * invScale}
                        x2={sector.center[0]}
                        y2={sector.center[1] + 15 * invScale}
                        stroke={strokeCol}
                        strokeOpacity={0.42}
                        strokeWidth={0.7 * invScale}
                      />
                      <text
                        x={sector.labelPos[0]}
                        y={sector.labelPos[1]}
                        textAnchor="middle"
                        style={{
                          fontSize: `${8.2 * invScale}px`,
                          paintOrder: 'stroke',
                          stroke: MAP_PALETTE.labelHalo,
                          strokeWidth: `${3.0 * invScale}px`,
                          strokeLinejoin: 'round',
                        }}
                        fill={strokeCol}
                        className="font-sans font-semibold"
                      >
                        {sector.labelText}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}

            {/* Curved Flight Corridors (Dark ink casing + high-contrast strokes + animated directional arrows) */}
            <g>
              {projectedCorridors.map(({ corr, val, path, reversePath, mid, angleDeg, distance, isMinor }, idx) => {
                const isSelected = selectedCorridorId === corr.id;
                const isHovered =
                  hoveredCorridorId === corr.id || hoveredDestIata === corr.destination_iata;
                const matchesSelectedCountry = selectedCountryIso === corr.country_iso_num;
                const isSearchHighlighted =
                  matchingCorridorIds !== null && matchingCorridorIds.has(corr.id);

                const hasActiveFocus = Boolean(
                  selectedCorridorId || selectedCountryIso || matchingCorridorIds
                );
                const isHighlighted =
                  isSelected || isHovered || matchesSelectedCountry || isSearchHighlighted;
                const isMuted = hasActiveFocus && !isHighlighted;

                const width = strokeWidthScale(val) * invScale;
                const hasObserved = corr.observed_events > 0;
                const strokeHex =
                  isSelected || isHovered
                    ? MAP_PALETTE.selectedLine
                    : metricMode === 'observed' || (hasObserved && metricMode === 'combined')
                      ? MAP_PALETTE.observedLine
                      : MAP_PALETTE.scheduledLine;

                const lineOpacity = isHighlighted
                  ? 1
                  : isMuted
                    ? 0.18
                    : isMinor
                      ? 0.78
                      : 0.96;

                const casingOpacity = isHighlighted ? 0.98 : isMuted ? 0.2 : 0.92;

                const showOutbound =
                  activeFilterDirection === 'departure' ||
                  (activeFilterDirection !== 'arrival' &&
                    (corr.departures > 0 || (corr.arrivals === 0 && corr.fids_slots > 0)));
                const showInbound =
                  activeFilterDirection === 'arrival' ||
                  (activeFilterDirection !== 'departure' &&
                    (corr.arrivals > 0 || (corr.departures === 0 && corr.fids_slots > 0)));

                const shouldAnimateArc =
                  animateFlowArrows &&
                  !isMuted &&
                  (isHighlighted || !isMinor || selectedAirport !== 'all');

                const durSec = Math.max(2.4, Math.min(5.2, distance / 68));
                const phaseOut = ((idx * 0.61) % durSec).toFixed(2);
                const phaseIn = (((idx * 0.61) + durSec * 0.5) % durSec).toFixed(2);
                const arrowScale = (isHighlighted ? 1.2 : 0.95) * invScale;

                return (
                  <g key={corr.id}>
                    {/* Generous invisible hit area */}
                    <path
                      d={path}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={11 * invScale}
                      className="cursor-pointer"
                      onMouseMove={(e) => {
                        setHoveredCorridorId(corr.id);
                        showRelativeTooltip(e, {
                          title: `${corr.origin_iata} ↔ ${corr.destination_iata}`,
                          subtitle: `${translateCity(corr.destination_city)}، ${translateCountry(corr.country_name)}`,
                          metrics: [
                            {
                              label: 'الحجم المدمج',
                              value: (corr.total_events + corr.fids_slots).toLocaleString('en-US'),
                            },
                            {
                              label: 'الاتجاه (وصول / مغادرة)',
                              value: `${corr.arrivals.toLocaleString('en-US')} ↙ / ${corr.departures.toLocaleString('en-US')} ↗`,
                            },
                            { label: 'العمليات المرصودة', value: corr.observed_events.toLocaleString('en-US') },
                            {
                              label: 'السجل المجدول',
                              value: corr.scheduled_events.toLocaleString('en-US'),
                            },
                            { label: 'شاشات FIDS المؤرشفة', value: corr.fids_slots.toLocaleString('en-US') },
                          ],
                        });
                      }}
                      onMouseLeave={() => {
                        setHoveredCorridorId(null);
                        setTooltip(null);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCorridor(isSelected ? null : corr);
                      }}
                    />

                    {/* Dark Casing Halo keeps crossing routes and lines over teal countries crisp */}
                    <path
                      d={path}
                      fill="none"
                      stroke={MAP_PALETTE.corridorCasing}
                      strokeWidth={
                        isHighlighted ? width + 3.6 * invScale : width + 2.5 * invScale
                      }
                      strokeOpacity={casingOpacity}
                      strokeLinecap="round"
                      className="pointer-events-none"
                    />

                    {/* Crisp Route Line */}
                    <path
                      d={path}
                      fill="none"
                      stroke={strokeHex}
                      strokeWidth={isHighlighted ? width + 1.2 * invScale : width}
                      strokeOpacity={lineOpacity}
                      strokeDasharray={
                        corr.is_domestic ? `${3.4 * invScale} ${2.8 * invScale}` : undefined
                      }
                      strokeLinecap="round"
                      className="pointer-events-none transition-opacity duration-150"
                    />

                    {/* Animated Directional Flight Arrows along curve */}
                    {shouldAnimateArc && showOutbound && (
                      <g className="pointer-events-none">
                        <polygon
                          points="4.8,0 -3.2,-2.8 -1.4,0 -3.2,2.8"
                          transform={`scale(${arrowScale})`}
                          fill={MAP_PALETTE.outboundArrow}
                          stroke={MAP_PALETTE.corridorCasing}
                          strokeWidth={1.15}
                          strokeLinejoin="round"
                        />
                        <animateMotion
                          path={path}
                          dur={`${durSec.toFixed(2)}s`}
                          begin={`-${phaseOut}s`}
                          repeatCount="indefinite"
                          rotate="auto"
                        />
                      </g>
                    )}

                    {shouldAnimateArc && showInbound && (
                      <g className="pointer-events-none">
                        <polygon
                          points="4.8,0 -3.2,-2.8 -1.4,0 -3.2,2.8"
                          transform={`scale(${arrowScale})`}
                          fill={MAP_PALETTE.inboundArrow}
                          stroke={MAP_PALETTE.corridorCasing}
                          strokeWidth={1.15}
                          strokeLinejoin="round"
                        />
                        <animateMotion
                          path={reversePath}
                          dur={`${durSec.toFixed(2)}s`}
                          begin={`-${phaseIn}s`}
                          repeatCount="indefinite"
                          rotate="auto"
                        />
                      </g>
                    )}

                    {/* Mid-Arc Static Directional Chevron (always shown on hover/selection, or when motion is paused) */}
                    {(isSelected || hoveredCorridorId === corr.id || (!animateFlowArrows && showFlowArrows && !isMuted && !isMinor)) && (
                      <g className="pointer-events-none">
                        <polygon
                          points={`${-3.8 * invScale},${-2.7 * invScale} ${4.4 * invScale},0 ${-3.8 * invScale},${2.7 * invScale}`}
                          fill={
                            activeFilterDirection === 'arrival'
                              ? MAP_PALETTE.inboundArrow
                              : isSelected || hoveredCorridorId === corr.id
                                ? MAP_PALETTE.selectedLine
                                : MAP_PALETTE.outboundArrow
                          }
                          stroke={MAP_PALETTE.corridorCasing}
                          strokeWidth={0.9 * invScale}
                          transform={`translate(${mid[0]}, ${mid[1]}) rotate(${
                            activeFilterDirection === 'arrival' ? angleDeg + 180 : angleDeg
                          })`}
                        />
                        {(isSelected || hoveredCorridorId === corr.id) && (
                          <text
                            x={mid[0]}
                            y={mid[1] - 7.5 * invScale}
                            textAnchor="middle"
                            style={{
                              direction: 'ltr',
                              unicodeBidi: 'isolate',
                              fontSize: `${8.6 * invScale}px`,
                              paintOrder: 'stroke',
                              stroke: MAP_PALETTE.labelHalo,
                              strokeWidth: `${3.4 * invScale}px`,
                              strokeLinejoin: 'round',
                            }}
                            className="font-mono font-bold fill-white"
                          >
                            {`${corr.origin_iata}↔${corr.destination_iata} (${val.toLocaleString('en-US')})`}
                          </text>
                        )}
                      </g>
                    )}
                  </g>
                );
              })}
            </g>

            {/* Destination Airport Pins (Aggregated totals & line-synced endpoints) */}
            <g>
              {destinationNodes.map((dest) => {
                const r =
                  Math.max(2.6, Math.min(5.2, strokeWidthScale(dest.metric) * 1.2)) * invScale;
                const hasFocus = Boolean(
                  selectedCorridorId || selectedCountryIso || matchingCorridorIds
                );
                const isActivePin =
                  dest.isSelected ||
                  dest.isSearchMatch ||
                  hoveredDestIata === dest.iata;
                const isMuted = hasFocus && !isActivePin;
                const hasObserved = dest.totalObserved > 0;

                return (
                  <g
                    key={dest.iata}
                    className="cursor-pointer"
                    opacity={isMuted ? 0.25 : 1}
                    onMouseMove={(e) => {
                      setHoveredDestIata(dest.iata);
                      showRelativeTooltip(e, {
                        title: `${dest.iata} · ${translateCity(dest.city)}`,
                        subtitle: `${translateCountry(dest.country)} · عبر ${dest.origins.join('، ')}`,
                        metrics: [
                          { label: 'الحجم المدمج', value: dest.metric.toLocaleString('en-US') },
                          {
                            label: 'العمليات المرصودة',
                            value: dest.totalObserved.toLocaleString('en-US'),
                          },
                          {
                            label: 'السجل المجدول',
                            value: dest.totalScheduled.toLocaleString('en-US'),
                          },
                          {
                            label: 'شاشات FIDS المؤرشفة',
                            value: dest.totalFids.toLocaleString('en-US'),
                          },
                        ],
                      });
                    }}
                    onMouseLeave={() => {
                      setHoveredDestIata(null);
                      setTooltip(null);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const alreadySelected = dest.corridors.some((c) => c.id === selectedCorridorId);
                      onSelectCorridor(alreadySelected ? null : dest.topCorridor);
                    }}
                  >
                    {dest.nudged && (
                      <line
                        x1={dest.trueX}
                        y1={dest.trueY}
                        x2={dest.cx}
                        y2={dest.cy}
                        stroke="rgba(255,255,255,0.65)"
                        strokeWidth={0.75 * invScale}
                      />
                    )}
                    <circle
                      cx={dest.cx}
                      cy={dest.cy}
                      r={r}
                      fill={
                        dest.isSelected || hoveredDestIata === dest.iata
                          ? MAP_PALETTE.selectedLine
                          : hasObserved
                            ? MAP_PALETTE.observedLine
                            : MAP_PALETTE.scheduledLine
                      }
                      stroke={MAP_PALETTE.pinStroke}
                      strokeWidth={1.35 * invScale}
                    />
                    {dest.allowLabel && (
                      <text
                        x={dest.cx + r + 3.5 * invScale}
                        y={dest.cy + 3 * invScale}
                        textAnchor="start"
                        style={{
                          direction: 'ltr',
                          unicodeBidi: 'isolate',
                          fontSize: `${8.8 * invScale}px`,
                          paintOrder: 'stroke',
                          stroke: MAP_PALETTE.labelHalo,
                          strokeWidth: `${3.4 * invScale}px`,
                          strokeLinejoin: 'round',
                        }}
                        className={`pointer-events-none font-mono font-bold ${
                          dest.isSelected ? 'fill-white' : 'fill-slate-100'
                        }`}
                      >
                        {dest.iata}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>

            {/* Syrian Origin Aerodrome Hubs */}
            <g>
              {syrianOrigins.map((orig) => {
                const coords = projection([orig.lon, orig.lat]);
                if (!coords) return null;
                const [cx, cy] = coords;
                const isSelectedOrigin = selectedAirport.toUpperCase() === orig.airport_id;
                const hasEvents = orig.total_events > 0;
                const offset = SYRIAN_LABEL_OFFSETS[orig.airport_id] ?? {
                  dx: -11,
                  dy: -9,
                  anchor: 'end' as const,
                };

                return (
                  <g
                    key={orig.airport_id}
                    className="cursor-pointer"
                    onMouseMove={(e) =>
                      showRelativeTooltip(e, {
                        title: `${orig.iata_code} · ${SYRIAN_AIRPORT_NAMES_AR[orig.airport_id] ?? orig.name}`,
                        subtitle: isSelectedOrigin
                          ? `${translateCity(orig.city)}، سوريا · المجال الجوي مظلل (انقر لإلغاء التحديد)`
                          : `${translateCity(orig.city)}، سوريا · انقر لتظليل المجال الجوي وتصفية المسارات`,
                        metrics: [
                          { label: 'أحداث السجل', value: orig.total_events.toLocaleString('en-US') },
                          { label: 'العمليات المرصودة', value: orig.observed_events.toLocaleString('en-US') },
                          { label: 'الوجهات', value: String(orig.destinations_count) },
                        ],
                      })
                    }
                    onMouseLeave={() => setTooltip(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectOrigin(isSelectedOrigin ? 'all' : orig.airport_id);
                    }}
                  >
                    {isSelectedOrigin && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={9.5 * invScale}
                        fill="none"
                        stroke="#ffffff"
                        strokeOpacity={0.9}
                        strokeWidth={1.3 * invScale}
                      />
                    )}
                    <line
                      x1={cx}
                      y1={cy}
                      x2={cx + offset.dx * 0.72 * invScale}
                      y2={cy + offset.dy * 0.72 * invScale}
                      stroke="rgba(255,255,255,0.65)"
                      strokeWidth={0.85 * invScale}
                    />
                    <rect
                      x={cx - 3.0 * invScale}
                      y={cy - 3.0 * invScale}
                      width={6.0 * invScale}
                      height={6.0 * invScale}
                      transform={`rotate(45 ${cx} ${cy})`}
                      fill={
                        isSelectedOrigin
                          ? MAP_PALETTE.selectedLine
                          : hasEvents
                            ? MAP_PALETTE.observedLine
                            : MAP_PALETTE.inactiveOriginFill
                      }
                      stroke={MAP_PALETTE.pinStroke}
                      strokeWidth={1.3 * invScale}
                    />
                    <text
                      x={cx + offset.dx * invScale}
                      y={cy + offset.dy * invScale}
                      textAnchor={offset.anchor}
                      style={{
                        direction: 'ltr',
                        unicodeBidi: 'isolate',
                        fontSize: `${9.0 * invScale}px`,
                        paintOrder: 'stroke',
                        stroke: MAP_PALETTE.labelHalo,
                        strokeWidth: `${3.5 * invScale}px`,
                        strokeLinejoin: 'round',
                      }}
                      className={`pointer-events-none font-mono font-bold ${
                        isSelectedOrigin ? 'fill-[#fde68a]' : 'fill-white'
                      }`}
                    >
                      {orig.iata_code}
                    </text>
                  </g>
                );
              })}
            </g>
          </g>

          {/* Subtle Chart Coordinate Edge Labels (RTL: Lat ticks along right edge) */}
          <g
            className="pointer-events-none font-mono text-[8.5px] fill-slate-300/85"
            style={{
              paintOrder: 'stroke',
              stroke: MAP_PALETTE.labelHalo,
              strokeWidth: '2.2px',
              strokeLinejoin: 'round',
            }}
          >
            {axisTicks.lonTicks.map((t) => (
              <text
                key={t.label}
                x={t.x}
                y={svgH - 6}
                textAnchor="middle"
                style={{ direction: 'ltr', unicodeBidi: 'isolate' }}
              >
                {t.label}
              </text>
            ))}
            {axisTicks.latTicks.map((t) => (
              <text
                key={t.label}
                x={svgW - 8}
                y={t.y}
                textAnchor="end"
                style={{ direction: 'ltr', unicodeBidi: 'isolate' }}
              >
                {t.label}
              </text>
            ))}
          </g>
        </svg>

        {!loading && visibleCorridors.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <div className="rounded-lg border border-white/15 bg-[#071219]/95 px-3.5 py-2 text-[11px] text-slate-200">
              لا توجد مسارات مسجلة{' '}
              {selectedAirport === 'all' ? (
                'ضمن النطاق المحدد'
              ) : (
                <>
                  للمطار <span className="font-mono">{selectedAirport}</span>
                </>
              )}{' '}
              ضمن وضع {metricMode === 'observed' ? 'المرصود' : metricMode === 'fids' ? 'شاشات FIDS' : 'المدمج'}.
            </div>
          </div>
        )}

        {tooltip && (
          <div
            dir="rtl"
            className="pointer-events-none absolute z-30 w-56 rounded-lg border border-white/25 bg-[#071219]/96 p-3 shadow-2xl"
            style={{
              left: tooltip.x,
              top: tooltip.y,
            }}
          >
            <div className="dir-ltr inline-block font-display text-xs font-semibold text-white">
              {tooltip.title}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-300">{tooltip.subtitle}</div>
            <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
              {tooltip.metrics.map((m) => (
                <div key={m.label} className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-300">{m.label}</span>
                  <span className="font-mono font-medium text-[#fde68a] tabular-nums">
                    {m.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Cartographic Legend & Quick State Filters */}
      <div
        className="divide-y divide-white/[0.06] border-t text-[11px]"
        style={{ backgroundColor: MAP_PALETTE.chromeBg, borderColor: MAP_PALETTE.chromeBorder }}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] tabular-nums">
            <span className="me-1 font-sans text-[10.5px] font-medium text-slate-300">الكثافة:</span>
            <span className="inline-flex items-center gap-1 pe-1 text-slate-300">
              <span
                className="inline-block h-2.5 w-3 border"
                style={{
                  backgroundColor: MAP_PALETTE.unconnectedLandFill,
                  borderColor: MAP_PALETTE.unconnectedLandStroke,
                }}
              />
              0
            </span>
            {choroplethBins.map((bin) => (
              <button
                key={bin.index}
                type="button"
                onMouseEnter={() => setHoveredBinIndex(bin.index)}
                onMouseLeave={() => setHoveredBinIndex(null)}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
                  hoveredBinIndex === bin.index
                    ? 'bg-white/15 text-white'
                    : 'text-slate-200 hover:bg-white/[0.06]'
                }`}
              >
                <span
                  className="inline-block h-2.5 w-3 border border-white/35"
                  style={{ backgroundColor: bin.color }}
                />
                <span className="dir-ltr">{bin.label}</span>
              </button>
            ))}
            <span className="inline-flex items-center gap-1 ps-1 font-sans text-slate-200">
              <span
                className="inline-block h-2.5 w-3 border border-[#fbbf24]/85"
                style={{
                  backgroundImage: `repeating-linear-gradient(45deg, ${MAP_PALETTE.syriaHatchBase}, ${MAP_PALETTE.syriaHatchBase} 2px, rgba(251,191,36,0.5) 2px, rgba(251,191,36,0.5) 3px)`,
                }}
              />
              الأصل: سوريا
            </span>
          </div>

          {/* Line, Flow Direction & Airspace Legend */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-slate-200">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-[2.5px] w-4 rounded-full"
                style={{ backgroundColor: MAP_PALETTE.observedLine }}
              />
              مرصود
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-[2.5px] w-4 rounded-full"
                style={{ backgroundColor: MAP_PALETTE.scheduledLine }}
              />
              مجدول / FIDS
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-0 w-4 border-t-2 border-dashed"
                style={{ borderColor: MAP_PALETTE.scheduledLine }}
              />
              داخلي
            </span>
            <span className="inline-flex items-center gap-1">
              <svg width="11" height="10" viewBox="-4 -4 10 8" aria-hidden="true">
                <polygon
                  points="4.8,0 -3.2,-2.8 -1.4,0 -3.2,2.8"
                  fill={MAP_PALETTE.outboundArrow}
                  stroke={MAP_PALETTE.corridorCasing}
                  strokeWidth="1"
                />
              </svg>
              مغادرة
            </span>
            <span className="inline-flex items-center gap-1">
              <svg width="11" height="10" viewBox="-4 -4 10 8" aria-hidden="true">
                <polygon
                  points="4.8,0 -3.2,-2.8 -1.4,0 -3.2,2.8"
                  fill={MAP_PALETTE.inboundArrow}
                  stroke={MAP_PALETTE.corridorCasing}
                  strokeWidth="1"
                />
              </svg>
              وصول
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-[#fbbf24] bg-[#fbbf24]/20" />
              مجال جوي
            </span>
          </div>
        </div>

        {/* Clickable Top Connected Countries */}
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-1.5 overflow-x-auto">
          <span className="text-[10.5px] font-medium text-slate-400">أبرز الدول المتصلة:</span>
          {topCountriesPreview.map((ct) => {
            const iso = String(ct.country_iso_num).padStart(3, '0');
            const val = getCountryValue(ct);
            const active = selectedCountryIso === iso;
            return (
              <button
                key={iso}
                type="button"
                onClick={() => onSelectCountry(active ? null : ct)}
                className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10.5px] transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#1b3a44] text-white border border-[#fbbf24]/60'
                    : 'text-slate-200 hover:bg-white/[0.08] hover:text-white'
                }`}
              >
                <span>{translateCountry(ct.country_name, true)}</span>
                <span className="font-mono text-[9.5px] text-slate-400 tabular-nums">
                  {val.toLocaleString('en-US')}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
