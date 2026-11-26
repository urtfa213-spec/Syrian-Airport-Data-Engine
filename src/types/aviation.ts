export type WorkspaceView = 'explorer' | 'overview' | 'flights' | 'monitor' | 'fids' | 'coverage' | 'exports';

export interface RunwaySpec {
  ident: string;
  length_m: number;
  length_ft: number;
  surface: string;
}

export interface AirportRecord {
  airport_id: string;
  iata_code: string | null;
  icao_code: string;
  name: string;
  name_ar: string;
  city: string;
  city_ar: string;
  airport_type: string;
  classification: string;
  operational_status: string;
  elevation_ft: number | null;
  latitude: number | null;
  longitude: number | null;
  runways?: RunwaySpec[];
}

export interface MovementStatsResponse {
  engine_version: string;
  iata: string;
  airport_events_breakdown: Array<{
    airport_id: string;
    cnt: number;
    min_date: string;
    max_date: string;
    dates_count: number;
  }>;
  total_verified_flights: number;
  flight_statuses: Record<string, number>;
  distinct_reported_aircraft_registrations: number;
  total_unique_airlines: number;
  top_connected_airports: Array<{ connected_airport_iata: string; cnt: number }>;
  historical_2024_rows: number;
  historical_2024_scope: string;
}

export interface ComparisonDay {
  flight_date: string;
  airport_id: string;
  total_records: number;
  scheduled_record_count: number;
  commercial_operational_event_count: number;
  codeshare_record_count: number;
  matched_codeshare_record_count: number;
  unmatched_codeshare_record_count: number;
  unverified_record_count: number;
  unique_operating_flight_count: number;
  resolved_commercial_movement_count: number;
  ambiguous_movement_identity_count: number;
}

export interface FlightEvent {
  event_id: string;
  airport_id: string;
  source: string;
  source_record_id: string | null;
  movement_type: 'arrival' | 'departure' | string;
  connected_airport_iata: string | null;
  connected_airport_name: string | null;
  connected_city: string | null;
  route_type: string | null;
  airline_name: string | null;
  airline_iata: string | null;
  airline_icao: string | null;
  flight_number: string | null;
  operating_flight_number: string | null;
  operating_carrier: string | null;
  flight_date: string;
  scheduled_flight_date: string | null;
  actual_movement_date: string | null;
  estimated_movement_date: string | null;
  flight_status: string | null;
  record_nature: string;
  evidence_level: string;
  event_classification: string;
  scheduled_dep_time: string | null;
  estimated_dep_time: string | null;
  actual_dep_time: string | null;
  scheduled_arr_time: string | null;
  estimated_arr_time: string | null;
  actual_arr_time: string | null;
  raw_scheduled_dep_time: string | null;
  raw_estimated_dep_time: string | null;
  raw_actual_dep_time: string | null;
  raw_scheduled_arr_time: string | null;
  raw_estimated_arr_time: string | null;
  raw_actual_arr_time: string | null;
  aircraft_model: string | null;
  aircraft_registration: string | null;
  aircraft_icao24: string | null;
  provider_count: number;
  independent_observation_count: number;
  source_observed_at: string | null;
  source_observed_at_raw: string | null;
  ingested_at: string | null;
  source_snapshot: string | null;
  quality_flags: string | null;
}

export interface EvidenceItem {
  evidence_id: string;
  event_id: string;
  source_name: string;
  evidence_type: string;
  original_evidence_type?: string;
  observed_value: string | null;
  raw_timestamp: string | null;
  observed_at: string | null;
  ledger_status: string;
  is_estimated?: boolean;
  correction_status?: string;
  original_raw_source_field?: string;
  retraction_reason?: string | null;
  retracted_at?: string | null;
  retracted_by?: string | null;
  correction_history?: Array<{
    action: string;
    original_classification: string;
    corrected_classification: string;
    mechanism: string;
    reason: string;
  }>;
}

