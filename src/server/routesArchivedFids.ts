import { Router, type Request, type Response } from 'express';
import type { SQLInputValue } from 'node:sqlite';
import { queryAll, queryOne, withAnalyticsDb, type DbRow } from './db.ts';

export const archivedFidsRouter = Router();

const SEMANTIC_WARNING =
  'These records represent archived scheduled/displayed flight information, not verified physical aircraft movements.';

const SNAPSHOT_PROVENANCE = {
  snapshot_id: 'snap_wayback_20260709234230',
  memento_timestamp: '2026-07-09T23:42:30Z',
  source_url: 'https://damairport.gov.sy/api/flights.php',
  date_coverage: '2026-07-05 to 2026-09-09',
  wall_clock_timezone: 'Asia/Damascus (UTC+3)',
};

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

interface FilterParams {
  startDate?: string;
  endDate?: string;
  direction?: string;
  airline?: string;
}

function validateFilters(filters: FilterParams): { whereSql: string; params: SQLInputValue[] } {
  const clauses = ['1=1'];
  const params: SQLInputValue[] = [];
  const { startDate, endDate, direction, airline } = filters;

  if (startDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      throw new Error(`Invalid start_date format '${startDate}'. Expected YYYY-MM-DD.`);
    }
    clauses.push('scheduled_date >= ?');
    params.push(startDate);
  }
  if (endDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new Error(`Invalid end_date format '${endDate}'. Expected YYYY-MM-DD.`);
    }
    clauses.push('scheduled_date <= ?');
    params.push(endDate);
  }
  if (startDate && endDate && startDate > endDate) {
    throw new Error(`start_date '${startDate}' cannot be greater than end_date '${endDate}'.`);
  }
  if (direction && direction.toLowerCase() !== 'all') {
    const dirClean = direction.toLowerCase().trim();
    if (dirClean !== 'arrival' && dirClean !== 'departure') {
      throw new Error(`Invalid direction '${direction}'. Allowed values: arrival, departure, all.`);
    }
    clauses.push('movement_type = ?');
    params.push(dirClean);
  }
  if (airline && airline.trim()) {
    const al = airline.trim();
    clauses.push('(airline_name_en = ? OR airline_name_ar = ? OR airline_iata = ?)');
    params.push(al, al, al.toUpperCase());
  }

  return { whereSql: clauses.join(' AND '), params };
}

function extractFilters(req: Request): FilterParams {
  return {
    startDate: req.query.start_date ? String(req.query.start_date) : undefined,
    endDate: req.query.end_date ? String(req.query.end_date) : undefined,
    direction: req.query.direction ? String(req.query.direction) : undefined,
    airline: req.query.airline ? String(req.query.airline) : undefined,
  };
}

