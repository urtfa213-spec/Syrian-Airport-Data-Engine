import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { PROCESSED_DATA_DIR, SYRIAN_AIRPORTS_REGISTRY } from './config.ts';

export const airTrafficRouter = Router();

const PRIMARY_CSV_PATH = path.join(PROCESSED_DATA_DIR, 'all_syrian_flight_events.csv');

interface CsvFlightRow {
  event_id: string;
  airport_id: string;
  airport_iata?: string;
  source: string;
  record_nature: string;
  movement_type: string;
  flight_status: string;
  flight_date: string;
  airline_name: string;
  airline_iata?: string;
  operating_carrier?: string;
  connected_airport_iata: string;
  connected_airport_icao?: string;
  connected_airport_name?: string;
  connected_city?: string;
  flight_number: string;
  aircraft_model: string;
  aircraft_registration?: string;
  aircraft_icao24?: string;
  observed_or_derived: string;
  [key: string]: string | undefined;
}

let cachedRows: CsvFlightRow[] | null = null;

function loadPrimaryFlightEvents(): CsvFlightRow[] {
  if (cachedRows) return cachedRows;
  if (!fs.existsSync(PRIMARY_CSV_PATH)) {
    throw new Error(`Primary dataset file '${PRIMARY_CSV_PATH}' is missing.`);
  }
  const raw = fs.readFileSync(PRIMARY_CSV_PATH, 'utf-8');
  const parsed = parse(raw, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;
  cachedRows = parsed.map((r) => ({
    ...r,
    event_id: String(r.event_id || '').trim(),
    airport_id: String(r.airport_id || '').trim().toUpperCase(),
    source: String(r.source || '').trim(),
    record_nature: String(r.record_nature || '').trim(),
    movement_type: String(r.movement_type || '').trim().toLowerCase(),
    flight_status: String(r.flight_status || '').trim().toLowerCase(),
    flight_date: String(r.flight_date || '').trim(),
    airline_name: String(r.airline_name || '').trim(),
    connected_airport_iata: String(r.connected_airport_iata || '').trim().toUpperCase(),
    flight_number: String(r.flight_number || '').trim(),
    aircraft_model: String(r.aircraft_model || '').trim(),
    observed_or_derived: String(r.observed_or_derived || '').trim(),
  }));
  return cachedRows;
}

interface TrafficFilters {
  airportId?: string;
  month?: string;
  startDate?: string;
  endDate?: string;
  airline?: string;
  destination?: string;
}

function applyFilters(rows: CsvFlightRow[], f: TrafficFilters): CsvFlightRow[] {
  return rows.filter((r) => {
    if (f.airportId && f.airportId.trim()) {
      const ap = f.airportId.trim().toUpperCase();
      if (ap !== 'ALL' && r.airport_id !== ap) return false;
    }
    if (f.month && f.month.trim()) {
      if (!r.flight_date.startsWith(f.month.trim())) return false;
    }
    if (f.startDate && f.startDate.trim()) {
      if (r.flight_date < f.startDate.trim()) return false;
    }
    if (f.endDate && f.endDate.trim()) {
      if (r.flight_date > f.endDate.trim()) return false;
    }
    if (f.airline && f.airline.trim()) {
      const val = f.airline.trim().toLowerCase();
      const match =
        r.airline_name.toLowerCase() === val ||
        String(r.airline_iata || '').toLowerCase() === val ||
        String(r.operating_carrier || '').toLowerCase() === val;
      if (!match) return false;
    }
    if (f.destination && f.destination.trim()) {
      const val = f.destination.trim().toUpperCase();
      const match =
        r.connected_airport_iata === val ||
        String(r.connected_airport_icao || '').toUpperCase() === val ||
        String(r.connected_city || '').toUpperCase() === val;
      if (!match) return false;
    }
    return true;
  });
}

function computeScheduleCoverage(rows: CsvFlightRow[]) {
  const sched = rows.filter((r) => r.record_nature === 'scheduled_service');
  const dates = [...new Set(sched.map((r) => r.flight_date).filter(Boolean))].sort();
  const totalRecords = sched.length;
  const arrCount = sched.filter((r) => r.movement_type === 'arrival').length;
  const depCount = sched.filter((r) => r.movement_type === 'departure').length;
  const airlines = new Set(sched.map((r) => r.airline_name).filter(Boolean));
  const destinations = new Set(sched.map((r) => r.connected_airport_iata).filter(Boolean));

  return {
    status: totalRecords === 0 ? 'No Schedule Records' : 'Available',
    status_ar: totalRecords === 0 ? 'لا توجد سجلات جداول' : 'متاحة',
    scheduled_service_records: totalRecords,
    scheduled_arrivals: arrCount,
    scheduled_departures: depCount,
    scheduled_dates_count: dates.length,
    first_scheduled_date: dates[0] ?? null,
    last_scheduled_date: dates[dates.length - 1] ?? null,
    active_scheduled_airlines: airlines.size,
    active_scheduled_destinations: destinations.size,
  };
}

function computeObservationCoverage(rows: CsvFlightRow[]) {
  const obs = rows.filter((r) => r.record_nature === 'physical_movement');
  const dates = [...new Set(obs.map((r) => r.flight_date).filter(Boolean))].sort();
  const totalRecords = obs.length;
  const obsVal = totalRecords === 0 ? null : totalRecords;
  const arrCount = obs.filter((r) => r.movement_type === 'arrival').length;
  const depCount = obs.filter((r) => r.movement_type === 'departure').length;
  const airlines = new Set(obs.map((r) => r.airline_name).filter(Boolean));
  const destinations = new Set(obs.map((r) => r.connected_airport_iata).filter(Boolean));

  return {
    status: totalRecords === 0 ? 'No Observed Movement Records' : 'Observed Movements Available',
    status_ar: totalRecords === 0 ? 'لا توجد سجلات حركات مرصودة' : 'تتوفر حركات مرصودة',
    observed_movements: obsVal,
    observed_movements_label: 'ADS-B Observed Movements — Commercial Tracking Data (October 9–10 sample only)',
    observed_arrivals: obsVal !== null ? arrCount : null,
    observed_departures: obsVal !== null ? depCount : null,
    observed_dates_count: dates.length,
    observed_dates: dates,
    first_observed_date: dates[0] ?? null,
    last_observed_date: dates[dates.length - 1] ?? null,
    active_observed_airlines: airlines.size,
    active_observed_destinations: destinations.size,
    monitoring_outside_status: 'Monitoring Coverage Unknown',
    monitoring_outside_status_ar: 'تغطية المراقبة خارج هذه التواريخ غير معروفة',
    methodology_note:
      "Observed movements represent available commercial ADS-B tracking observations classified under the project's evidence methodology. They should not be interpreted as complete airport traffic or independent official radar confirmation. 'No Observed Movement Records' does not mean zero flights occurred. Monitoring Coverage Unknown indicates monitoring status outside observed dates cannot be established from available records.",
  };
}

function getDateBounds(rows: CsvFlightRow[]): { minDate: string | null; maxDate: string | null } {
  let minDate: string | null = null;
  let maxDate: string | null = null;
  for (const r of rows) {
    if (!r.flight_date) continue;
    if (!minDate || r.flight_date < minDate) minDate = r.flight_date;
    if (!maxDate || r.flight_date > maxDate) maxDate = r.flight_date;
  }
  return { minDate, maxDate };
}

function getPreviousMonth(ym: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month === 1) return `${year - 1}-12`;
  return `${year}-${String(month - 1).padStart(2, '0')}`;
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function calcPctChange(curr: number, prev: number): number | null {
  if (!Number.isFinite(curr) || !Number.isFinite(prev) || prev <= 0) return null;
  return round1(((curr - prev) / prev) * 100);
}

function getMonthlySummaryData(filters: TrafficFilters) {
  const df = loadPrimaryFlightEvents();
  const filtered = applyFilters(df, filters);

  const groups = new Map<string, CsvFlightRow[]>();
  for (const r of filtered) {
    const m = r.flight_date.slice(0, 7);
    const key = `${m}__${r.airport_id}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const rows = [...groups.entries()].map(([key, grp]) => {
    const [m, ap] = key.split('__');
    const schedCov = computeScheduleCoverage(grp);
    const obsCov = computeObservationCoverage(grp);
    return {
      month: m,
      airport_id: ap,
      scheduled_flights: schedCov.scheduled_service_records,
      scheduled_arrivals: schedCov.scheduled_arrivals,
      scheduled_departures: schedCov.scheduled_departures,
      scheduled_airlines: schedCov.active_scheduled_airlines,
      scheduled_destinations: schedCov.active_scheduled_destinations,
      schedule_coverage_status: schedCov.status,
      actual_movements: obsCov.observed_movements,
      actual_movements_label: 'ADS-B Observed Movements — Commercial Tracking Data (October 9–10 sample only)',
      actual_movements_note:
        obsCov.observed_movements !== null
          ? 'ADS-B Observed Movements — Commercial Tracking Data (October 9–10 sample only)'
          : 'Telemetry unobserved; timetable display only.',
      observed_arrivals: obsCov.observed_arrivals,
      observed_departures: obsCov.observed_departures,
      observed_airlines: obsCov.active_observed_airlines,
      observed_destinations: obsCov.active_observed_destinations,
      observation_coverage_status: obsCov.status,
      monitoring_outside_status: obsCov.monitoring_outside_status,
      passengers: null,
      passengers_note: 'No reliable passenger volume data published.',
      marketing_codeshares: grp.filter((x) => x.record_nature === 'marketing_codeshare').length,
      unverified_movements: grp.filter((x) => x.record_nature === 'unverified_movement').length,
      total_records: grp.length,
    };
  });

  rows.sort((a, b) => {
    if (a.month !== b.month) return b.month.localeCompare(a.month);
    return b.airport_id.localeCompare(a.airport_id);
  });

  return {
    count: rows.length,
    summary: rows,
    disclaimer:
      'Missing actual telemetry intervals remain null (never zero). Scheduled services and observed movements represent different coverage windows and must never be combined into a single total.',
  };
}

function readFilters(req: Request): TrafficFilters {
  return {
    airportId: req.query.airport_id ? String(req.query.airport_id) : undefined,
    month: req.query.month ? String(req.query.month) : undefined,
    startDate: req.query.start_date ? String(req.query.start_date) : undefined,
    endDate: req.query.end_date ? String(req.query.end_date) : undefined,
    airline: req.query.airline ? String(req.query.airline) : undefined,
    destination: req.query.destination ? String(req.query.destination) : undefined,
  };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function sendTabularExport(
  res: Response,
  rows: Array<Record<string, unknown>>,
  format: string,
  baseName: string
) {
  if (format === 'xlsx') {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${baseName}.xlsx"`,
    });
    return res.send(buf);
  }
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const lines = headers.length ? [headers.map(csvCell).join(',')] : [];
  for (const r of rows) {
    lines.push(headers.map((h) => csvCell(r[h])).join(','));
  }
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${baseName}.csv"`,
  });
  return res.send(lines.join('\r\n') + '\r\n');
}

