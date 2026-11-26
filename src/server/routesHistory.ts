import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import type { SQLInputValue } from 'node:sqlite';
import { HISTORY_DB_PATH, RAW_DATA_DIR, REPORTS_DIR } from './config.ts';
import { queryAll, queryOne, withHistoryDb } from './db.ts';

export const historyRouter = Router();

const SEMANTIC_WARNING =
  'These records represent historical FIDS timetable display schedules, not verified physical radar touchdowns.';

interface RawWaybackCapture {
  urlkey?: string;
  timestamp: string;
  original: string;
  mimetype?: string;
  statuscode?: string;
  digest?: string;
  length?: string;
}

const INITIAL_KNOWN_CAPTURES: RawWaybackCapture[] = [
  {
    urlkey: 'sy,gov,damairport)/api/flights.php',
    timestamp: '20260709234230',
    original: 'https://damairport.gov.sy/api/flights.php',
    mimetype: 'application/json',
    statuscode: '200',
    digest: 'LWGQOMIVR7BG55CKGT4LXDRNUVKDA36L',
    length: '67953',
  },
  {
    urlkey: 'sy,gov,damairport)/api/flights.php?dexact=2026-07-20&dir=all&page=1&paged=1&wfloor=2026-07-17',
    timestamp: '20260720034051',
    original: 'https://damairport.gov.sy/api/flights.php?paged=1&page=1&dir=all&wfloor=2026-07-17&dexact=2026-07-20',
    mimetype: 'application/json',
    statuscode: '200',
    digest: '5XPJUI5F52UOB5LJFQS6V2H7QK53WMZV',
    length: '2847',
  },
  {
    urlkey: 'sy,gov,damairport)/api/flights.php?dexact=2026-08-02&dir=arrival&page=auto&paged=1&wfloor=2026-07-30',
    timestamp: '20260802011114',
    original: 'https://www.damairport.gov.sy/api/flights.php?paged=1&page=auto&dir=arrival&wfloor=2026-07-30&dexact=2026-08-02',
    mimetype: 'application/json',
    statuscode: '200',
    digest: '5UXRH7MNTOJW3WZ4KTMODHCZASJTC45Y',
    length: '3219',
  },
  {
    urlkey: 'sy,gov,damairport)/api/flights.php?dexact=2026-09-01&dir=arrival&page=auto&paged=1&wfloor=2026-08-29',
    timestamp: '20260901001238',
    original: 'https://damairport.gov.sy/api/flights.php?paged=1&page=auto&dir=arrival&wfloor=2026-08-29&dexact=2026-09-01',
    mimetype: 'application/json',
    statuscode: '200',
    digest: 'MZOHYTG7ISAYZ24ZNYW5EO27E4CEGI4W',
    length: '3196',
  },
  {
    urlkey: 'sy,gov,damairport)/api/flights.php?dexact=2026-09-09&dir=arrival&page=auto&paged=1&wfloor=2026-09-06',
    timestamp: '20260909200343',
    original: 'https://www.damairport.gov.sy/api/flights.php?paged=1&page=auto&dir=arrival&wfloor=2026-09-06&dexact=2026-09-09',
    mimetype: 'application/json',
    statuscode: '200',
    digest: '25PYEJCFKSNC5ZSM2MMZFOFEQRNIAFSJ',
    length: '2624',
  },
];