function getSummaryData(filters: FilterParams) {
  const { whereSql, params } = validateFilters(filters);
  const row = withAnalyticsDb((db) =>
    queryOne(
      db,
      `SELECT
        COUNT(*) as total_records,
        SUM(CASE WHEN movement_type = 'arrival' THEN 1 ELSE 0 END) as arrivals_count,
        SUM(CASE WHEN movement_type = 'departure' THEN 1 ELSE 0 END) as departures_count,
        COUNT(DISTINCT scheduled_date) as calendar_days_count,
        COUNT(DISTINCT airline_name_en) as unique_airline_brands,
        COUNT(DISTINCT flight_number) as unique_flight_numbers,
        SUM(CASE WHEN displayed_status = 'scheduled' THEN 1 ELSE 0 END) as scheduled_status_count,
        SUM(CASE WHEN displayed_status = 'arrived' THEN 1 ELSE 0 END) as arrived_status_count,
        MIN(scheduled_date) as min_date,
        MAX(scheduled_date) as max_date,
        SUM(is_duplicate_candidate) as duplicate_candidates_count
       FROM fids_analytics_records
       WHERE ${whereSql}`,
      params
    )
  );

  return {
    status: 'success',
    semantic_warning: SEMANTIC_WARNING,
    provenance: SNAPSHOT_PROVENANCE,
    filters_applied: {
      start_date: filters.startDate ?? null,
      end_date: filters.endDate ?? null,
      direction: filters.direction ?? null,
      airline: filters.airline ?? null,
    },
    summary: {
      total_archived_fids_records: Number(row?.total_records ?? 0),
      scheduled_arrivals: Number(row?.arrivals_count ?? 0),
      scheduled_departures: Number(row?.departures_count ?? 0),
      calendar_days_covered: Number(row?.calendar_days_count ?? 0),
      date_range: {
        earliest_scheduled_date: (row?.min_date as string) || '2026-07-05',
        latest_scheduled_date: (row?.max_date as string) || '2026-09-09',
      },
      displayed_airline_brands_count: Number(row?.unique_airline_brands ?? 0),
      unique_scheduled_flight_numbers: Number(row?.unique_flight_numbers ?? 0),
      status_distribution: {
        scheduled: Number(row?.scheduled_status_count ?? 0),
        arrived: Number(row?.arrived_status_count ?? 0),
      },
      duplicate_candidates_count: Number(row?.duplicate_candidates_count ?? 0),
      physical_movement_evidence_count: 0,
    },
  };
}

function getDailyData(filters: FilterParams) {
  const { whereSql, params } = validateFilters(filters);
  const rows = withAnalyticsDb((db) =>
    queryAll(
      db,
      `SELECT
        scheduled_date as flight_date,
        COUNT(*) as total_scheduled_records,
        SUM(CASE WHEN movement_type = 'arrival' THEN 1 ELSE 0 END) as arrival_records,
        SUM(CASE WHEN movement_type = 'departure' THEN 1 ELSE 0 END) as departure_records,
        COUNT(DISTINCT flight_number) as unique_displayed_flight_numbers,
        COUNT(DISTINCT airline_name_en) as unique_displayed_airline_brands,
        SUM(CASE WHEN displayed_status = 'scheduled' THEN 1 ELSE 0 END) as scheduled_status_count,
        SUM(CASE WHEN displayed_status != 'scheduled' THEN 1 ELSE 0 END) as other_display_status_count,
        SUM(is_duplicate_candidate) as duplicate_candidates_count
       FROM fids_analytics_records
       WHERE ${whereSql}
       GROUP BY scheduled_date
       ORDER BY scheduled_date ASC`,
      params
    )
  );
  return {
    status: 'success',
    semantic_warning: SEMANTIC_WARNING,
    provenance: SNAPSHOT_PROVENANCE,
    total_days: rows.length,
    daily_records: rows,
  };
}

function getAirlinesData(filters: FilterParams) {
  const { whereSql, params } = validateFilters({ ...filters, airline: undefined });
  const { totalRecords, rawAirlines } = withAnalyticsDb((db) => {
    const cntRow = queryOne(db, `SELECT COUNT(*) as cnt FROM fids_analytics_records WHERE ${whereSql}`, params);
    const total = Number(cntRow?.cnt ?? 0) || 1;
    const rows = queryAll(
      db,
      `SELECT
        airline_name_ar as displayed_airline_brand_ar,
        airline_name_en as displayed_airline_brand_en,
        airline_iata as source_iata_code,
        airline_role as carrier_role_classification,
        COUNT(*) as total_displayed_records,
        SUM(CASE WHEN movement_type = 'arrival' THEN 1 ELSE 0 END) as arrival_records,
        SUM(CASE WHEN movement_type = 'departure' THEN 1 ELSE 0 END) as departure_records,
        COUNT(DISTINCT flight_number) as distinct_flight_numbers,
        COUNT(DISTINCT scheduled_date) as active_days_count,
        MIN(scheduled_date) as first_active_date,
        MAX(scheduled_date) as last_active_date
       FROM fids_analytics_records
       WHERE ${whereSql}
       GROUP BY airline_name_ar, airline_name_en, airline_iata, airline_role
       ORDER BY total_displayed_records DESC`,
      params
    );
    return { totalRecords: total, rawAirlines: rows };
  });

  const airlines = rawAirlines.map((r) => {
    const cnt = Number(r.total_displayed_records ?? 0);
    const pct = Math.round((cnt / totalRecords) * 10000) / 100;
    const activeDays = Number(r.active_days_count ?? 0) || 1;
    return {
      ...r,
      percentage_of_total: `${pct.toFixed(2)}%`,
      percentage_value: pct,
      daily_frequency_active_days: Math.round((cnt / activeDays) * 100) / 100,
      daily_frequency_67_days: Math.round((cnt / 67.0) * 100) / 100,
      is_operating_carrier_verified: false,
    };
  });

  return {
    status: 'success',
    metric_label: 'Displayed Airline Distribution',
    semantic_warning: SEMANTIC_WARNING,
    provenance: SNAPSHOT_PROVENANCE,
    total_displayed_records: totalRecords,
    airline_brands_count: airlines.length,
    airlines,
  };
}