airTrafficRouter.get('/api/air-traffic/kpis', (req: Request, res: Response) => {
  const f = readFilters(req);
  const df = loadPrimaryFlightEvents();
  const effectiveMonth = f.month || '2026-10';
  const filtered = applyFilters(df, {
    ...f,
    month: !(f.startDate || f.endDate) ? effectiveMonth : undefined,
  });

  const schedCov = computeScheduleCoverage(filtered);
  const obsCov = computeObservationCoverage(filtered);
  const codeshareCount = filtered.filter((r) => r.record_nature === 'marketing_codeshare').length;
  const unverifiedCount = filtered.filter((r) => r.record_nature === 'unverified_movement').length;
  const airportsCovered = new Set(filtered.map((r) => r.airport_id).filter(Boolean)).size;
  const activeAirlines = new Set(filtered.map((r) => r.airline_name).filter(Boolean)).size;
  const activeDestinations = new Set(filtered.map((r) => r.connected_airport_iata).filter(Boolean)).size;
  const { minDate, maxDate } = getDateBounds(filtered);
  const scopeLabel =
    f.airportId && f.airportId.toUpperCase() !== 'ALL' ? f.airportId.toUpperCase() : 'All Syrian Aerodromes';

  // Compute empirical period-over-period trends against previous calendar month (or prior observed day)
  const useMonthWindow = !(f.startDate || f.endDate);
  const prevMonth = useMonthWindow ? getPreviousMonth(effectiveMonth) : null;
  const prevFiltered = prevMonth ? applyFilters(df, { ...f, month: prevMonth }) : [];
  const prevRowsExist = prevFiltered.length > 0;
  const prevSched = prevRowsExist ? computeScheduleCoverage(prevFiltered) : null;
  const prevObs = prevRowsExist ? computeObservationCoverage(prevFiltered) : null;
  const prevAirlines = prevRowsExist ? new Set(prevFiltered.map((r) => r.airline_name).filter(Boolean)).size : 0;
  const prevDestinations = prevRowsExist
    ? new Set(prevFiltered.map((r) => r.connected_airport_iata).filter(Boolean)).size
    : 0;
  const prevNonVerified = prevRowsExist
    ? prevFiltered.filter(
        (r) => r.record_nature === 'marketing_codeshare' || r.record_nature === 'unverified_movement'
      ).length
    : 0;

  const curDailyAvg =
    schedCov.scheduled_dates_count > 0
      ? schedCov.scheduled_service_records / schedCov.scheduled_dates_count
      : 0;
  const prevDailyAvg =
    prevSched && prevSched.scheduled_dates_count > 0
      ? prevSched.scheduled_service_records / prevSched.scheduled_dates_count
      : 0;

  const curNonVerified = codeshareCount + unverifiedCount;
  const curNonVerShare = filtered.length > 0 ? (curNonVerified / filtered.length) * 100 : 0;
  const prevNonVerShare = prevRowsExist ? (prevNonVerified / prevFiltered.length) * 100 : 0;

  let sampleDayPct: number | null = null;
  let samplePrevDate: string | null = null;
  let sampleCurrDate: string | null = null;
  if (obsCov.observed_dates.length >= 2) {
    const obsDates = obsCov.observed_dates;
    samplePrevDate = obsDates[obsDates.length - 2];
    sampleCurrDate = obsDates[obsDates.length - 1];
    const obsRows = filtered.filter((r) => r.record_nature === 'physical_movement');
    const prevDayCnt = obsRows.filter((r) => r.flight_date === samplePrevDate).length;
    const currDayCnt = obsRows.filter((r) => r.flight_date === sampleCurrDate).length;
    sampleDayPct = calcPctChange(currDayCnt, prevDayCnt);
  }

  res.json({
    period: {
      month: !(f.startDate || f.endDate) ? effectiveMonth : null,
      start_date: minDate,
      end_date: maxDate,
      label:
        effectiveMonth === '2026-10' && !f.startDate
          ? 'October 2026 (Latest Available Month)'
          : `${minDate} to ${maxDate}`,
    },
    airport_scope: scopeLabel,
    kpis: {
      scheduled_flights: schedCov.scheduled_service_records,
      scheduled_arrivals: schedCov.scheduled_arrivals,
      scheduled_departures: schedCov.scheduled_departures,
      actual_movements: obsCov.observed_movements,
      actual_movements_label: obsCov.observed_movements_label,
      actual_movements_status: obsCov.status,
      active_airlines: activeAirlines,
      active_destinations: activeDestinations,
      airports_covered: airportsCovered,
      registered_airports_total: 7,
      marketing_codeshares: codeshareCount,
      unverified_movements: unverifiedCount,
      passengers: null,
      passengers_note: 'No reliable passenger volume data published for this operational period.',
    },
    trends: {
      previous_month: prevRowsExist ? prevMonth : null,
      scheduled_daily_avg: round1(curDailyAvg),
      previous_scheduled_daily_avg: prevRowsExist ? round1(prevDailyAvg) : null,
      scheduled_daily_avg_pct: prevRowsExist ? calcPctChange(curDailyAvg, prevDailyAvg) : null,
      observed_movements_month_pct:
        prevObs && prevObs.observed_movements !== null && obsCov.observed_movements !== null
          ? calcPctChange(obsCov.observed_movements, prevObs.observed_movements)
          : null,
      observed_sample_day_pct: sampleDayPct,
      observed_sample_prev_date: samplePrevDate,
      observed_sample_curr_date: sampleCurrDate,
      active_airlines_pct: prevRowsExist ? calcPctChange(activeAirlines, prevAirlines) : null,
      active_destinations_pct: prevRowsExist ? calcPctChange(activeDestinations, prevDestinations) : null,
      non_verified_share_pp: prevRowsExist ? round1(curNonVerShare - prevNonVerShare) : null,
    },
    schedule_coverage: schedCov,
    observation_coverage: obsCov,
    definitions: {
      scheduled_flights:
        "Commercial timetable service slots published by official airport display boards across the entire selected period (record_nature = 'scheduled_service'). Includes scheduled, active, cancelled, diverted, and unknown status slots.",
      actual_movements:
        "ADS-B Observed Movements — Commercial Tracking Data (October 9–10 sample only). Physical movements (wheels-off/wheels-down) with Mode-S transponder telemetry (record_nature = 'physical_movement'). Marketing codeshares (20 in landed/departed sample) and unverified movements (3 records) excluded.",
      active_airlines:
        'Distinct airline brands represented across the selected flight dataset. Physical aircraft operations in the Oct 9-10 ADS-B sample represent 17 distinct carriers.',
      active_destinations: 'Distinct destination/origin aerodromes connected to Syrian airports during the selected period.',
      airports_covered:
        'Number of Syrian aerodromes with active flight records during the selected period out of 7 registered aerodromes.',
      marketing_codeshares:
        'Marketing codeshare listings matching physical aircraft transponders 1:1; preserved for transparency but excluded from physical movement counts to avoid double-counting.',
      unverified_movements: 'Movements appearing on airport monitors lacking corroborating ADS-B Mode-S trajectory records.',
      coverage_separation:
        'Schedule Coverage measures published timetable availability; Actual Observation Coverage measures telemetry reception availability. A lack of observed records outside observed dates indicates Monitoring Coverage Unknown, not zero flights.',
    },
  });
});

