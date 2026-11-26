import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import type { SQLInputValue } from 'node:sqlite';
import { parse } from 'csv-parse/sync';
import {
  EXPORT_METADATA,
  PROCESSED_DATA_DIR,
  REPORTS_DIR,
  SYRIAN_AIRPORTS_REGISTRY,
  VALID_EXPORT_DATASETS,
} from './config.ts';
import { queryAll, queryOne, withAnalyticsDb, withMainDb, type DbRow } from './db.ts';
import {
  MISLABELED_EVIDENCE_MAP,
  correctEvidenceItem,
  enrichFlightRecords,
} from './provenance.ts';

export const coreRouter = Router();

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

coreRouter.get('/api/airports', (_req: Request, res: Response) => {
  const rows = withMainDb((db) => {
    const list = queryAll(db, 'SELECT * FROM airports ORDER BY airport_type, name;');
    for (const r of list) {
      if (typeof r.runways_json === 'string' && r.runways_json) {
        try {
          r.runways = JSON.parse(r.runways_json);
        } catch {
          r.runways = [];
        }
      }
    }
    return list;
  });
  res.json(rows);
});

coreRouter.get('/api/airport', (req: Request, res: Response) => {
  const airportId = String(req.query.airport_id || 'DAM').toUpperCase();
  const row = withMainDb((db) =>
    queryOne(
      db,
      'SELECT * FROM airports WHERE airport_id = ? OR iata_code = ? OR icao_code = ?;',
      [airportId, airportId, airportId]
    )
  );
  if (row) {
    row.ident = row.icao_code || 'OSDI';
    if (typeof row.runways_json === 'string' && row.runways_json) {
      try {
        row.runways = JSON.parse(row.runways_json);
      } catch {
        row.runways = [];
      }
    }
    return res.json(row);
  }
  const reg = SYRIAN_AIRPORTS_REGISTRY[airportId];
  if (reg) {
    return res.json({ ...reg, ident: reg.icao_code || 'OSDI' });
  }
  return res.status(404).json({ detail: `Airport '${airportId}' not found in registry.` });
});