function getRoutesData(filters: FilterParams, topLimit = 20) {
  const { whereSql, params } = validateFilters(filters);
  return withAnalyticsDb((db) => {
    const topOrigins = queryAll(
      db,
      `SELECT origin_iata as airport_code, movement_type,
              COUNT(*) as scheduled_flight_count,
              COUNT(DISTINCT flight_number) as distinct_flight_numbers,
              COUNT(DISTINCT airline_name_en) as distinct_airlines
       FROM fids_analytics_records
       WHERE ${whereSql}
       GROUP BY origin_iata, movement_type
       ORDER BY scheduled_flight_count DESC
       LIMIT ?`,
      [...params, topLimit]
    );
    const topDestinations = queryAll(
      db,
      `SELECT destination_iata as airport_code, movement_type,
              COUNT(*) as scheduled_flight_count,
              COUNT(DISTINCT flight_number) as distinct_flight_numbers,
              COUNT(DISTINCT airline_name_en) as distinct_airlines
       FROM fids_analytics_records
       WHERE ${whereSql}
       GROUP BY destination_iata, movement_type
       ORDER BY scheduled_flight_count DESC
       LIMIT ?`,
      [...params, topLimit]
    );
    const topRoutes = queryAll(
      db,
      `SELECT origin_iata || '-' || destination_iata as route_pair,
              origin_iata, destination_iata, movement_type,
              COUNT(*) as scheduled_records_count,
              COUNT(DISTINCT flight_number) as unique_displayed_flight_numbers,
              COUNT(DISTINCT airline_name_en) as distinct_airlines_count,
              GROUP_CONCAT(DISTINCT airline_name_en) as airlines_list
       FROM fids_analytics_records
       WHERE ${whereSql}
       GROUP BY origin_iata, destination_iata, movement_type
       ORDER BY scheduled_records_count DESC
       LIMIT ?`,
      [...params, topLimit]
    );
    return {
      status: 'success',
      semantic_warning: SEMANTIC_WARNING,
      provenance: SNAPSHOT_PROVENANCE,
      top_origins: topOrigins,
      top_destinations: topDestinations,
      top_routes: topRoutes,
    };
  });
}

