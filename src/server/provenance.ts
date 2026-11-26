import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { REPORTS_DIR } from './config.ts';
import { queryAll, type DbRow } from './db.ts';

interface EstimatedEventCorrection {
  raw_field: string;
  target_field: 'actual_dep_time' | 'actual_arr_time';
  correct_field: 'estimated_dep_time' | 'estimated_arr_time';
  movement: string;
  flight: string;
}

export const ESTIMATED_IN_ACTUAL_EVENTS: Record<string, EstimatedEventCorrection> = {
  // 9 physical_movement departure events where foreign destination arrival ETA was mapped to actual_arr_time
  '6f3f3b3c16844646': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'departure', flight: 'PC771' },
  '339297a946c498c3': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'departure', flight: 'XY230' },
  'ed1a39d3aa27b295': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'departure', flight: 'EY562' },
  'c5dbcfdfa11cb7b3': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'departure', flight: 'FYC521' },
  '14175fe4b51cfa91': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'departure', flight: 'FYC727' },
  'ca726fcf8dc8a9df': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'departure', flight: 'FZ1114' },
  '81d8452b0a0b029f': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'departure', flight: 'G9376' },
  'f6afc1b400abecc6': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'departure', flight: 'RB441' },
  '85e816d0ed6253c6': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'departure', flight: 'XY592' },
  // 31 scheduled_service events where estimated departure or arrival was mapped to actual fields
  'ebbb2ef5f7ab759c': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'arrival', flight: 'FZ1191' },
  '8ac27ea339ce9326': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'arrival', flight: 'G9351' },
  '0c2bc8bc07b082e7': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'arrival', flight: '3L456' },
  '940e9ab59df40177': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'arrival', flight: 'FZ1191' },
  '5080817825bafe34': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'arrival', flight: 'G9351' },
  '0a42d9b15f88603b': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'arrival', flight: 'RJ433' },
  '3524fb07f594da11': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'arrival', flight: 'XY229' },
  'ebc42abf6aa5ea9c': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'arrival', flight: 'G9351' },
  '8497422faec026ad': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'arrival', flight: 'XQ808' },
  '4d1bb226d3e5b33e': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'arrival', flight: 'VF317' },
  'e8f0ec5e3c44c85e': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'arrival', flight: 'VF591' },
  'c1b86a292e2b8449': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'arrival', flight: 'XY377' },
  '6e9ccc725c3b169e': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'departure', flight: 'G9376' },
  '2bf0ecb1ec6710bf': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'departure', flight: 'VF318' },
  '5831ce0a6370bfbe': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'arrival', flight: 'FYC522' },
  'd25e1e9000d0755b': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'arrival', flight: 'FYC728' },
  '8ea516585dbbdf5e': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'arrival', flight: 'VF317' },
  '78e4584fff8d8db2': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'arrival', flight: 'XY377' },
  '0ba6fcaa740988fe': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'departure', flight: 'RB272' },
  '768c17d5df43ecf3': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'departure', flight: 'VF318' },
  '6bc29421a851a18d': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'arrival', flight: 'EY561' },
  '51cc663b38bc7df7': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'arrival', flight: 'G9363' },
  'b1ae2ce4a8f34b5a': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'arrival', flight: 'G9375' },
  'a47846504421ffc7': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'arrival', flight: 'G9433' },
  '2aa4ee6f73e0f144': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'arrival', flight: 'QR410' },
  '092de51eac9b78e9': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'arrival', flight: 'RB444' },
  'f25f071416ef33e0': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'arrival', flight: 'TK848' },
  'f1d1a2360948b303': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'departure', flight: 'EY562' },
  'd6420e85d3e001ef': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'departure', flight: 'TUAF154' },
  'd6088a84e8aa8f04': { raw_field: 'time.estimated.arrival', target_field: 'actual_arr_time', correct_field: 'estimated_arr_time', movement: 'arrival', flight: 'J9179' },
  'cdc36216646c747c': { raw_field: 'time.estimated.departure', target_field: 'actual_dep_time', correct_field: 'estimated_dep_time', movement: 'arrival', flight: 'RB342' },
};