airTrafficRouter.get('/api/air-traffic/coverage', (req: Request, res: Response) => {
  const f = readFilters(req);
  const df = loadPrimaryFlightEvents();
  const filtered = applyFilters(df, f);
  const { minDate, maxDate } = getDateBounds(filtered);
  const scopeLabel =
    f.airportId && f.airportId.toUpperCase() !== 'ALL' ? f.airportId.toUpperCase() : 'All Syrian Aerodromes';

  res.json({
    period: {
      month: f.month ?? null,
      start_date: minDate,
      end_date: maxDate,
    },
    airport_scope: scopeLabel,
    schedule_coverage: computeScheduleCoverage(filtered),
    observation_coverage: computeObservationCoverage(filtered),
  });
});

airTrafficRouter.get('/api/air-traffic/monthly-summary', (req: Request, res: Response) => {
  res.json(getMonthlySummaryData(readFilters(req)));
});

airTrafficRouter.get('/api/air-traffic/filter-options', (_req: Request, res: Response) => {
  const df = loadPrimaryFlightEvents();
  const activeAirports = [...new Set(df.map((r) => r.airport_id).filter(Boolean))].sort();
  const airports = activeAirports.map((apId) => {
    const reg = SYRIAN_AIRPORTS_REGISTRY[apId];
    return {
      airport_id: apId,
      iata_code: reg?.iata_code || apId,
      icao_code: reg?.icao_code || '',
      name: reg?.name || `Airport ${apId}`,
      name_ar: reg?.name_ar || `مطار ${apId}`,
    };
  });

  const months = [...new Set(df.map((r) => r.flight_date.slice(0, 7)).filter(Boolean))].sort().reverse();
  const airlines = [...new Set(df.map((r) => r.airline_name).filter(Boolean))].sort();

  const destMap = new Map<string, { connected_airport_iata: string; connected_airport_name: string; connected_city: string }>();
  for (const r of df) {
    const iata = r.connected_airport_iata;
    if (iata && !destMap.has(iata)) {
      destMap.set(iata, {
        connected_airport_iata: iata,
        connected_airport_name: r.connected_airport_name || '',
        connected_city: r.connected_city || '',
      });
    }
  }
  const destinations = [...destMap.values()].sort((a, b) =>
    a.connected_airport_iata.localeCompare(b.connected_airport_iata)
  );

  res.json({ airports, months, airlines, destinations });
});