function getHourlyData(filters: FilterParams) {
  const { whereSql, params } = validateFilters(filters);
  const rows = withAnalyticsDb((db) =>
    queryAll(
      db,
      `SELECT SUBSTR(scheduled_time, 1, 2) as scheduled_hour_local,
              movement_type,
              COUNT(*) as records_count
       FROM fids_analytics_records
       WHERE ${whereSql} AND scheduled_time != ''
       GROUP BY scheduled_hour_local, movement_type
       ORDER BY scheduled_hour_local ASC`,
      params
    )
  );

  const hourlyMap: Record<
    string,
    { hour_local: string; hour_label: string; arrivals: number; departures: number; total: number }
  > = {};
  for (let h = 0; h < 24; h++) {
    const key = String(h).padStart(2, '0');
    hourlyMap[key] = {
      hour_local: key,
      hour_label: `${key}:00–${key}:59`,
      arrivals: 0,
      departures: 0,
      total: 0,
    };
  }
  for (const r of rows) {
    const hr = String(r.scheduled_hour_local ?? '');
    const mtype = String(r.movement_type ?? '');
    const cnt = Number(r.records_count ?? 0);
    if (hourlyMap[hr]) {
      if (mtype === 'arrival') hourlyMap[hr].arrivals += cnt;
      else if (mtype === 'departure') hourlyMap[hr].departures += cnt;
      hourlyMap[hr].total += cnt;
    }
  }

  return {
    status: 'success',
    timezone: 'Asia/Damascus (UTC+3)',
    timezone_note: 'Grouped strictly by local Damascus wall-clock time; not converted to UTC before grouping.',
    semantic_warning: SEMANTIC_WARNING,
    provenance: SNAPSHOT_PROVENANCE,
    hourly_distribution: Array.from({ length: 24 }, (_, h) => hourlyMap[String(h).padStart(2, '0')]),
  };
}

function getWeeklyData(filters: FilterParams) {
  const { whereSql, params } = validateFilters(filters);
  const dailyRows = withAnalyticsDb((db) =>
    queryAll(
      db,
      `SELECT scheduled_date as flight_date,
              COUNT(*) as total_flights,
              SUM(CASE WHEN movement_type = 'arrival' THEN 1 ELSE 0 END) as arrival_count,
              SUM(CASE WHEN movement_type = 'departure' THEN 1 ELSE 0 END) as departure_count
       FROM fids_analytics_records
       WHERE ${whereSql}
       GROUP BY scheduled_date
       ORDER BY scheduled_date ASC`,
      params
    )
  );

  const totalDays = dailyRows.length || 1;
  const totalFlights = dailyRows.reduce((s, r) => s + Number(r.total_flights ?? 0), 0);
  const totalArr = dailyRows.reduce((s, r) => s + Number(r.arrival_count ?? 0), 0);
  const totalDep = dailyRows.reduce((s, r) => s + Number(r.departure_count ?? 0), 0);

  const weekdayStats = WEEKDAY_NAMES.map((name, idx) => ({
    weekday_index: idx,
    weekday_name: name,
    day_occurrences: 0,
    total_flights: 0,
    arrival_flights: 0,
    departure_flights: 0,
    average_flights_per_weekday: 0,
  }));

  for (const d of dailyRows) {
    const dt = new Date(`${d.flight_date}T00:00:00Z`);
    const wIdx = (dt.getUTCDay() + 6) % 7; // Python weekday(): Mon=0..Sun=6
    weekdayStats[wIdx].day_occurrences += 1;
    weekdayStats[wIdx].total_flights += Number(d.total_flights ?? 0);
    weekdayStats[wIdx].arrival_flights += Number(d.arrival_count ?? 0);
    weekdayStats[wIdx].departure_flights += Number(d.departure_count ?? 0);
  }

  for (const w of weekdayStats) {
    const occ = w.day_occurrences || 1;
    w.average_flights_per_weekday = Math.round((w.total_flights / occ) * 100) / 100;
  }

  const sortedByVol = [...dailyRows].sort((a, b) => Number(b.total_flights ?? 0) - Number(a.total_flights ?? 0));
  const busiestDays = sortedByVol.slice(0, 5);
  const quietestDays = sortedByVol.slice(-5).reverse();
  const busiestWeekdays = [...weekdayStats].sort(
    (a, b) => b.average_flights_per_weekday - a.average_flights_per_weekday
  );

  return {
    status: 'success',
    semantic_warning: SEMANTIC_WARNING,
    provenance: SNAPSHOT_PROVENANCE,
    period_statistics: {
      total_calendar_days: totalDays,
      total_scheduled_records: totalFlights,
      average_records_per_calendar_day: Math.round((totalFlights / totalDays) * 100) / 100,
      average_arrivals_per_calendar_day: Math.round((totalArr / totalDays) * 100) / 100,
      average_departures_per_calendar_day: Math.round((totalDep / totalDays) * 100) / 100,
    },
    weekday_distribution: weekdayStats,
    busiest_calendar_days: busiestDays,
    quietest_calendar_days: quietestDays,
    busiest_weekdays: busiestWeekdays,
  };
}