export interface MislabeledEvidenceAuditItem {
  evidence_id: string;
  event_id?: string;
  original_evidence_type: string;
  corrected_semantic_interpretation: string;
  original_raw_source_field: string;
  correction_status: string;
  reason: string;
  [key: string]: unknown;
}

export const MISLABELED_EVIDENCE_MAP: Record<string, MislabeledEvidenceAuditItem> = (() => {
  const auditFile = path.join(REPORTS_DIR, 'v2_20_6_mislabeled_evidence_audit.json');
  if (!fs.existsSync(auditFile)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(auditFile, 'utf-8')) as MislabeledEvidenceAuditItem[];
    const map: Record<string, MislabeledEvidenceAuditItem> = {};
    for (const item of raw) {
      if (item.evidence_id) map[item.evidence_id] = item;
    }
    return map;
  } catch {
    return {};
  }
})();

const damascusDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Damascus',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function toDamascusDate(isoTs: unknown): string | null {
  if (typeof isoTs !== 'string' || !isoTs.trim()) return null;
  const s = isoTs.trim();
  const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
  if (!hasTz) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return damascusDateFormatter.format(d);
}

export function normalizeTimestampToUtc(tsVal: unknown): string | null {
  if (tsVal === null || tsVal === undefined || tsVal === '') return null;
  const s = String(tsVal).trim();
  if (!s || s.toLowerCase() === 'none' || s.toLowerCase() === 'null') return null;

  if (/^\d+$/.test(s)) {
    const v = Number(s);
    let ms = v;
    if (s.length === 10) ms = v * 1000;
    else if (s.length === 13) ms = v;
    else if (s.length > 13) ms = v / 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
  } else if (/^\d+\.\d+$/.test(s)) {
    let v = Number(s);
    if (v > 1e11) v = v / 1000;
    const d = new Date(v * 1000);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
  }

  const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
  if (!hasTz) return null;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  return null;
}

export function correctFlightRecordSemantics(record: DbRow): DbRow {
  const eid = String(record.event_id ?? '');
  const mtype = String(record.movement_type ?? '');
  const nature = String(record.record_nature ?? '');

  let schedDep = (record.scheduled_dep_time as string | null) ?? null;
  let estDep = (record.estimated_dep_time as string | null) ?? null;
  let actDep = (record.actual_dep_time as string | null) ?? null;
  let schedArr = (record.scheduled_arr_time as string | null) ?? null;
  let estArr = (record.estimated_arr_time as string | null) ?? null;
  let actArr = (record.actual_arr_time as string | null) ?? null;

  const rawSchedDep = record.raw_scheduled_dep_time ?? null;
  let rawEstDep = record.raw_estimated_dep_time ?? null;
  let rawActDep = record.raw_actual_dep_time ?? null;
  const rawSchedArr = record.raw_scheduled_arr_time ?? null;
  let rawEstArr = record.raw_estimated_arr_time ?? null;
  let rawActArr = record.raw_actual_arr_time ?? null;

  const estInfo = ESTIMATED_IN_ACTUAL_EVENTS[eid];
  if (estInfo) {
    if (estInfo.target_field === 'actual_dep_time') {
      if (actDep && !estDep) {
        estDep = actDep;
        rawEstDep = rawActDep;
      }
      actDep = null;
      rawActDep = null;
    } else if (estInfo.target_field === 'actual_arr_time') {
      if (actArr && !estArr) {
        estArr = actArr;
        rawEstArr = rawActArr;
      }
      actArr = null;
      rawActArr = null;
    }
  }

  if (nature === 'scheduled_service' || nature === 'scheduled_timetable') {
    if (actDep) {
      if (!estDep) {
        estDep = actDep;
        rawEstDep = rawActDep;
      }
      actDep = null;
      rawActDep = null;
    }
    if (actArr) {
      if (!estArr) {
        estArr = actArr;
        rawEstArr = rawActArr;
      }
      actArr = null;
      rawActArr = null;
    }
  }

  const relevantAct = (mtype === 'departure' ? actDep : actArr) || actDep || actArr;
  const relevantEst = (mtype === 'departure' ? estDep : estArr) || estDep || estArr;

  record.scheduled_dep_time = schedDep;
  record.estimated_dep_time = estDep;
  record.actual_dep_time = actDep;
  record.scheduled_arr_time = schedArr;
  record.estimated_arr_time = estArr;
  record.actual_arr_time = actArr;
  record.raw_scheduled_dep_time = rawSchedDep;
  record.raw_estimated_dep_time = rawEstDep;
  record.raw_actual_dep_time = rawActDep;
  record.raw_scheduled_arr_time = rawSchedArr;
  record.raw_estimated_arr_time = rawEstArr;
  record.raw_actual_arr_time = rawActArr;
  record.scheduled_flight_date = record.flight_date ?? null;
  record.actual_movement_date = toDamascusDate(relevantAct);
  record.estimated_movement_date = toDamascusDate(relevantEst);

  return record;
}