airTrafficRouter.get('/api/air-traffic/export/events', (req: Request, res: Response) => {
  const f = readFilters(req);
  const recordNature = req.query.record_nature ? String(req.query.record_nature).trim() : '';
  const format = String(req.query.format || 'csv').toLowerCase();

  let filtered = applyFilters(loadPrimaryFlightEvents(), f);
  if (recordNature) {
    filtered = filtered.filter((r) => r.record_nature === recordNature);
  }

  const labelMap: Record<string, string> = {
    physical_movement: 'ADS-B Observed Movement — Commercial Tracking Data (October 9–10 sample only)',
    scheduled_service: 'Scheduled Service',
    marketing_codeshare: 'Marketing Codeshare',
    unverified_movement: 'Unverified Movement',
  };

  const exportRows = filtered.map((r) => {
    const movType = r.movement_type || '';
    const connected = r.connected_airport_iata || '';
    const apCode = r.airport_iata || r.airport_id || '';
    const originCode = movType === 'arrival' ? connected : apCode;
    const destCode = movType === 'arrival' ? apCode : connected;
    const statusCap = r.flight_status ? r.flight_status.charAt(0).toUpperCase() + r.flight_status.slice(1) : '';
    const movCap = movType ? movType.charAt(0).toUpperCase() + movType.slice(1) : '';

    return {
      Date: r.flight_date,
      Airport: r.airport_id,
      'Movement Type': movCap,
      'Actual/Scheduled Classification': labelMap[r.record_nature] || r.record_nature,
      'Record Nature Key': r.record_nature,
      Airline: r.airline_name || '',
      Origin: originCode,
      Destination: destCode,
      'Flight Number': r.flight_number || '',
      'Aircraft Type': r.aircraft_model || '',
      'Aircraft Registration': r.aircraft_registration || '',
      'Aircraft ICAO24': r.aircraft_icao24 || '',
      'Evidence / Source': r.source || '',
      'Evidence Classification': r.observed_or_derived || '',
      'Flight Status': statusCap,
    };
  });

  return sendTabularExport(res, exportRows, format, 'syrian_flight_events');
});