function getDuplicatesData() {
  const rows = withAnalyticsDb((db) => queryAll(db, 'SELECT * FROM fids_duplicate_candidates'));
  return {
    status: 'success',
    semantic_warning: SEMANTIC_WARNING,
    provenance: SNAPSHOT_PROVENANCE,
    duplicate_candidate_pairs_count: rows.length,
    candidates: rows,
    policy_note: 'Both source records are preserved unaltered in the database. Neither record is deleted, merged, or suppressed.',
  };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

archivedFidsRouter.get('/api/archived-fids/summary', (req: Request, res: Response) => {
  try {
    return res.json(getSummaryData(extractFilters(req)));
  } catch (err) {
    return res.status(400).json({ detail: err instanceof Error ? err.message : String(err) });
  }
});

archivedFidsRouter.get('/api/archived-fids/daily', (req: Request, res: Response) => {
  try {
    return res.json(getDailyData(extractFilters(req)));
  } catch (err) {
    return res.status(400).json({ detail: err instanceof Error ? err.message : String(err) });
  }
});

archivedFidsRouter.get('/api/archived-fids/airlines', (req: Request, res: Response) => {
  try {
    return res.json(getAirlinesData(extractFilters(req)));
  } catch (err) {
    return res.status(400).json({ detail: err instanceof Error ? err.message : String(err) });
  }
});

archivedFidsRouter.get('/api/archived-fids/routes', (req: Request, res: Response) => {
  try {
    const topLimit = Math.max(1, Math.min(200, Number(req.query.top_limit) || 20));
    return res.json(getRoutesData(extractFilters(req), topLimit));
  } catch (err) {
    return res.status(400).json({ detail: err instanceof Error ? err.message : String(err) });
  }
});

archivedFidsRouter.get('/api/archived-fids/hourly', (req: Request, res: Response) => {
  try {
    return res.json(getHourlyData(extractFilters(req)));
  } catch (err) {
    return res.status(400).json({ detail: err instanceof Error ? err.message : String(err) });
  }
});

archivedFidsRouter.get('/api/archived-fids/weekly', (req: Request, res: Response) => {
  try {
    return res.json(getWeeklyData(extractFilters(req)));
  } catch (err) {
    return res.status(400).json({ detail: err instanceof Error ? err.message : String(err) });
  }
});

archivedFidsRouter.get('/api/archived-fids/duplicate-candidates', (_req: Request, res: Response) => {
  return res.json(getDuplicatesData());
});

archivedFidsRouter.get('/api/archived-fids/coverage', (_req: Request, res: Response) => {
  const sumRes = getSummaryData({});
  return res.json({
    status: 'success',
    semantic_warning: SEMANTIC_WARNING,
    provenance: SNAPSHOT_PROVENANCE,
    date_coverage: {
      start_date: '2026-07-05',
      end_date: '2026-09-09',
      consecutive_calendar_days: 67,
    },
    records_total: sumRes.summary.total_archived_fids_records,
    arrivals: sumRes.summary.scheduled_arrivals,
    departures: sumRes.summary.scheduled_departures,
    displayed_airline_brands: sumRes.summary.displayed_airline_brands_count,
    status_distribution: sumRes.summary.status_distribution,
    physical_movement_evidence_count: 0,
  });
});

archivedFidsRouter.get('/api/archived-fids/export/csv', (req: Request, res: Response) => {
  try {
    const filters = extractFilters(req);
    const datasetClean = String(req.query.dataset || 'daily').toLowerCase().trim();
    let csv = '';

    if (datasetClean === 'daily') {
      const r = getDailyData(filters);
      csv = rowsToCsv(
        [
          'flight_date',
          'total_scheduled_records',
          'arrival_records',
          'departure_records',
          'unique_displayed_flight_numbers',
          'unique_displayed_airline_brands',
          'scheduled_status_count',
          'other_display_status_count',
          'duplicate_candidates_count',
        ],
        r.daily_records.map((x) => [
          x.flight_date,
          x.total_scheduled_records,
          x.arrival_records,
          x.departure_records,
          x.unique_displayed_flight_numbers,
          x.unique_displayed_airline_brands,
          x.scheduled_status_count,
          x.other_display_status_count,
          x.duplicate_candidates_count,
        ])
      );
    } else if (datasetClean === 'airlines' || datasetClean === 'airline') {
      const r = getAirlinesData(filters);
      csv = rowsToCsv(
        [
          'displayed_airline_brand_ar',
          'displayed_airline_brand_en',
          'source_iata_code',
          'carrier_role_classification',
          'total_displayed_records',
          'percentage_of_total',
          'arrival_records',
          'departure_records',
          'distinct_flight_numbers',
          'active_days_count',
          'daily_frequency_active_days',
          'daily_frequency_67_days',
          'is_operating_carrier_verified',
        ],
        r.airlines.map((x: DbRow) => [
          x.displayed_airline_brand_ar,
          x.displayed_airline_brand_en,
          x.source_iata_code,
          x.carrier_role_classification,
          x.total_displayed_records,
          x.percentage_of_total,
          x.arrival_records,
          x.departure_records,
          x.distinct_flight_numbers,
          x.active_days_count,
          x.daily_frequency_active_days,
          x.daily_frequency_67_days,
          'FALSE',
        ])
      );
    } else if (datasetClean === 'routes' || datasetClean === 'route') {
      const r = getRoutesData(filters, 100);
      csv = rowsToCsv(
        [
          'route_pair',
          'origin_iata',
          'destination_iata',
          'movement_type',
          'scheduled_records_count',
          'unique_displayed_flight_numbers',
          'distinct_airlines_count',
          'airlines_list',
        ],
        r.top_routes.map((x) => [
          x.route_pair,
          x.origin_iata,
          x.destination_iata,
          x.movement_type,
          x.scheduled_records_count,
          x.unique_displayed_flight_numbers,
          x.distinct_airlines_count,
          x.airlines_list,
        ])
      );
    } else if (datasetClean === 'hourly' || datasetClean === 'hours') {
      const r = getHourlyData(filters);
      csv = rowsToCsv(
        ['hour_local', 'hour_label', 'arrivals_count', 'departures_count', 'total_records_count', 'wall_clock_timezone'],
        r.hourly_distribution.map((x) => [
          x.hour_local,
          x.hour_label,
          x.arrivals,
          x.departures,
          x.total,
          'Asia/Damascus (UTC+3)',
        ])
      );
    } else if (datasetClean === 'weekly' || datasetClean === 'weekdays') {
      const r = getWeeklyData(filters);
      csv = rowsToCsv(
        [
          'weekday_index',
          'weekday_name',
          'day_occurrences',
          'total_flights',
          'arrival_flights',
          'departure_flights',
          'average_flights_per_weekday',
        ],
        r.weekday_distribution.map((x) => [
          x.weekday_index,
          x.weekday_name,
          x.day_occurrences,
          x.total_flights,
          x.arrival_flights,
          x.departure_flights,
          x.average_flights_per_weekday,
        ])
      );
    } else if (datasetClean === 'duplicates' || datasetClean === 'duplicate_candidates') {
      const r = getDuplicatesData();
      csv = rowsToCsv(
        [
          'candidate_id',
          'group_type',
          'source_uuid_1',
          'flight_number_1',
          'airline_1',
          'source_uuid_2',
          'flight_number_2',
          'airline_2',
          'scheduled_date',
          'scheduled_time',
          'movement_type',
          'origin_iata',
          'destination_iata',
          'duplicate_classification',
          'review_status',
          'audit_finding',
        ],
        r.candidates.map((x) => [
          x.candidate_id,
          x.group_type,
          x.source_uuid_1,
          x.flight_number_1,
          x.airline_1,
          x.source_uuid_2,
          x.flight_number_2,
          x.airline_2,
          x.scheduled_date,
          x.scheduled_time,
          x.movement_type,
          x.origin_iata,
          x.destination_iata,
          x.duplicate_classification,
          x.review_status,
          x.audit_finding,
        ])
      );
    } else if (datasetClean === 'records' || datasetClean === 'raw' || datasetClean === 'all') {
      const { whereSql, params } = validateFilters(filters);
      const rows = withAnalyticsDb((db) =>
        queryAll(
          db,
          `SELECT record_id, source_uuid, flight_number, airline_name_ar, airline_name_en,
                  airline_iata, airline_role, movement_type, origin_iata, destination_iata,
                  scheduled_date, scheduled_time, scheduled_datetime_local, scheduled_datetime_utc,
                  scheduled_status, displayed_status, actual_movement_evidence, classification
           FROM fids_analytics_records
           WHERE ${whereSql}
           ORDER BY scheduled_date, scheduled_time, flight_number`,
          params
        )
      );
      if (rows.length > 0) {
        const keys = Object.keys(rows[0]);
        csv = rowsToCsv(
          keys,
          rows.map((r) => keys.map((k) => r[k]))
        );
      }
    } else {
      return res.status(404).json({
        detail: `Unknown dataset '${datasetClean}'. Valid options: daily, airlines, routes, hourly, weekly, duplicates, records.`,
      });
    }

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename=archived_fids_${datasetClean}.csv`,
    });
    return res.send(csv);
  } catch (err) {
    return res.status(400).json({ detail: err instanceof Error ? err.message : String(err) });
  }
});

archivedFidsRouter.get('/api/archived-fids/export/json', (req: Request, res: Response) => {
  try {
    const filters = extractFilters(req);
    const datasetClean = String(req.query.dataset || 'summary').toLowerCase().trim();
    if (datasetClean === 'summary') return res.json(getSummaryData(filters));
    if (datasetClean === 'daily') return res.json(getDailyData(filters));
    if (datasetClean === 'airlines' || datasetClean === 'airline') return res.json(getAirlinesData(filters));
    if (datasetClean === 'routes' || datasetClean === 'route') return res.json(getRoutesData(filters));
    if (datasetClean === 'hourly' || datasetClean === 'hours') return res.json(getHourlyData(filters));
    if (datasetClean === 'weekly' || datasetClean === 'weekdays') return res.json(getWeeklyData(filters));
    if (datasetClean === 'duplicates' || datasetClean === 'duplicate_candidates') return res.json(getDuplicatesData());
    if (datasetClean === 'records' || datasetClean === 'all') {
      const { whereSql, params } = validateFilters(filters);
      const records = withAnalyticsDb((db) =>
        queryAll(
          db,
          `SELECT * FROM fids_analytics_records WHERE ${whereSql} ORDER BY scheduled_date, scheduled_time, flight_number`,
          params
        )
      );
      return res.json({
        status: 'success',
        semantic_warning: SEMANTIC_WARNING,
        provenance: SNAPSHOT_PROVENANCE,
        total_records: records.length,
        records,
      });
    }
    return res.status(404).json({
      detail: `Unknown dataset '${datasetClean}'. Valid options: summary, daily, airlines, routes, hourly, weekly, duplicates, records.`,
    });
  } catch (err) {
    return res.status(400).json({ detail: err instanceof Error ? err.message : String(err) });
  }
});