export function correctEvidenceItem(evidence: DbRow): DbRow {
  const ev: DbRow = { ...evidence };
  const evId = String(ev.evidence_id ?? '');
  const evType = String(ev.evidence_type ?? '');
  ev.original_evidence_type = ev.original_evidence_type || evType;

  if (evId && MISLABELED_EVIDENCE_MAP[evId]) {
    const info = MISLABELED_EVIDENCE_MAP[evId];
    ev.evidence_type = info.corrected_semantic_interpretation;
    ev.is_estimated = true;
    ev.original_raw_source_field = info.original_raw_source_field;
    ev.raw_source_field = info.original_raw_source_field;
    ev.correction_status = info.correction_status;
    ev.correction_history = [
      {
        action: 'reclassify_semantic_interpretation',
        original_classification: info.original_evidence_type,
        corrected_classification: info.corrected_semantic_interpretation,
        source_field: info.original_raw_source_field,
        mechanism: 'read_time_semantic_correction',
        ledger_status: 'immutable_ledger_preserved',
        reason: info.reason,
      },
    ];
    return ev;
  }

  const rawPayload = String(ev.raw_payload ?? '');
  let isEst = false;
  if (rawPayload.includes('estimated')) {
    if (evType === 'adsb_takeoff' || evType === 'commercial_takeoff') {
      ev.evidence_type = 'estimated_departure';
      isEst = true;
    } else if (evType === 'adsb_touchdown' || evType === 'commercial_touchdown') {
      ev.evidence_type = 'estimated_arrival';
      isEst = true;
    }
  }
  ev.is_estimated = isEst;
  if (isEst) {
    ev.correction_status = 'derived_at_read_time_immutable_ledger_preserved';
    ev.correction_history = [
      {
        action: 'reclassify_semantic_interpretation',
        original_classification: evType,
        corrected_classification: ev.evidence_type,
        mechanism: 'read_time_semantic_correction',
        ledger_status: 'immutable_ledger_preserved',
        reason: 'Derived from payload containing estimated timestamp rather than physical telemetry.',
      },
    ];
  } else {
    ev.correction_status = ev.ledger_status || 'active';
    ev.correction_history = [];
  }
  return ev;
}