airTrafficRouter.get('/api/air-traffic/export/monthly', (req: Request, res: Response) => {
  const format = String(req.query.format || 'csv').toLowerCase();
  const data = getMonthlySummaryData(readFilters(req));

  const exportRows = data.summary.map((r) => ({
    Month: r.month,
    Airport: r.airport_id,
    'Scheduled Flights': r.scheduled_flights,
    'Scheduled Arrivals': r.scheduled_arrivals,
    'Scheduled Departures': r.scheduled_departures,
    'Scheduled Airlines': r.scheduled_airlines,
    'Scheduled Destinations': r.scheduled_destinations,
    'Schedule Coverage Status': r.schedule_coverage_status,
    'ADS-B Observed Movements — Commercial Tracking Data (October 9–10 sample only)':
      r.actual_movements !== null ? r.actual_movements : '',
    'Observed Arrivals': r.observed_arrivals !== null ? r.observed_arrivals : '',
    'Observed Departures': r.observed_departures !== null ? r.observed_departures : '',
    'Observed Airlines': r.observed_airlines,
    'Observed Destinations': r.observed_destinations,
    'Observation Coverage Status': r.observation_coverage_status,
    'Monitoring Outside Observed Dates': r.monitoring_outside_status,
    Passengers: '',
    'Marketing Codeshares': r.marketing_codeshares,
    'Unverified Movements': r.unverified_movements,
  }));

  return sendTabularExport(res, exportRows, format, 'syrian_air_traffic_monthly_summary');
});