coreRouter.get('/api/flights', (req: Request, res: Response) => {
  const airportId = req.query.airport_id ? String(req.query.airport_id) : null;
  const date = req.query.date ? String(req.query.date) : null;
  const startDate = req.query.start_date ? String(req.query.start_date) : null;
  const endDate = req.query.end_date ? String(req.query.end_date) : null;
  const movementType = req.query.movement_type ? String(req.query.movement_type) : null;
  const status = req.query.status ? String(req.query.status) : null;
  const airline = req.query.airline ? String(req.query.airline) : null;
  const destination = req.query.destination ? String(req.query.destination) : null;
  const routeType = req.query.route_type ? String(req.query.route_type) : null;
  const recordNature = req.query.record_nature ? String(req.query.record_nature) : null;
  const evidenceLevel = req.query.evidence_level ? String(req.query.evidence_level) : null;
  const limit = clampInt(req.query.limit, 50, 1, 500);
  const offset = clampInt(req.query.offset, 0, 0, 1_000_000);

  let where = 'WHERE 1=1';
  const params: SQLInputValue[] = [];

  if (airportId) {
    where += ' AND airport_id = ?';
    params.push(airportId.toUpperCase());
  }
  if (destination) {
    const destCodes = destination
      .split(',')
      .map((d) => d.trim().toUpperCase())
      .filter(Boolean);
    if (destCodes.length === 1) {
      where += ' AND connected_airport_iata = ?';
      params.push(destCodes[0]);
    } else if (destCodes.length > 1) {
      where += ` AND connected_airport_iata IN (${destCodes.map(() => '?').join(',')})`;
      params.push(...destCodes);
    }
  }
  if (date) {
    where += ' AND flight_date = ?';
    params.push(date);
  }
  if (startDate) {
    where += ' AND flight_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    where += ' AND flight_date <= ?';
    params.push(endDate);
  }
  if (movementType) {
    where += ' AND movement_type = ?';
    params.push(movementType.toLowerCase());
  }
  if (status) {
    where += ' AND flight_status = ?';
    params.push(status.toLowerCase());
  }
  if (recordNature) {
    let rn = recordNature.toLowerCase();
    if (rn === 'commercially_reported_operational_event' || rn === 'commercially_reported') {
      rn = 'physical_movement';
    }
    where += ' AND record_nature = ?';
    params.push(rn);
  }
  if (evidenceLevel) {
    const el = evidenceLevel.toLowerCase();
    if (el === 'commercial_status_corroborated') where += " AND record_nature = 'physical_movement'";
    else if (el === 'scheduled_timetable_display') where += " AND record_nature = 'scheduled_service'";
    else if (el === 'commercial_partner_listing') where += " AND record_nature = 'marketing_codeshare'";
    else if (el === 'unverified_claim') where += " AND record_nature = 'unverified_movement'";
  }
  if (airline) {
    where += ' AND (airline_name LIKE ? OR airline_iata = ? OR airline_icao = ? OR flight_number LIKE ? OR connected_city LIKE ? OR connected_airport_iata = ?)';
    params.push(`%${airline}%`, airline.toUpperCase(), airline.toUpperCase(), `%${airline}%`, `%${airline}%`, airline.toUpperCase());
  }
  if (routeType) {
    where += ' AND route_type = ?';
    params.push(routeType.toLowerCase());
  }

  const result = withMainDb((db) => {
    const countRow = queryOne(db, `SELECT COUNT(*) as cnt FROM flight_events ${where}`, params);
    const totalCount = Number(countRow?.cnt ?? 0);
    const rows = queryAll(
      db,
      `SELECT * FROM flight_events ${where} ORDER BY flight_date DESC, (scheduled_dep_time || scheduled_arr_time) ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    for (const r of rows) delete r.raw_json;
    enrichFlightRecords(rows, db);
    return { totalCount, rows };
  });

  res.json({
    airport_filter: airportId || 'all_syrian_airports',
    total: result.totalCount,
    total_matching: result.totalCount,
    limit,
    offset,
    flights: result.rows,
    data: result.rows,
  });
});

coreRouter.get('/api/events/:event_id', (req: Request, res: Response) => {
  const eventId = String(req.params.event_id || '');
  const item = withMainDb((db) => {
    const row = queryOne(db, 'SELECT * FROM flight_events WHERE event_id = ?', [eventId]);
    if (!row) return null;
    delete row.raw_json;
    enrichFlightRecords([row], db);
    return row;
  });
  if (!item) {
    return res.status(404).json({ detail: `Flight event '${eventId}' not found` });
  }
  return res.json(item);
});

coreRouter.get('/api/events/:event_id/evidence', (req: Request, res: Response) => {
  const eventId = String(req.params.event_id || '');
  const includeRetracted = String(req.query.include_retracted || '').toLowerCase() === 'true';
  const forensic = String(req.query.forensic || '').toLowerCase() === 'true';

  const rawRows = withMainDb((db) => {
    const hasViewRow = queryOne(
      db,
      "SELECT count(*) as cnt FROM sqlite_master WHERE type = 'view' AND name = 'v_active_evidence';"
    );
    const hasView = Number(hasViewRow?.cnt ?? 0) > 0;
    if (hasView) {
      if (includeRetracted) {
        return queryAll(
          db,
          `SELECT ee.*,
                  CASE WHEN ae.evidence_id IS NOT NULL THEN 'active' ELSE 'retracted' END as ledger_status,
                  er.reason as retraction_reason,
                  er.observed_at as retracted_at,
                  er.actor as retracted_by
           FROM event_evidence ee
           LEFT JOIN v_active_evidence ae ON ee.evidence_id = ae.evidence_id
           LEFT JOIN (
             SELECT evidence_id, reason, observed_at, actor
             FROM (
               SELECT evidence_id, reason, observed_at, actor, action,
                      ROW_NUMBER() OVER (PARTITION BY evidence_id ORDER BY sequence_num DESC) as rn
               FROM evidence_retractions
             ) WHERE rn = 1 AND action = 'retract'
           ) er ON ee.evidence_id = er.evidence_id
           WHERE ee.event_id = ?
           ORDER BY ee.observed_at ASC;`,
          [eventId]
        );
      }
      return queryAll(
        db,
        `SELECT *, 'active' as ledger_status FROM v_active_evidence WHERE event_id = ? ORDER BY observed_at ASC;`,
        [eventId]
      );
    }
    return queryAll(db, "SELECT *, 'active' as ledger_status FROM event_evidence WHERE event_id = ?;", [eventId]);
  });

  const rows = rawRows.map((r) => correctEvidenceItem(r));
  const activeCount = rows.filter((r) => r.ledger_status === 'active').length;
  const retractedCount = rows.filter((r) => r.ledger_status === 'retracted').length;
  const correctedCount = rows.filter((r) => Boolean(r.is_estimated)).length;

  res.json({
    event_id: eventId,
    evidence_count: rows.length,
    active_count: activeCount,
    retracted_count: retractedCount,
    corrected_count: correctedCount,
    has_mislabeled_evidence: correctedCount > 0,
    forensic_mode: forensic,
    include_retracted: includeRetracted,
    evidence: rows,
    data: rows,
  });
});

function handleEvidenceAudit(_req: Request, res: Response) {
  const records = Object.values(MISLABELED_EVIDENCE_MAP);
  const takeoffCnt = records.filter((r) => r.original_evidence_type === 'adsb_takeoff').length;
  const touchdownCnt = records.filter((r) => r.original_evidence_type === 'adsb_touchdown').length;
  const totalEvidenceRecords = withMainDb((db) => {
    const row = queryOne(db, 'SELECT COUNT(*) as cnt FROM event_evidence');
    return Number(row?.cnt ?? 0);
  });
  const totalOriginalRecords = Math.max(0, totalEvidenceRecords - records.length);
  const reclassifiedPct =
    totalEvidenceRecords > 0
      ? Math.round((records.length / totalEvidenceRecords) * 10000) / 100
      : 0;
  const originalPct =
    totalEvidenceRecords > 0
      ? Math.round((totalOriginalRecords / totalEvidenceRecords) * 10000) / 100
      : 0;

  res.json({
    audit_version: 'V2.20.6',
    total_evidence_records: totalEvidenceRecords,
    total_original_records: totalOriginalRecords,
    total_mislabeled_evidence_records: records.length,
    reclassified_percentage: reclassifiedPct,
    original_percentage: originalPct,
    original_takeoffs_reclassified: takeoffCnt,
    original_touchdowns_reclassified: touchdownCnt,
    immutable_ledger_policy:
      'Original event_evidence rows remain strictly unmodified under cryptographic baseline invariants. Semantic corrections are applied at read time with visible audit trails.',
    records,
  });
}

coreRouter.get('/api/evidence/audit', handleEvidenceAudit);
coreRouter.get('/api/evidence/corrections', handleEvidenceAudit);

coreRouter.get('/api/movements/daily', (req: Request, res: Response) => {
  const airportId = req.query.airport_id ? String(req.query.airport_id) : 'DAM';
  const startDate = req.query.start_date ? String(req.query.start_date) : null;
  const endDate = req.query.end_date ? String(req.query.end_date) : null;

  let query = 'SELECT * FROM daily_airport_movements WHERE 1=1';
  const params: SQLInputValue[] = [];
  if (airportId && airportId.toLowerCase() !== 'all') {
    query += ' AND airport_id = ?';
    params.push(airportId.toUpperCase());
  }
  if (startDate) {
    query += ' AND flight_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND flight_date <= ?';
    params.push(endDate);
  }
  query += ' ORDER BY flight_date ASC, airport_id ASC';

  const rows = withMainDb((db) => queryAll(db, query, params));
  res.json({
    airport_id: airportId || 'all',
    total_days: rows.length,
    count: rows.length,
    daily_movements: rows,
    data: rows,
  });
});

function handleHistorical2024(req: Request, res: Response) {
  const startDate = req.query.start_date ? String(req.query.start_date) : null;
  const endDate = req.query.end_date ? String(req.query.end_date) : null;
  const movementType = req.query.movement_type ? String(req.query.movement_type) : null;
  const limit = req.query.limit !== undefined ? clampInt(req.query.limit, 1000, 1, 10000) : null;
  const offset = req.query.offset !== undefined ? clampInt(req.query.offset, 0, 0, 100000) : null;

  let query = 'SELECT * FROM historical_daily_movements_2024 WHERE 1=1';
  const params: SQLInputValue[] = [];
  if (startDate) {
    query += ' AND flight_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND flight_date <= ?';
    params.push(endDate);
  }
  if (movementType) {
    query += ' AND movement_type = ?';
    params.push(movementType.toLowerCase());
  }
  query += ' ORDER BY flight_date ASC, movement_type ASC';
  if (limit !== null) {
    query += ' LIMIT ?';
    params.push(limit);
    if (offset !== null) {
      query += ' OFFSET ?';
      params.push(offset);
    }
  }

  const rows = withMainDb((db) => queryAll(db, query, params));
  res.json({
    dataset_name: 'Syria Economic Monitor 2024 Gateway Operations Time Series',
    scope: 'DAM_ALP_LTK',
    included_airports: ['DAM', 'ALP', 'LTK'],
    data_category: 'regional_aggregate',
    is_dam_specific: false,
    movement_nature: 'aggregate_gateway_operations_by_status',
    source: 'Syria Economic Monitor (World Bank / Data Partnership)',
    earliest_observed_date: '2024-01-01',
    latest_observed_date: '2024-10-15',
    total: rows.length,
    count: rows.length,
    warning:
      'The 2024 DAM_ALP_LTK series is a three-airport aggregate covering Damascus (DAM), Aleppo (ALP), and Latakia (LTK) combined. Zero DAM-specific disaggregation is available in source data. Cannot be used as DAM-specific movement counts.',
    records: rows,
    data: rows,
  });
}

coreRouter.get('/api/movements/multi-airport', handleHistorical2024);
coreRouter.get('/api/movements/historical-2024', handleHistorical2024);

function queryByRecordNature(req: Request, recordNature: string) {
  const airportId = req.query.airport_id ? String(req.query.airport_id) : null;
  const date = req.query.date ? String(req.query.date) : null;
  const startDate = req.query.start_date ? String(req.query.start_date) : null;
  const endDate = req.query.end_date ? String(req.query.end_date) : null;
  const movementType = req.query.movement_type ? String(req.query.movement_type) : null;
  const limit = clampInt(req.query.limit, 50, 1, 500);
  const offset = clampInt(req.query.offset, 0, 0, 1_000_000);

  let where = 'WHERE record_nature = ?';
  const params: SQLInputValue[] = [recordNature];
  if (airportId) {
    where += ' AND airport_id = ?';
    params.push(airportId.toUpperCase());
  }
  if (date) {
    where += ' AND flight_date = ?';
    params.push(date);
  }
  if (startDate) {
    where += ' AND flight_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    where += ' AND flight_date <= ?';
    params.push(endDate);
  }
  if (movementType) {
    where += ' AND movement_type = ?';
    params.push(movementType.toLowerCase());
  }

  const orderExpr =
    recordNature === 'scheduled_service'
      ? '(scheduled_dep_time || scheduled_arr_time)'
      : '(actual_dep_time || actual_arr_time || scheduled_dep_time || scheduled_arr_time)';

  return withMainDb((db) => {
    const countRow = queryOne(db, `SELECT COUNT(*) as cnt FROM flight_events ${where}`, params);
    const totalCount = Number(countRow?.cnt ?? 0);
    const rows = queryAll(
      db,
      `SELECT * FROM flight_events ${where} ORDER BY flight_date DESC, ${orderExpr} ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    for (const r of rows) {
      delete r.raw_json;
      if (recordNature === 'unverified_movement') {
        r.verification_limitation = 'Lacks independent ADS-B ground radar telemetry confirmation.';
      }
    }
    enrichFlightRecords(rows, db);
    return { airportId, limit, offset, totalCount, rows };
  });
}

function handleVerifiedMovements(req: Request, res: Response) {
  const { airportId, limit, offset, totalCount, rows } = queryByRecordNature(req, 'physical_movement');
  res.json({
    record_nature: 'physical_movement',
    event_classification: 'commercially_reported_operational_event',
    description:
      'Commercially reported operational events with actual departure/arrival status timestamps (excluding marketing codeshares and unverified schedule-only records). Direct on-ground runway sensor telemetry is pending.',
    airport_filter: airportId || 'all_syrian_airports',
    total: totalCount,
    count: rows.length,
    limit,
    offset,
    movements: rows,
    data: rows,
  });
}

coreRouter.get('/api/movements/verified', handleVerifiedMovements);
coreRouter.get('/api/movements/operational', handleVerifiedMovements);
coreRouter.get('/api/movements/commercially-reported', handleVerifiedMovements);

coreRouter.get('/api/movements/scheduled', (req: Request, res: Response) => {
  const { airportId, limit, offset, totalCount, rows } = queryByRecordNature(req, 'scheduled_service');
  res.json({
    record_nature: 'scheduled_service',
    description: 'Published commercial timetable slots and airport authority flight board listings.',
    airport_filter: airportId || 'all_syrian_airports',
    total: totalCount,
    count: rows.length,
    limit,
    offset,
    movements: rows,
    data: rows,
  });
});

coreRouter.get('/api/movements/unverified', (req: Request, res: Response) => {
  const { airportId, limit, offset, totalCount, rows } = queryByRecordNature(req, 'unverified_movement');
  res.json({
    record_nature: 'unverified_movement',
    description: 'Historical flight operations recorded on commercial boards but lacking independent radar telemetry.',
    airport_filter: airportId || 'all_syrian_airports',
    total: totalCount,
    count: rows.length,
    limit,
    offset,
    movements: rows,
    data: rows,
  });
});

coreRouter.get('/api/movements/comparison', (req: Request, res: Response) => {
  const airportId = req.query.airport_id ? String(req.query.airport_id) : 'DAM';
  const startDate = req.query.start_date ? String(req.query.start_date) : null;
  const endDate = req.query.end_date ? String(req.query.end_date) : null;

  let query = `
    SELECT flight_date, airport_id,
           SUM(CASE WHEN record_nature = 'physical_movement' THEN 1 ELSE 0 END) as commercial_operational_event_count,
           SUM(CASE WHEN record_nature = 'scheduled_service' THEN 1 ELSE 0 END) as scheduled_record_count,
           SUM(CASE WHEN record_nature = 'marketing_codeshare' THEN 1 ELSE 0 END) as codeshare_record_count,
           SUM(CASE WHEN record_nature = 'unverified_movement' THEN 1 ELSE 0 END) as unverified_count,
           COUNT(DISTINCT CASE WHEN record_nature = 'physical_movement' THEN COALESCE(NULLIF(operating_flight_number, ''), flight_number) END) as unique_operating_flight_count,
           COUNT(DISTINCT CASE WHEN record_nature = 'physical_movement' THEN
                airport_id || '_' || flight_date || '_' || movement_type || '_' || COALESCE(NULLIF(operating_flight_number, ''), flight_number)
           END) as resolved_commercial_movement_count,
           COUNT(*) as unique_event_count
    FROM flight_events
    WHERE 1=1
  `;
  const params: SQLInputValue[] = [];
  if (airportId && airportId.toLowerCase() !== 'all') {
    query += ' AND airport_id = ?';
    params.push(airportId.toUpperCase());
  }
  if (startDate) {
    query += ' AND flight_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND flight_date <= ?';
    params.push(endDate);
  }
  query += ' GROUP BY flight_date, airport_id ORDER BY flight_date ASC';

  let codeshareQuery = `
    SELECT c.flight_date, c.airport_id,
           SUM(CASE WHEN p.flight_number IS NOT NULL THEN 1 ELSE 0 END) as matched,
           COUNT(DISTINCT CASE WHEN p.flight_number IS NULL THEN
                c.airport_id || '_' || c.flight_date || '_' || c.movement_type || '_' || COALESCE(NULLIF(c.operating_flight_number, ''), c.flight_number)
           END) as ambiguous_candidates,
           SUM(CASE WHEN p.flight_number IS NULL THEN 1 ELSE 0 END) as unmatched_rows
    FROM flight_events c
    LEFT JOIN (
        SELECT DISTINCT flight_date, airport_id, movement_type, flight_number
        FROM flight_events
        WHERE record_nature = 'physical_movement'
    ) p
       ON c.flight_date = p.flight_date
      AND c.airport_id = p.airport_id
      AND c.movement_type = p.movement_type
      AND c.operating_flight_number = p.flight_number
    WHERE c.record_nature = 'marketing_codeshare'
  `;
  const csParams: SQLInputValue[] = [];
  if (airportId && airportId.toLowerCase() !== 'all') {
    codeshareQuery += ' AND c.airport_id = ?';
    csParams.push(airportId.toUpperCase());
  }
  if (startDate) {
    codeshareQuery += ' AND c.flight_date >= ?';
    csParams.push(startDate);
  }
  if (endDate) {
    codeshareQuery += ' AND c.flight_date <= ?';
    csParams.push(endDate);
  }
  codeshareQuery += ' GROUP BY c.flight_date, c.airport_id';

  const comparison = withMainDb((db) => {
    const rawRows = queryAll(db, query, params);
    const csRows = queryAll(db, codeshareQuery, csParams);
    const csMap = new Map<string, { matched: number; ambiguous: number; unmatched: number }>();
    for (const r of csRows) {
      csMap.set(`${r.flight_date}__${r.airport_id}`, {
        matched: Number(r.matched ?? 0),
        ambiguous: Number(r.ambiguous_candidates ?? 0),
        unmatched: Number(r.unmatched_rows ?? 0),
      });
    }

    return rawRows.map((r) => {
      const cs = csMap.get(`${r.flight_date}__${r.airport_id}`) || { matched: 0, ambiguous: 0, unmatched: 0 };
      return {
        flight_date: r.flight_date,
        airport_id: r.airport_id,
        total_records: r.unique_event_count,
        source_record_count: r.unique_event_count,
        scheduled_record_count: r.scheduled_record_count,
        scheduled_service_count: r.scheduled_record_count,
        commercial_operational_event_count: r.commercial_operational_event_count,
        codeshare_record_count: r.codeshare_record_count,
        matched_codeshare_record_count: cs.matched,
        unmatched_codeshare_record_count: cs.unmatched,
        unverified_record_count: r.unverified_count,
        unique_operating_flight_count: r.unique_operating_flight_count,
        resolved_commercial_movement_count: r.resolved_commercial_movement_count,
        confirmed_unique_movement_count: r.resolved_commercial_movement_count,
        ambiguous_movement_identity_count: cs.ambiguous,
        unique_flight_movement_count: r.resolved_commercial_movement_count,
        unique_event_count: r.unique_event_count,
        codeshare_matched_to_operating_flight: cs.matched,
        codeshare_ambiguous_or_unmatched: cs.ambiguous,
        scheduled_count: r.scheduled_record_count,
        commercially_reported_count: r.commercial_operational_event_count,
        codeshare_count: r.codeshare_record_count,
        unverified_count: r.unverified_count,
        total_events: r.unique_event_count,
      };
    });
  });

  res.json({
    airport_id: airportId || 'all',
    total_days: comparison.length,
    comparison,
    warning:
      'Commercially reported events represent airline operational status updates, not physical runway radar sensor contacts. Marketing codeshares represent partner listings for existing operating aircraft and are not added to operational flight totals.',
  });
});

coreRouter.get('/api/movements/stats', (_req: Request, res: Response) => {
  const stats = withMainDb((db) => {
    const aptStats = queryAll(
      db,
      `SELECT airport_id, COUNT(*) as cnt,
              MIN(flight_date) as min_date, MAX(flight_date) as max_date,
              COUNT(DISTINCT flight_date) as dates_count
       FROM flight_events
       GROUP BY airport_id`
    );
    const statusRows = queryAll(db, 'SELECT flight_status, COUNT(*) as cnt FROM flight_events GROUP BY flight_status');
    const statusStats: Record<string, number> = {};
    for (const r of statusRows) {
      statusStats[String(r.flight_status ?? '')] = Number(r.cnt ?? 0);
    }
    const uniqueAircraft = Number(
      queryOne(db, "SELECT COUNT(DISTINCT NULLIF(aircraft_registration, '')) as cnt FROM flight_events;")?.cnt ?? 0
    );
    const uniqueAirlines = Number(
      queryOne(db, "SELECT COUNT(DISTINCT NULLIF(airline_name, '')) as cnt FROM flight_events;")?.cnt ?? 0
    );
    const damCount = Number(
      queryOne(db, "SELECT COUNT(*) as cnt FROM flight_events WHERE airport_id = 'DAM';")?.cnt ?? 0
    );
    const hist2024Rows = Number(
      queryOne(db, 'SELECT COUNT(*) as cnt FROM historical_daily_movements_2024;')?.cnt ?? 0
    );
    const topConn = queryAll(
      db,
      `SELECT connected_airport_iata, COUNT(*) as cnt
       FROM flight_events
       WHERE connected_airport_iata IS NOT NULL AND connected_airport_iata != ''
       GROUP BY connected_airport_iata
       ORDER BY cnt DESC LIMIT 5;`
    );
    return { aptStats, statusStats, uniqueAircraft, uniqueAirlines, damCount, hist2024Rows, topConn };
  });

  res.json({
    engine_version: '2.0-all-syrian-airports',
    iata: 'DAM',
    airport_events_breakdown: stats.aptStats,
    total_verified_flights: stats.damCount,
    flight_statuses: stats.statusStats,
    total_unique_aircraft: stats.uniqueAircraft,
    unique_aircraft_tracked: stats.uniqueAircraft,
    distinct_reported_aircraft_registrations: stats.uniqueAircraft,
    deprecated_metrics: {
      total_unique_aircraft:
        "Deprecated: equates commercial tail codes with verified airframes. Use 'distinct_reported_aircraft_registrations' instead.",
      unique_aircraft_tracked:
        "Deprecated: implies continuous radar sensor tracking. Use 'distinct_reported_aircraft_registrations' instead.",
    },
    total_unique_airlines: stats.uniqueAirlines,
    top_connected_airports: stats.topConn,
    historical_2024_rows: stats.hist2024Rows,
    historical_2024_scope: 'DAM_ALP_LTK',
  });
});

interface AirportGeoSpec {
  iata: string;
  city: string;
  lat: number;
  lon: number;
  country_name: string;
  country_iso_num: string;
}

const AIRPORT_GEO_LOOKUP: Record<string, AirportGeoSpec> = {
  DAM: { iata: 'DAM', city: 'Damascus', lat: 33.4115, lon: 36.5156, country_name: 'Syria', country_iso_num: '760' },
  ALP: { iata: 'ALP', city: 'Aleppo', lat: 36.1806, lon: 37.2242, country_name: 'Syria', country_iso_num: '760' },
  LTK: { iata: 'LTK', city: 'Latakia', lat: 35.4008, lon: 35.9486, country_name: 'Syria', country_iso_num: '760' },
  DEZ: { iata: 'DEZ', city: 'Deir ez-Zor', lat: 35.2858, lon: 40.1756, country_name: 'Syria', country_iso_num: '760' },
  KAC: { iata: 'KAC', city: 'Qamishli', lat: 37.0228, lon: 41.1969, country_name: 'Syria', country_iso_num: '760' },
  PMS: { iata: 'PMS', city: 'Palmyra', lat: 34.5572, lon: 38.3172, country_name: 'Syria', country_iso_num: '760' },
  OMDM: { iata: 'OMDM', city: 'Damascus Mezzeh', lat: 33.4775, lon: 36.2233, country_name: 'Syria', country_iso_num: '760' },
  DXB: { iata: 'DXB', city: 'Dubai', lat: 25.2532, lon: 55.3657, country_name: 'United Arab Emirates', country_iso_num: '784' },
  SHJ: { iata: 'SHJ', city: 'Sharjah', lat: 25.3286, lon: 55.5172, country_name: 'United Arab Emirates', country_iso_num: '784' },
  AUH: { iata: 'AUH', city: 'Abu Dhabi', lat: 24.433, lon: 54.6511, country_name: 'United Arab Emirates', country_iso_num: '784' },
  JED: { iata: 'JED', city: 'Jeddah', lat: 21.6796, lon: 39.1565, country_name: 'Saudi Arabia', country_iso_num: '682' },
  RUH: { iata: 'RUH', city: 'Riyadh', lat: 24.9576, lon: 46.6988, country_name: 'Saudi Arabia', country_iso_num: '682' },
  DMM: { iata: 'DMM', city: 'Dammam', lat: 26.4712, lon: 49.7979, country_name: 'Saudi Arabia', country_iso_num: '682' },
  MED: { iata: 'MED', city: 'Medina', lat: 24.5534, lon: 39.7051, country_name: 'Saudi Arabia', country_iso_num: '682' },
  IST: { iata: 'IST', city: 'Istanbul', lat: 41.2753, lon: 28.7519, country_name: 'Turkey', country_iso_num: '792' },
  SAW: { iata: 'SAW', city: 'Istanbul Sabiha Gökçen', lat: 40.8986, lon: 29.3092, country_name: 'Turkey', country_iso_num: '792' },
  ESB: { iata: 'ESB', city: 'Ankara', lat: 40.1281, lon: 32.9951, country_name: 'Turkey', country_iso_num: '792' },
  ADB: { iata: 'ADB', city: 'İzmir', lat: 38.2924, lon: 27.157, country_name: 'Turkey', country_iso_num: '792' },
  AYT: { iata: 'AYT', city: 'Antalya', lat: 36.8987, lon: 30.8005, country_name: 'Turkey', country_iso_num: '792' },
  AMM: { iata: 'AMM', city: 'Amman', lat: 31.7226, lon: 35.9932, country_name: 'Jordan', country_iso_num: '400' },
  DOH: { iata: 'DOH', city: 'Doha', lat: 25.2731, lon: 51.6081, country_name: 'Qatar', country_iso_num: '634' },
  KWI: { iata: 'KWI', city: 'Kuwait City', lat: 29.2266, lon: 47.9689, country_name: 'Kuwait', country_iso_num: '414' },
  MCT: { iata: 'MCT', city: 'Muscat', lat: 23.5933, lon: 58.2844, country_name: 'Oman', country_iso_num: '512' },
  BGW: { iata: 'BGW', city: 'Baghdad', lat: 33.2625, lon: 44.2346, country_name: 'Iraq', country_iso_num: '368' },
  EBL: { iata: 'EBL', city: 'Erbil', lat: 36.2376, lon: 43.9632, country_name: 'Iraq', country_iso_num: '368' },
  BER: { iata: 'BER', city: 'Berlin', lat: 52.3667, lon: 13.5033, country_name: 'Germany', country_iso_num: '276' },
  DUS: { iata: 'DUS', city: 'Düsseldorf', lat: 51.2895, lon: 6.7668, country_name: 'Germany', country_iso_num: '276' },
  CGN: { iata: 'CGN', city: 'Cologne', lat: 50.8659, lon: 7.1427, country_name: 'Germany', country_iso_num: '276' },
  AMS: { iata: 'AMS', city: 'Amsterdam', lat: 52.3105, lon: 4.7683, country_name: 'Netherlands', country_iso_num: '528' },
  BUH: { iata: 'BUH', city: 'Bucharest', lat: 44.5032, lon: 26.1021, country_name: 'Romania', country_iso_num: '642' },
  OTP: { iata: 'OTP', city: 'Bucharest Henri Coandă', lat: 44.5711, lon: 26.085, country_name: 'Romania', country_iso_num: '642' },
  SVO: { iata: 'SVO', city: 'Moscow', lat: 55.9726, lon: 37.4146, country_name: 'Russia', country_iso_num: '643' },
  VIE: { iata: 'VIE', city: 'Vienna', lat: 48.1103, lon: 16.5697, country_name: 'Austria', country_iso_num: '040' },
  CPH: { iata: 'CPH', city: 'Copenhagen', lat: 55.618, lon: 12.656, country_name: 'Denmark', country_iso_num: '208' },
  EVN: { iata: 'EVN', city: 'Yerevan', lat: 40.1473, lon: 44.3959, country_name: 'Armenia', country_iso_num: '051' },
  MJI: { iata: 'MJI', city: 'Tripoli Mitiga', lat: 32.8941, lon: 13.276, country_name: 'Libya', country_iso_num: '434' },
  TIP: { iata: 'TIP', city: 'Tripoli', lat: 32.6635, lon: 13.159, country_name: 'Libya', country_iso_num: '434' },
};

coreRouter.get('/api/corridors', (req: Request, res: Response) => {
  const airportId = req.query.airport_id ? String(req.query.airport_id).trim().toUpperCase() : 'ALL';
  const recordNature = req.query.record_nature ? String(req.query.record_nature).trim().toLowerCase() : '';
  const movementType = req.query.movement_type ? String(req.query.movement_type).trim().toLowerCase() : '';

  const clauses = ["connected_airport_iata IS NOT NULL", "connected_airport_iata != ''"];
  const params: SQLInputValue[] = [];
  if (airportId && airportId !== 'ALL') {
    clauses.push('airport_id = ?');
    params.push(airportId);
  }
  if (recordNature && recordNature !== 'all') {
    clauses.push('record_nature = ?');
    params.push(recordNature);
  }
  if (movementType && movementType !== 'all') {
    clauses.push('movement_type = ?');
    params.push(movementType);
  }

  const whereSql = clauses.join(' AND ');

  const { rawCorridors, originSummaryRows } = withMainDb((db) => {
    const corr = queryAll(
      db,
      `SELECT
        airport_id,
        connected_airport_iata,
        MAX(connected_airport_name) as destination_name,
        MAX(connected_city) as destination_city,
        COUNT(*) as total_events,
        SUM(CASE WHEN record_nature = 'physical_movement' THEN 1 ELSE 0 END) as observed_events,
        SUM(CASE WHEN record_nature = 'scheduled_service' THEN 1 ELSE 0 END) as scheduled_events,
        SUM(CASE WHEN record_nature = 'marketing_codeshare' THEN 1 ELSE 0 END) as codeshare_events,
        SUM(CASE WHEN record_nature = 'unverified_movement' THEN 1 ELSE 0 END) as unverified_events,
        SUM(CASE WHEN movement_type = 'arrival' THEN 1 ELSE 0 END) as arrivals,
        SUM(CASE WHEN movement_type = 'departure' THEN 1 ELSE 0 END) as departures,
        COUNT(DISTINCT NULLIF(airline_name, '')) as airlines_count,
        GROUP_CONCAT(DISTINCT NULLIF(airline_name, '')) as airlines_raw,
        MAX(flight_date) as last_flight_date
       FROM flight_events
       WHERE ${whereSql}
       GROUP BY airport_id, connected_airport_iata
       ORDER BY total_events DESC`,
      params
    );

    const originClauses: string[] = [];
    const originParams: SQLInputValue[] = [];
    if (recordNature && recordNature !== 'all') {
      originClauses.push('record_nature = ?');
      originParams.push(recordNature);
    }
    if (movementType && movementType !== 'all') {
      originClauses.push('movement_type = ?');
      originParams.push(movementType);
    }
    const originWhere = originClauses.length > 0 ? `WHERE ${originClauses.join(' AND ')}` : '';

    const originRows = queryAll(
      db,
      `SELECT airport_id,
              COUNT(*) as total_events,
              SUM(CASE WHEN record_nature = 'physical_movement' THEN 1 ELSE 0 END) as observed_events,
              SUM(CASE WHEN record_nature = 'scheduled_service' THEN 1 ELSE 0 END) as scheduled_events,
              COUNT(DISTINCT NULLIF(connected_airport_iata, '')) as destinations_count
       FROM flight_events
       ${originWhere}
       GROUP BY airport_id`,
      originParams
    );

    return { rawCorridors: corr, originSummaryRows: originRows };
  });

  // Also pull Archived FIDS corridor counts for DAM unless filtered strictly to physical_movement
  const fidsByDest = new Map<string, number>();
  if ((airportId === 'ALL' || airportId === 'DAM') && recordNature !== 'physical_movement') {
    const fidsClauses = ['1=1'];
    const fidsParams: SQLInputValue[] = [];
    if (movementType && movementType !== 'all') {
      fidsClauses.push('movement_type = ?');
      fidsParams.push(movementType);
    }
    const fidsRows = withAnalyticsDb((db) =>
      queryAll(
        db,
        `SELECT CASE WHEN origin_iata = 'DAM' THEN destination_iata ELSE origin_iata END as dest_iata,
                COUNT(*) as cnt
         FROM fids_analytics_records
         WHERE ${fidsClauses.join(' AND ')}
         GROUP BY dest_iata`,
        fidsParams
      )
    );
    for (const r of fidsRows) {
      const code = String(r.dest_iata || '').toUpperCase();
      if (code && code !== 'DAM') {
        fidsByDest.set(code, Number(r.cnt ?? 0));
      }
    }
  }

  const originMap = new Map<
    string,
    { total_events: number; observed_events: number; scheduled_events: number; destinations_count: number }
  >();
  for (const r of originSummaryRows) {
    originMap.set(String(r.airport_id), {
      total_events: Number(r.total_events ?? 0),
      observed_events: Number(r.observed_events ?? 0),
      scheduled_events: Number(r.scheduled_events ?? 0),
      destinations_count: Number(r.destinations_count ?? 0),
    });
  }

  const origins = Object.values(SYRIAN_AIRPORTS_REGISTRY).map((ap) => {
    const st = originMap.get(ap.airport_id);
    return {
      airport_id: ap.airport_id,
      iata_code: ap.iata_code || ap.icao_code,
      icao_code: ap.icao_code,
      name: ap.name,
      city: ap.city,
      lat: ap.latitude,
      lon: ap.longitude,
      operational_status: ap.operational_status,
      total_events: st?.total_events ?? 0,
      observed_events: st?.observed_events ?? 0,
      scheduled_events: st?.scheduled_events ?? 0,
      destinations_count: st?.destinations_count ?? 0,
    };
  });

  const corridors: Array<Record<string, unknown>> = [];
  const seenPairs = new Set<string>();

  for (const row of rawCorridors) {
    const orig = String(row.airport_id || '').toUpperCase();
    const dest = String(row.connected_airport_iata || '').toUpperCase();
    const origGeo = AIRPORT_GEO_LOOKUP[orig];
    const destGeo = AIRPORT_GEO_LOOKUP[dest];
    if (!origGeo || !destGeo) continue;

    seenPairs.add(`${orig}->${dest}`);
    const airlinesList = String(row.airlines_raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);

    corridors.push({
      id: `${orig}-${dest}`,
      origin_iata: orig,
      origin_city: origGeo.city,
      origin_lat: origGeo.lat,
      origin_lon: origGeo.lon,
      destination_iata: dest,
      destination_name: String(row.destination_name || `${destGeo.city} Airport`),
      destination_city: destGeo.city,
      destination_lat: destGeo.lat,
      destination_lon: destGeo.lon,
      country_name: destGeo.country_name,
      country_iso_num: destGeo.country_iso_num,
      is_domestic: destGeo.country_iso_num === '760',
      total_events: Number(row.total_events ?? 0),
      observed_events: Number(row.observed_events ?? 0),
      scheduled_events: Number(row.scheduled_events ?? 0),
      codeshare_events: Number(row.codeshare_events ?? 0),
      unverified_events: Number(row.unverified_events ?? 0),
      arrivals: Number(row.arrivals ?? 0),
      departures: Number(row.departures ?? 0),
      fids_slots: orig === 'DAM' && recordNature !== 'physical_movement' ? (fidsByDest.get(dest) ?? 0) : 0,
      airlines_count: Number(row.airlines_count ?? 0),
      airlines: airlinesList,
      last_flight_date: row.last_flight_date ? String(row.last_flight_date) : null,
    });
  }

  // Include DAM Archived FIDS corridors that had 0 October rows (e.g. MED if not present in flight_events)
  if ((airportId === 'ALL' || airportId === 'DAM') && recordNature !== 'physical_movement') {
    for (const [dest, fidsCnt] of fidsByDest.entries()) {
      if (seenPairs.has(`DAM->${dest}`)) continue;
      const origGeo = AIRPORT_GEO_LOOKUP.DAM;
      const destGeo = AIRPORT_GEO_LOOKUP[dest];
      if (!destGeo) continue;
      corridors.push({
        id: `DAM-${dest}`,
        origin_iata: 'DAM',
        origin_city: origGeo.city,
        origin_lat: origGeo.lat,
        origin_lon: origGeo.lon,
        destination_iata: dest,
        destination_name: `${destGeo.city} Airport`,
        destination_city: destGeo.city,
        destination_lat: destGeo.lat,
        destination_lon: destGeo.lon,
        country_name: destGeo.country_name,
        country_iso_num: destGeo.country_iso_num,
        is_domestic: destGeo.country_iso_num === '760',
        total_events: 0,
        observed_events: 0,
        scheduled_events: 0,
        codeshare_events: 0,
        unverified_events: 0,
        arrivals: 0,
        departures: 0,
        fids_slots: fidsCnt,
        airlines_count: 0,
        airlines: [],
        last_flight_date: '2026-09-09',
      });
    }
  }

  // Country-level choropleth rollup
  const countryMap = new Map<
    string,
    {
      country_iso_num: string;
      country_name: string;
      total_events: number;
      observed_events: number;
      scheduled_events: number;
      fids_slots: number;
      corridor_count: number;
      airports: Set<string>;
    }
  >();

  for (const c of corridors) {
    const iso = String(c.country_iso_num);
    const name = String(c.country_name);
    let entry = countryMap.get(iso);
    if (!entry) {
      entry = {
        country_iso_num: iso,
        country_name: name,
        total_events: 0,
        observed_events: 0,
        scheduled_events: 0,
        fids_slots: 0,
        corridor_count: 0,
        airports: new Set<string>(),
      };
      countryMap.set(iso, entry);
    }
    entry.total_events += Number(c.total_events ?? 0);
    entry.observed_events += Number(c.observed_events ?? 0);
    entry.scheduled_events += Number(c.scheduled_events ?? 0);
    entry.fids_slots += Number(c.fids_slots ?? 0);
    entry.corridor_count += 1;
    entry.airports.add(String(c.destination_iata));
  }

  const country_totals = Array.from(countryMap.values())
    .map((e) => ({
      country_iso_num: e.country_iso_num,
      country_name: e.country_name,
      total_events: e.total_events,
      observed_events: e.observed_events,
      scheduled_events: e.scheduled_events,
      fids_slots: e.fids_slots,
      corridor_count: e.corridor_count,
      airports: Array.from(e.airports),
    }))
    .sort((a, b) => b.total_events + b.fids_slots - (a.total_events + a.fids_slots));

  res.json({
    airport_id: airportId,
    filters: {
      record_nature: recordNature || 'all',
      movement_type: movementType || 'all',
    },
    origins,
    corridors,
    country_totals,
    summary: {
      active_corridors: corridors.length,
      countries_reached: country_totals.filter((c) => c.country_iso_num !== '760').length,
      total_ledger_events: corridors.reduce((s, c) => s + Number(c.total_events || 0), 0),
      total_observed_events: corridors.reduce((s, c) => s + Number(c.observed_events || 0), 0),
      total_fids_slots: corridors.reduce((s, c) => s + Number(c.fids_slots || 0), 0),
    },
  });
});

coreRouter.get('/api/sources', (_req: Request, res: Response) => {
  const rows = withMainDb((db) => queryAll(db, 'SELECT * FROM source_registry ORDER BY scope, source_id;'));
  res.json(rows);
});

coreRouter.get('/api/deduplication', (req: Request, res: Response) => {
  const airportId = req.query.airport_id ? String(req.query.airport_id) : null;
  const resolution = req.query.resolution ? String(req.query.resolution) : null;
  const limit = clampInt(req.query.limit, 100, 1, 500);
  const offset = clampInt(req.query.offset, 0, 0, 1_000_000);

  let where = 'WHERE 1=1';
  const params: SQLInputValue[] = [];
  if (airportId) {
    where += ' AND airport_id = ?';
    params.push(airportId.toUpperCase());
  }
  if (resolution) {
    where += ' AND resolution_status = ?';
    params.push(resolution.toUpperCase());
  }

  const result = withMainDb((db) => {
    const total = Number(queryOne(db, `SELECT COUNT(*) as cnt FROM deduplication_audit ${where}`, params)?.cnt ?? 0);
    const rows = queryAll(db, `SELECT * FROM deduplication_audit ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [
      ...params,
      limit,
      offset,
    ]);
    return { total, rows };
  });

  res.json({
    total_records: result.total,
    total_comparisons_logged: result.total,
    limit,
    offset,
    records: result.rows,
    data: result.rows,
  });
});

coreRouter.get('/api/ingestion/health', (_req: Request, res: Response) => {
  const data = withMainDb((db) => {
    const sumRows = queryAll(
      db,
      `SELECT status, count(*) as count, sum(records_fetched) as total_records
       FROM ingestion_runs
       GROUP BY status`
    );
    const summary: Record<string, { count: number; records: number }> = {};
    for (const r of sumRows) {
      summary[String(r.status ?? '')] = {
        count: Number(r.count ?? 0),
        records: Number(r.total_records ?? 0),
      };
    }
    const recentRuns = queryAll(
      db,
      `SELECT run_id, run_timestamp, source_id, airport_id, status, records_fetched,
              http_status, error_message, duration_seconds
       FROM ingestion_runs
       ORDER BY run_timestamp DESC
       LIMIT 25`
    );
    const sourcesHealth = queryAll(
      db,
      `SELECT source_id, provider_name, source_type, supported_airports,
              access_status, freshness_indicator, reliability_indicator,
              last_successful_retrieval, known_limitations
       FROM source_registry
       ORDER BY source_id`
    );
    return { summary, recentRuns, sourcesHealth };
  });

  res.json({
    overall_status: 'OPERATIONAL',
    summary: data.summary,
    recent_runs: data.recentRuns,
    sources_health: data.sourcesHealth,
  });
});

coreRouter.get('/api/coverage/matrix', (req: Request, res: Response) => {
  const airportId = req.query.airport_id ? String(req.query.airport_id) : null;
  const classification = req.query.classification ? String(req.query.classification) : null;
  const startDate = req.query.start_date ? String(req.query.start_date) : null;
  const endDate = req.query.end_date ? String(req.query.end_date) : null;
  const limit = clampInt(req.query.limit, 100, 1, 5000);
  const offset = clampInt(req.query.offset, 0, 0, 1_000_000);

  let where = 'WHERE 1=1';
  const params: SQLInputValue[] = [];
  if (airportId) {
    where += ' AND airport_id = ?';
    params.push(airportId.toUpperCase());
  }
  if (classification) {
    where += ' AND coverage_classification = ?';
    params.push(classification.toLowerCase());
  }
  if (startDate) {
    where += ' AND flight_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    where += ' AND flight_date <= ?';
    params.push(endDate);
  }

  const data = withMainDb((db) => {
    const total = Number(
      queryOne(db, `SELECT COUNT(*) as cnt FROM historical_coverage_matrix ${where}`, params)?.cnt ?? 0
    );
    const classRows = queryAll(
      db,
      `SELECT coverage_classification, COUNT(*) as count FROM historical_coverage_matrix ${where} GROUP BY coverage_classification`,
      params
    );
    const classCounts: Record<string, number> = {};
    for (const r of classRows) {
      classCounts[String(r.coverage_classification ?? '')] = Number(r.count ?? 0);
    }
    const matrix = queryAll(
      db,
      `SELECT * FROM historical_coverage_matrix ${where} ORDER BY flight_date DESC, airport_id ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return { total, classCounts, matrix };
  });

  res.json({
    total_cells: data.total,
    classification_breakdown: data.classCounts,
    limit,
    offset,
    matrix: data.matrix,
  });
});

coreRouter.get('/api/coverage/heatmap', (req: Request, res: Response) => {
  const monthParam = req.query.month ? String(req.query.month).trim() : '2026-10';
  const targetMonth = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : '2026-10';

  const AIRPORTS_ORDER = ['DAM', 'ALP', 'DEZ', 'LTK', 'KAC'];

  const mainData = withMainDb((db) => {
    const monthlyRows = queryAll(
      db,
      `SELECT airport_id,
              substr(flight_date, 1, 7) as year_month,
              COUNT(*) as total_days,
              SUM(CASE WHEN coverage_classification != 'unverified_data_gap' THEN 1 ELSE 0 END) as non_gap_days,
              SUM(CASE WHEN coverage_classification = 'verified_coverage' THEN 1 ELSE 0 END) as verified_days,
              SUM(CASE WHEN coverage_classification = 'commercial_schedule_only' THEN 1 ELSE 0 END) as schedule_days,
              SUM(CASE WHEN coverage_classification = 'future_schedule' THEN 1 ELSE 0 END) as future_days,
              SUM(CASE WHEN coverage_classification = 'source_checked_no_records' THEN 1 ELSE 0 END) as checked_empty_days,
              SUM(verified_movements_count) as verified_records,
              SUM(commercial_records_count) as commercial_records
       FROM historical_coverage_matrix
       GROUP BY airport_id, substr(flight_date, 1, 7)
       ORDER BY year_month ASC, airport_id ASC`
    );

    const dailyRows = queryAll(
      db,
      `SELECT airport_id, flight_date, coverage_classification,
              verified_movements_count, commercial_records_count,
              sources_checked, evidence_basis, notes
       FROM historical_coverage_matrix
       WHERE substr(flight_date, 1, 7) = ?
       ORDER BY airport_id ASC, flight_date ASC`,
      [targetMonth]
    );

    const sem2024Monthly = queryAll(
      db,
      `SELECT substr(flight_date, 1, 7) as year_month,
              SUM(total_recorded_operations) as total_ops,
              COUNT(DISTINCT flight_date) as days_count
       FROM historical_daily_movements_2024
       GROUP BY substr(flight_date, 1, 7)
       ORDER BY year_month ASC`
    );

    return { monthlyRows, dailyRows, sem2024Monthly };
  });

  // Also fetch DAM archived FIDS counts by month & day so Jul-Sep 2026 density is visible cleanly
  const fidsData = withAnalyticsDb((db) => {
    const fidsMonthly = queryAll(
      db,
      `SELECT substr(scheduled_date, 1, 7) as year_month,
              COUNT(*) as fids_records,
              COUNT(DISTINCT scheduled_date) as fids_days
       FROM fids_analytics_records
       GROUP BY substr(scheduled_date, 1, 7)`
    );
    const fidsDaily = queryAll(
      db,
      `SELECT scheduled_date as flight_date, COUNT(*) as fids_records
       FROM fids_analytics_records
       WHERE substr(scheduled_date, 1, 7) = ?
       GROUP BY scheduled_date`,
      [targetMonth]
    );
    return { fidsMonthly, fidsDaily };
  });

  const fidsMonthMap = new Map<string, { fids_records: number; fids_days: number }>();
  for (const r of fidsData.fidsMonthly) {
    fidsMonthMap.set(String(r.year_month), {
      fids_records: Number(r.fids_records ?? 0),
      fids_days: Number(r.fids_days ?? 0),
    });
  }

  const fidsDayMap = new Map<string, number>();
  for (const r of fidsData.fidsDaily) {
    fidsDayMap.set(String(r.flight_date), Number(r.fids_records ?? 0));
  }

  const semMonthMap = new Map<string, { total_ops: number; days_count: number }>();
  for (const r of mainData.sem2024Monthly) {
    semMonthMap.set(String(r.year_month), {
      total_ops: Number(r.total_ops ?? 0),
      days_count: Number(r.days_count ?? 0),
    });
  }

  const monthsSet = new Set<string>();
  const monthlyCells = mainData.monthlyRows.map((r) => {
    const ap = String(r.airport_id);
    const ym = String(r.year_month);
    monthsSet.add(ym);
    const fids = ap === 'DAM' ? fidsMonthMap.get(ym) : undefined;
    const sem = ap === 'DAM' || ap === 'ALP' || ap === 'LTK' ? semMonthMap.get(ym) : undefined;
    const verified = Number(r.verified_records ?? 0);
    const commercial = Number(r.commercial_records ?? 0);
    const fidsRecs = fids?.fids_records ?? 0;

    return {
      airport_id: ap,
      year_month: ym,
      total_days: Number(r.total_days ?? 0),
      non_gap_days: Number(r.non_gap_days ?? 0),
      verified_days: Number(r.verified_days ?? 0),
      schedule_days: Number(r.schedule_days ?? 0),
      future_days: Number(r.future_days ?? 0),
      checked_empty_days: Number(r.checked_empty_days ?? 0),
      verified_records: verified,
      commercial_records: commercial,
      fids_records: fidsRecs,
      fids_days: fids?.fids_days ?? 0,
      sem_2024_macro_ops: sem?.total_ops ?? 0,
      direct_density_records: verified + commercial,
    };
  });

  const datesSet = new Set<string>();
  const dailyCells = mainData.dailyRows.map((r) => {
    const ap = String(r.airport_id);
    const fd = String(r.flight_date);
    datesSet.add(fd);
    const verified = Number(r.verified_movements_count ?? 0);
    const commercial = Number(r.commercial_records_count ?? 0);
    const fidsRecs = ap === 'DAM' ? (fidsDayMap.get(fd) ?? 0) : 0;

    return {
      airport_id: ap,
      flight_date: fd,
      coverage_classification: String(r.coverage_classification ?? 'unverified_data_gap'),
      verified_movements_count: verified,
      commercial_records_count: commercial,
      fids_records_count: fidsRecs,
      sources_checked: String(r.sources_checked ?? ''),
      evidence_basis: String(r.evidence_basis ?? ''),
      notes: String(r.notes ?? ''),
    };
  });

  res.json({
    airports: AIRPORTS_ORDER,
    months: Array.from(monthsSet).sort(),
    selected_month: targetMonth,
    dates: Array.from(datesSet).sort(),
    monthly_cells: monthlyCells,
    daily_cells: dailyCells,
  });
});

coreRouter.get('/api/coverage', (_req: Request, res: Response) => {
  const covPath = path.join(REPORTS_DIR, 'coverage_report.json');
  if (fs.existsSync(covPath)) {
    return res.json(JSON.parse(fs.readFileSync(covPath, 'utf-8')));
  }
  return res.json({ message: 'Coverage report not found.' });
});

coreRouter.get('/api/quality', (_req: Request, res: Response) => {
  const qPath = path.join(REPORTS_DIR, 'quality_audit.json');
  if (fs.existsSync(qPath)) {
    return res.json(JSON.parse(fs.readFileSync(qPath, 'utf-8')));
  }
  return res.json({ message: 'Quality audit report not found.' });
});

coreRouter.get('/api/historical-coverage/timeline', (_req: Request, res: Response) => {
  const timelineCsv = path.join(REPORTS_DIR, 'v2_18_1_coverage_correction.csv');
  const timeline: DbRow[] = [];

  if (fs.existsSync(timelineCsv)) {
    const content = fs.readFileSync(timelineCsv, 'utf-8');
    const records = parse(content, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;
    for (const r of records) {
      const ym = r.year_month;
      const cat = r.corrected_category;
      const rawCnt = Number.parseInt(r.raw_records_count || '0', 10) || 0;
      const scope = r.airport_scope;

      let scopeDesc = scope;
      let evLevel = 'unknown';
      let warning = 'Unclassified temporal window.';
      let isDam = false;
      let hasDamObs = false;

      if (cat === 'regional_aggregate') {
        scopeDesc = 'DAM_ALP_LTK (Syrian Commercial Gateways Aggregate)';
        evLevel = 'multi_airport_macro_aggregate';
        warning =
          'Three-airport regional aggregate (DAM, ALP, LTK combined); zero DAM-specific disaggregation available. Cannot be used as DAM movement counts.';
      } else if (cat === 'no_verified_dam_data') {
        scopeDesc = 'NONE (Platform Data Gap)';
        evLevel = 'no_coverage';
        warning =
          'Platform historical data gap; zero verified Damascus records recovered. Indicates absence of source data, never zero flights or airport closure.';
      } else if (cat === 'dam_scheduled_fids') {
        scopeDesc = 'Damascus International Airport (DAM)';
        evLevel = 'scheduled_timetable_display';
        warning = 'Official archived FIDS schedule slots. Represents timetable records, not physical radar-confirmed movements.';
        isDam = true;
        hasDamObs = true;
      } else if (cat === 'live_regional_adsb') {
        scopeDesc = 'Damascus (DAM) & Regional Airspace';
        evLevel = 'regional_airspace_observation';
        warning =
          'Live ADS-B sample query covering 15 regional overflights and 1 regional transit. Does not confirm direct runway movements.';
        hasDamObs = true;
      }

      timeline.push({
        source_period: ym,
        geographic_scope: scopeDesc,
        dataset_category: cat,
        evidence_level: evLevel,
        record_count: rawCnt,
        explicit_warning: warning,
        is_dam_specific: isDam,
        contains_dam_observation: hasDamObs,
      });
    }
  }

  res.json({
    audit_window: '2024-01 through 2026-10 (34 months)',
    total_months: timeline.length,
    timeline,
    disclaimer:
      'Do not display regional aggregates, archived schedules, and live regional ADS-B samples as one continuous DAM movement series. Data gaps represent unrecovered platform coverage, never zero flights or airport closure.',
  });
});

function sanitizeHeaderValue(val: string): string {
  return val
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMetadataHeaders(targetKey: string): Record<string, string> {
  const meta = EXPORT_METADATA[targetKey];
  return {
    'X-Dataset-Name': sanitizeHeaderValue(meta?.dataset_name || targetKey),
    'X-Dataset-Scope': sanitizeHeaderValue(meta?.geographic_scope || meta?.scope || 'Unspecified'),
    'X-Dataset-Category': sanitizeHeaderValue(meta?.dataset_category || meta?.category || 'unknown'),
    'X-Evidence-Level': sanitizeHeaderValue(meta?.evidence_level || 'unknown'),
    'X-Source-Provenance': sanitizeHeaderValue(meta?.source_provenance || meta?.provenance || 'Unknown'),
    'X-Source-Observation-Period': sanitizeHeaderValue(meta?.source_observation_period || 'Unknown'),
    'X-Generation-Timestamp': sanitizeHeaderValue(meta?.generation_timestamp || '2026-10-11T17:45:00Z'),
    'X-Known-Limitations': sanitizeHeaderValue(meta?.known_limitations || 'None'),
    'X-Generated-At': sanitizeHeaderValue(meta?.generation_timestamp || '2026-10-11T17:45:00Z'),
  };
}

function resolveDatasetFile(baseName: string, ext: string): string | null {
  const filename = `${baseName}.${ext}`;
  const inProcessed = path.join(PROCESSED_DATA_DIR, filename);
  if (fs.existsSync(inProcessed)) return inProcessed;
  const inReports = path.join(REPORTS_DIR, filename);
  if (fs.existsSync(inReports)) return inReports;
  return null;
}

coreRouter.get('/api/export/:dataset/sidecar', (req: Request, res: Response) => {
  const dataset = String(req.params.dataset || '').toLowerCase().trim();
  if (!VALID_EXPORT_DATASETS[dataset]) {
    return res.status(404).json({ detail: `Dataset '${dataset}' not found.` });
  }
  const targetKey = VALID_EXPORT_DATASETS[dataset];
  const meta = EXPORT_METADATA[targetKey] || {};
  const headers = buildMetadataHeaders(targetKey);
  res.set({
    ...headers,
    'Content-Disposition': `attachment; filename="${targetKey}.metadata.json"`,
    'Content-Type': 'application/json',
  });
  return res.send(JSON.stringify(meta, null, 2));
});

coreRouter.get('/api/export/:dataset/metadata', (req: Request, res: Response) => {
  const dataset = String(req.params.dataset || '').toLowerCase().trim();
  if (!VALID_EXPORT_DATASETS[dataset]) {
    return res.status(404).json({ detail: `Dataset '${dataset}' not found.` });
  }
  const targetKey = VALID_EXPORT_DATASETS[dataset];
  const meta = EXPORT_METADATA[targetKey] || {};
  return res.json({
    dataset_key: dataset,
    canonical_target: targetKey,
    metadata: meta,
  });
});

coreRouter.get('/api/export/:dataset', (req: Request, res: Response) => {
  const dataset = String(req.params.dataset || '').toLowerCase().trim();
  const format = String(req.query.format || 'csv').toLowerCase();
  const includeMetadata = String(req.query.include_metadata || '').toLowerCase() === 'true';

  if (!VALID_EXPORT_DATASETS[dataset]) {
    return res.status(404).json({ detail: `Dataset '${dataset}' not found.` });
  }
  if (format !== 'csv' && format !== 'json') {
    return res.status(422).json({ detail: "Invalid format. Must be 'csv' or 'json'." });
  }

  const targetKey = VALID_EXPORT_DATASETS[dataset];
  const filename = `${targetKey}.${format}`;
  const exactPath = resolveDatasetFile(targetKey, format);
  const csvFallbackPath = format === 'json' ? resolveDatasetFile(targetKey, 'csv') : null;

  if (!exactPath && !csvFallbackPath) {
    return res.status(404).json({ detail: `Export file '${filename}' not found.` });
  }

  const headers = buildMetadataHeaders(targetKey);
  const meta = EXPORT_METADATA[targetKey] || {};

  if (format === 'json') {
    const content = exactPath
      ? JSON.parse(fs.readFileSync(exactPath, 'utf-8'))
      : parse(fs.readFileSync(csvFallbackPath!, 'utf-8'), { columns: true, skip_empty_lines: true });

    res.set({
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
      ...(includeMetadata ? {} : { 'Content-Disposition': `attachment; filename="${filename}"` }),
    });
    return res.send(JSON.stringify(includeMetadata ? { metadata: meta, data: content } : content, null, 2));
  }

  if (!includeMetadata) {
    res.set({
      ...headers,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return res.sendFile(exactPath!);
  }

  const content = fs.readFileSync(exactPath!, 'utf-8');
  const headerComment = [
    '# METADATA',
    `# dataset_name: ${meta.dataset_name}`,
    `# geographic_scope: ${meta.geographic_scope}`,
    `# dataset_category: ${meta.dataset_category}`,
    `# evidence_level: ${meta.evidence_level}`,
    `# source_provenance: ${meta.source_provenance}`,
    `# source_observation_period: ${meta.source_observation_period}`,
    `# generation_timestamp: ${meta.generation_timestamp}`,
    `# known_limitations: ${meta.known_limitations}`,
    '',
  ].join('\n');

  res.set({ ...headers, 'Content-Type': 'text/csv; charset=utf-8' });
  return res.send(headerComment + content);
});