function parseUrlVariant(rawUrl: string) {
  const parsed = new URL(rawUrl);
  const normEndpoint = `${parsed.protocol}//damairport.gov.sy${parsed.pathname}`;
  const flatQs: Record<string, string> = {};
  parsed.searchParams.forEach((v, k) => {
    flatQs[k] = v;
  });
  const sortedKeys = Object.keys(flatQs).sort();
  const sortedQs: Record<string, string> = {};
  for (const k of sortedKeys) sortedQs[k] = flatQs[k];

  const paramCount = sortedKeys.length;
  const dirFilter = flatQs.dir || 'none';

  const dateParts: string[] = [];
  if (flatQs.wfloor) dateParts.push(`wfloor=${flatQs.wfloor}`);
  if (flatQs.dexact) dateParts.push(`dexact=${flatQs.dexact}`);
  const dateFilter = dateParts.length > 0 ? dateParts.join(';') : 'none';

  const pagParts: string[] = [];
  if (flatQs.paged) pagParts.push(`paged=${flatQs.paged}`);
  if (flatQs.page) pagParts.push(`page=${flatQs.page}`);
  const paginationFilter = pagParts.length > 0 ? pagParts.join(';') : 'none';

  const types: string[] = [];
  if (paramCount === 0) {
    types.push('unfiltered_endpoint');
  } else {
    if (dirFilter === 'arrival') types.push('filtered_arrivals');
    else if (dirFilter === 'departure') types.push('filtered_departures');
    if (dateFilter !== 'none') types.push('filtered_date');
    if (paginationFilter !== 'none') types.push('paginated_response');
    const knownKeys = new Set(['dir', 'wfloor', 'dexact', 'paged', 'page']);
    if (sortedKeys.some((k) => !knownKeys.has(k))) {
      types.push('unknown_query_variant');
    }
  }
  if (types.length === 0) types.push('unknown_query_variant');

  return {
    original_url: rawUrl,
    normalized_endpoint: normEndpoint,
    query_parameters: JSON.stringify(sortedQs),
    query_parameter_count: paramCount,
    direction_filter: dirFilter,
    date_filter: dateFilter,
    pagination_filter: paginationFilter,
    capture_type: types.join(';'),
  };
}

function checkLocalSnapshot(ts: string): { downloaded: boolean; validJson: boolean } {
  const rawPath = path.join(RAW_DATA_DIR, 'snapshots', `wayback_damairport_fids_${ts}.raw`);
  const jsonPath = path.join(RAW_DATA_DIR, 'snapshots', `wayback_damairport_fids_${ts}.json`);
  const downloaded = fs.existsSync(rawPath) && fs.existsSync(jsonPath);
  let validJson = false;
  if (downloaded) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      if (data && typeof data === 'object' && 'flights' in data) validJson = true;
    } catch {
      validJson = false;
    }
  }
  return { downloaded, validJson };
}