airTrafficRouter.get('/api/air-traffic/export/coverage', (req: Request, res: Response) => {
  const f = readFilters(req);
  const format = String(req.query.format || 'csv').toLowerCase();
  const filtered = applyFilters(loadPrimaryFlightEvents(), f);
  const sched = computeScheduleCoverage(filtered);
  const obs = computeObservationCoverage(filtered);
  const scopeLabel =
    f.airportId && f.airportId.toUpperCase() !== 'ALL' ? f.airportId.toUpperCase() : 'All Syrian Aerodromes';

  const exportRows = [
    {
      'Airport Scope': scopeLabel,
      'Schedule Coverage Status': sched.status,
      'Scheduled Flights': sched.scheduled_service_records,
      'Scheduled Arrivals': sched.scheduled_arrivals,
      'Scheduled Departures': sched.scheduled_departures,
      'Dates with Schedule Records': sched.scheduled_dates_count,
      'First Scheduled Date': sched.first_scheduled_date || '',
      'Last Scheduled Date': sched.last_scheduled_date || '',
      'Observation Coverage Status': obs.status,
      'ADS-B Observed Movements (Commercial Tracking Data)': obs.observed_movements !== null ? obs.observed_movements : '',
      'Observed Arrivals': obs.observed_arrivals !== null ? obs.observed_arrivals : '',
      'Observed Departures': obs.observed_departures !== null ? obs.observed_departures : '',
      'Dates with Observed Movement Records': obs.observed_dates_count,
      'First Observed Date': obs.first_observed_date || '',
      'Last Observed Date': obs.last_observed_date || '',
      'Monitoring Coverage Outside Observed Dates': obs.monitoring_outside_status,
    },
  ];

  return sendTabularExport(res, exportRows, format, 'syrian_air_traffic_coverage_summary');
});