export interface AirTrafficKpisResponse {
  period: {
    month: string | null;
    start_date: string | null;
    end_date: string | null;
    label: string;
  };
  airport_scope: string;
  kpis: {
    scheduled_flights: number;
    scheduled_arrivals: number;
    scheduled_departures: number;
    actual_movements: number | null;
    actual_movements_label: string;
    actual_movements_status: string;
    active_airlines: number;
    active_destinations: number;
    airports_covered: number;
    registered_airports_total: number;
    marketing_codeshares: number;
    unverified_movements: number;
    passengers: number | null;
    passengers_note: string;
  };
  schedule_coverage: {
    status: string;
    status_ar?: string;
    scheduled_service_records: number;
    scheduled_arrivals: number;
    scheduled_departures: number;
    scheduled_dates_count: number;
    first_scheduled_date: string | null;
    last_scheduled_date: string | null;
    active_scheduled_airlines: number;
    active_scheduled_destinations: number;
  };
  observation_coverage: {
    status: string;
    status_ar?: string;
    observed_movements: number | null;
    observed_arrivals: number | null;
    observed_departures: number | null;
    observed_dates_count: number;
    observed_dates: string[];
    first_observed_date: string | null;
    last_observed_date: string | null;
    active_observed_airlines: number;
    active_observed_destinations: number;
    monitoring_outside_status: string;
    monitoring_outside_status_ar?: string;
    methodology_note: string;
  };
  trends?: {
    previous_month: string | null;
    scheduled_daily_avg: number;
    previous_scheduled_daily_avg: number | null;
    scheduled_daily_avg_pct: number | null;
    observed_movements_month_pct: number | null;
    observed_sample_day_pct: number | null;
    observed_sample_prev_date: string | null;
    observed_sample_curr_date: string | null;
    active_airlines_pct: number | null;
    active_destinations_pct: number | null;
    non_verified_share_pp: number | null;
  };
}

export interface MonthlySummaryRow {
  month: string;
  airport_id: string;
  scheduled_flights: number;
  scheduled_arrivals: number;
  scheduled_departures: number;
  scheduled_airlines: number;
  scheduled_destinations: number;
  schedule_coverage_status: string;
  actual_movements: number | null;
  actual_movements_note: string;
  observed_arrivals: number | null;
  observed_departures: number | null;
  observed_airlines: number;
  observed_destinations: number;
  observation_coverage_status: string;
  monitoring_outside_status: string;
  passengers: number | null;
  marketing_codeshares: number;
  unverified_movements: number;
  total_records: number;
}

export interface CorridorOrigin {
  airport_id: string;
  iata_code: string;
  icao_code: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  operational_status: string;
  total_events: number;
  observed_events: number;
  scheduled_events: number;
  destinations_count: number;
}

export interface FlightCorridor {
  id: string;
  origin_iata: string;
  origin_city: string;
  origin_lat: number;
  origin_lon: number;
  destination_iata: string;
  destination_name: string;
  destination_city: string;
  destination_lat: number;
  destination_lon: number;
  country_name: string;
  country_iso_num: string;
  is_domestic: boolean;
  total_events: number;
  observed_events: number;
  scheduled_events: number;
  codeshare_events: number;
  unverified_events: number;
  arrivals: number;
  departures: number;
  fids_slots: number;
  airlines_count: number;
  airlines: string[];
  last_flight_date: string | null;
}

export interface CountryChoroplethStat {
  country_iso_num: string;
  country_name: string;
  total_events: number;
  observed_events: number;
  scheduled_events: number;
  fids_slots: number;
  corridor_count: number;
  airports: string[];
}

export interface CorridorsResponse {
  airport_id: string;
  filters: {
    record_nature: string;
    movement_type: string;
  };
  origins: CorridorOrigin[];
  corridors: FlightCorridor[];
  country_totals: CountryChoroplethStat[];
  summary: {
    active_corridors: number;
    countries_reached: number;
    total_ledger_events: number;
    total_observed_events: number;
    total_fids_slots: number;
  };
}

export interface CoverageMonthlyCell {
  airport_id: string;
  year_month: string;
  total_days: number;
  non_gap_days: number;
  verified_days: number;
  schedule_days: number;
  future_days: number;
  checked_empty_days: number;
  verified_records: number;
  commercial_records: number;
  fids_records: number;
  fids_days: number;
  sem_2024_macro_ops: number;
  direct_density_records: number;
}

export interface CoverageDailyCell {
  airport_id: string;
  flight_date: string;
  coverage_classification: string;
  verified_movements_count: number;
  commercial_records_count: number;
  fids_records_count: number;
  sources_checked: string;
  evidence_basis: string;
  notes: string;
}

export interface CoverageHeatmapResponse {
  airports: string[];
  months: string[];
  selected_month: string;
  dates: string[];
  monthly_cells: CoverageMonthlyCell[];
  daily_cells: CoverageDailyCell[];
}