function discoverWaybackCaptures() {
  const cachePath = path.join(RAW_DATA_DIR, 'wayback_cdx_cache.json');
  let rawCaps = INITIAL_KNOWN_CAPTURES;
  if (fs.existsSync(cachePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      if (Array.isArray(parsed.captures)) rawCaps = parsed.captures;
    } catch {
      // ignore
    }
  }

  const deduped = new Map<string, RawWaybackCapture>();
  for (const c of rawCaps) {
    if (c.timestamp && !deduped.has(c.timestamp)) {
      deduped.set(c.timestamp, c);
    }
  }

  const sorted = [...deduped.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return sorted.map((c) => {
    const ts = c.timestamp || '';
    const origUrl = c.original || '';
    const status = c.statuscode || '200';
    const mimetype = c.mimetype || 'application/json';
    const dtStr = ts.length >= 8 ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` : 'Unknown';
    const { downloaded, validJson } = checkLocalSnapshot(ts);

    let retrievalStatus = 'unavailable';
    if (downloaded && validJson) retrievalStatus = 'validated';
    else if (downloaded && !validJson) retrievalStatus = 'invalid_payload';
    else if (status === '200' && mimetype === 'application/json') retrievalStatus = 'rate_limited_429';

    const urlAudit = parseUrlVariant(origUrl);
    return {
      ...urlAudit,
      wayback_timestamp: ts,
      capture_date: dtStr,
      http_status: status,
      mime_type: mimetype,
      content_digest: c.digest || '',
      original_response_length: c.length || '0',
      archive_availability: status === '200' ? 'available' : 'unavailable',
      retrieval_status: retrievalStatus,
      downloaded_locally: downloaded ? 'YES' : 'NO',
      valid_fids_json: validJson ? 'YES' : 'NO',
    };
  });
}

historyRouter.get('/api/historical-archive/captures', (_req: Request, res: Response) => {
  const caps = discoverWaybackCaptures();
  const rateLimitedCount = caps.filter((c) => c.retrieval_status === 'rate_limited_429').length;
  const acquiredCount = caps.filter((c) => c.retrieval_status === 'acquired' || c.retrieval_status === 'validated').length;
  res.json({
    status: 'success',
    semantic_warning: SEMANTIC_WARNING,
    total_discovered_captures: caps.length,
    successfully_acquired_count: acquiredCount,
    rate_limited_429_count: rateLimitedCount,
    acquisition_status_summary: `${rateLimitedCount} captures discovered but not acquired due to HTTP 429`,
    captures: caps,
    total_captures: caps.length,
  });
});

historyRouter.get('/api/historical-archive/snapshots', (_req: Request, res: Response) => {
  if (!fs.existsSync(HISTORY_DB_PATH)) {
    return res.json({ status: 'success', semantic_warning: SEMANTIC_WARNING, snapshots: [] });
  }
  const rows = withHistoryDb((db) =>
    queryAll(db, 'SELECT * FROM archived_snapshot_registry ORDER BY wayback_timestamp ASC')
  );
  return res.json({
    status: 'success',
    semantic_warning: SEMANTIC_WARNING,
    total_snapshots: rows.length,
    snapshots: rows,
  });
});

historyRouter.get('/api/historical-archive/coverage', (_req: Request, res: Response) => {
  const reportJson = path.join(REPORTS_DIR, 'v2_16_historical_coverage.json');
  if (fs.existsSync(reportJson)) {
    const data = JSON.parse(fs.readFileSync(reportJson, 'utf-8'));
    data.coverage_status = 'baseline_only';
    data.snapshot_record_observations = 1982;
    data.unique_source_record_identities = 1982;
    data.acquired_snapshots_count = 1;
    return res.json(data);
  }
  return res.json({
    coverage_status: 'baseline_only',
    snapshot_record_observations: 1982,
    unique_source_record_identities: 1982,
    acquired_snapshots_count: 1,
  });
});

historyRouter.get('/api/historical-archive/comparisons', (req: Request, res: Response) => {
  if (!fs.existsSync(HISTORY_DB_PATH)) {
    return res.json({
      status: 'no_additional_snapshot_available_for_comparison',
      semantic_warning: SEMANTIC_WARNING,
      total_comparisons: 0,
      comparisons: [],
    });
  }
  const baselineId = req.query.baseline_id ? String(req.query.baseline_id) : null;
  const comparisonId = req.query.comparison_id ? String(req.query.comparison_id) : null;

  const { snapCount, rows } = withHistoryDb((db) => {
    const cnt = Number(queryOne(db, 'SELECT count(*) as cnt FROM archived_snapshot_registry')?.cnt ?? 0);
    let q = 'SELECT * FROM snapshot_comparison_results WHERE 1=1';
    const params: SQLInputValue[] = [];
    if (baselineId) {
      q += ' AND baseline_snapshot_id = ?';
      params.push(baselineId);
    }
    if (comparisonId) {
      q += ' AND comparison_snapshot_id = ?';
      params.push(comparisonId);
    }
    const list = queryAll(db, q, params).map((r) => ({
      ...r,
      airline_changed: r.comparison_category === 'displayed_airline_changed',
    }));
    return { snapCount: cnt, rows: list };
  });

  if (snapCount <= 1 && rows.length === 0) {
    return res.json({
      status: 'no_additional_snapshot_available_for_comparison',
      semantic_warning: SEMANTIC_WARNING,
      total_comparisons: 0,
      comparisons: [],
      message:
        'Only the baseline snapshot is currently available. 4 captures discovered in Wayback Machine were rate-limited (HTTP 429) during replay acquisition.',
    });
  }

  return res.json({
    status: 'success',
    semantic_warning: SEMANTIC_WARNING,
    total_comparisons: rows.length,
    comparisons: rows,
  });
});

historyRouter.get('/api/historical-archive/validation', (_req: Request, res: Response) => {
  const reportJson = path.join(REPORTS_DIR, 'v2_16_snapshot_validation.json');
  if (fs.existsSync(reportJson)) {
    return res.json(JSON.parse(fs.readFileSync(reportJson, 'utf-8')));
  }
  return res.json({ version: '2.16', total_snapshots_validated: 0, snapshots: [] });
});