export function enrichFlightRecords(rows: DbRow[], db: DatabaseSync): DbRow[] {
  if (rows.length === 0) return rows;

  const eventIds = rows.map((r) => r.event_id).filter((id): id is string => typeof id === 'string' && id.length > 0);
  const evInfo: Record<string, { ev_count: number; prov_count: number; snapshot_path: string | null; raw_ts: unknown }> = {};

  if (eventIds.length > 0) {
    const placeholders = eventIds.map(() => '?').join(',');
    try {
      const evRows = queryAll(
        db,
        `SELECT event_id, COUNT(*) as ev_count, COUNT(DISTINCT source_name) as prov_count,
                MAX(snapshot_path) as snapshot_path, MAX(raw_timestamp) as raw_ts
         FROM v_active_evidence
         WHERE event_id IN (${placeholders})
         GROUP BY event_id`,
        eventIds as SQLInputValue[]
      );
      for (const er of evRows) {
        const eid = String(er.event_id ?? '');
        evInfo[eid] = {
          ev_count: Number(er.ev_count ?? 0),
          prov_count: Number(er.prov_count ?? 0),
          snapshot_path: (er.snapshot_path as string | null) ?? null,
          raw_ts: er.raw_ts ?? null,
        };
      }
    } catch {
      // View might not exist in fallback cases
    }
  }

  for (const r of rows) {
    correctFlightRecordSemantics(r);
    const eid = String(r.event_id ?? '');
    const ev = evInfo[eid];
    const nature = String(r.record_nature ?? '');

    let evidenceLevel = 'unknown';
    if (nature === 'physical_movement') evidenceLevel = 'commercial_status_corroborated';
    else if (nature === 'scheduled_service' || nature === 'scheduled_timetable') evidenceLevel = 'scheduled_timetable_display';
    else if (nature === 'marketing_codeshare') evidenceLevel = 'commercial_partner_listing';
    else if (nature === 'unverified_movement') evidenceLevel = 'unverified_claim';

    let actualTs = (r.movement_type === 'departure' ? r.actual_dep_time : r.actual_arr_time) as string | null;
    if (!actualTs) actualTs = ((r.actual_dep_time || r.actual_arr_time || null) as string | null);

    let estimatedTs = (r.movement_type === 'departure' ? r.estimated_dep_time : r.estimated_arr_time) as string | null;
    if (!estimatedTs) estimatedTs = ((r.estimated_dep_time || r.estimated_arr_time || null) as string | null);

    const rawSourceObsTs =
      ev?.raw_ts ??
      r.raw_actual_dep_time ??
      r.raw_actual_arr_time ??
      r.raw_estimated_dep_time ??
      r.raw_estimated_arr_time ??
      null;
    const normalizedSourceObsTs = normalizeTimestampToUtc(rawSourceObsTs);
    const ingestedAt = r.created_at ?? null;
    const provCnt = ev ? ev.prov_count : r.source ? 1 : 0;
    const indepObsCnt = ev ? ev.ev_count : r.source ? 1 : 0;

    r.scheduled_flight_date = r.flight_date ?? null;
    const refActualTs = nature === 'physical_movement' && normalizedSourceObsTs ? normalizedSourceObsTs : actualTs;
    r.actual_movement_date = refActualTs && actualTs ? toDamascusDate(refActualTs) : null;
    r.estimated_movement_date = estimatedTs ? toDamascusDate(estimatedTs) : null;
    r.geographic_scope = r.airport_id ?? null;
    r.evidence_level = evidenceLevel;
    r.event_classification = nature === 'physical_movement' ? 'commercially_reported_operational_event' : nature || 'unknown';
    r.provider_count = provCnt;
    r.independent_observation_count = indepObsCnt;
    r.independent_provider_count = null;
    r.runway_movement_evidence = null;
    r.source_observed_at = normalizedSourceObsTs;
    r.source_observed_at_raw = rawSourceObsTs !== null && rawSourceObsTs !== undefined ? String(rawSourceObsTs) : null;
    r.source_timestamp = normalizedSourceObsTs;
    r.ingested_at = ingestedAt;
    r.actual_timestamp = actualTs;
    r.estimated_timestamp = estimatedTs;
    r.source_snapshot = ev?.snapshot_path || r.source_record_id || null;
  }

  return rows;
}
