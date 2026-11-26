import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveBaseDir(): string {
  const candidates = [
    process.cwd(),
    path.resolve(__dirname, '..', '..'),
    path.resolve(__dirname, '..'),
    __dirname,
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'data', 'damascus_airport.db'))) {
      return dir;
    }
  }
  return path.resolve(__dirname, '..', '..');
}

export const BASE_DIR = resolveBaseDir();
export const DATA_DIR = path.join(BASE_DIR, 'data');
export const RAW_DATA_DIR = path.join(DATA_DIR, 'raw');
export const PROCESSED_DATA_DIR = path.join(DATA_DIR, 'processed');
export const REPORTS_DIR = path.join(BASE_DIR, 'reports');
export const STATIC_DIR = path.join(BASE_DIR, 'static');

export const DB_PATH = path.join(DATA_DIR, 'damascus_airport.db');
export const ANALYTICS_DB_PATH = path.join(DATA_DIR, 'archived_fids_analytics.db');
export const HISTORY_DB_PATH = path.join(DATA_DIR, 'archived_fids_history_staging.db');

export interface AirportSpec {
  airport_id: string;
  iata_code: string | null;
  icao_code: string;
  name: string;
  name_ar: string;
  city: string;
  city_ar: string;
  country: string;
  timezone: string;
  airport_type: string;
  classification: string;
  operational_status: string;
  latitude: number;
  longitude: number;
  elevation_ft: number;
  runways: Array<{ ident: string; length_m: number; length_ft: number; surface: string }>;
  official_portal_url: string | null;
  api_endpoint: string | null;
  metadata_source: string;
}

export const SYRIAN_AIRPORTS_REGISTRY: Record<string, AirportSpec> = {
  DAM: {
    airport_id: 'DAM',
    iata_code: 'DAM',
    icao_code: 'OSDI',
    name: 'Damascus International Airport',
    name_ar: 'مطار دمشق الدولي',
    city: 'Damascus',
    city_ar: 'دمشق',
    country: 'Syria',
    timezone: 'Asia/Damascus',
    airport_type: 'international',
    classification: 'civil',
    operational_status: 'active',
    latitude: 33.4115,
    longitude: 36.5156,
    elevation_ft: 2021,
    runways: [
      { ident: '05R/23L', length_m: 3600, length_ft: 11811, surface: 'Asphalt' },
      { ident: '05L/23R', length_m: 3000, length_ft: 9843, surface: 'Asphalt' },
    ],
    official_portal_url: 'https://damairport.gov.sy/',
    api_endpoint: 'https://damairport.gov.sy/api/flights.php',
    metadata_source: 'Syrian eAIP & OurAirports',
  },
  ALP: {
    airport_id: 'ALP',
    iata_code: 'ALP',
    icao_code: 'OSAP',
    name: 'Aleppo International Airport',
    name_ar: 'مطار حلب الدولي',
    city: 'Aleppo',
    city_ar: 'حلب',
    country: 'Syria',
    timezone: 'Asia/Damascus',
    airport_type: 'international',
    classification: 'civil',
    operational_status: 'active',
    latitude: 36.1806,
    longitude: 37.2242,
    elevation_ft: 1276,
    runways: [{ ident: '09/27', length_m: 3110, length_ft: 10203, surface: 'Asphalt' }],
    official_portal_url: 'https://alpairport.gov.sy/',
    api_endpoint: 'https://alpairport.gov.sy/api/flights.php',
    metadata_source: 'Syrian eAIP & OurAirports',
  },
  LTK: {
    airport_id: 'LTK',
    iata_code: 'LTK',
    icao_code: 'OSLK',
    name: 'Latakia International Airport (Bassel Al-Assad)',
    name_ar: 'مطار اللاذقية الدولي (باسل الأسد)',
    city: 'Latakia',
    city_ar: 'اللاذقية',
    country: 'Syria',
    timezone: 'Asia/Damascus',
    airport_type: 'international',
    classification: 'joint_civil_military',
    operational_status: 'active',
    latitude: 35.4008,
    longitude: 35.9486,
    elevation_ft: 174,
    runways: [
      { ident: '17L/35R', length_m: 2797, length_ft: 9176, surface: 'Asphalt' },
      { ident: '17R/35L', length_m: 2797, length_ft: 9176, surface: 'Asphalt' },
    ],
    official_portal_url: 'https://gaca.gov.sy/aerodromes',
    api_endpoint: null,
    metadata_source: 'Syrian eAIP & OurAirports',
  },
  DEZ: {
    airport_id: 'DEZ',
    iata_code: 'DEZ',
    icao_code: 'OSDZ',
    name: 'Deir ez-Zor Airport',
    name_ar: 'مطار دير الزور',
    city: 'Deir ez-Zor',
    city_ar: 'دير الزور',
    country: 'Syria',
    timezone: 'Asia/Damascus',
    airport_type: 'domestic',
    classification: 'civil',
    operational_status: 'active',
    latitude: 35.2858,
    longitude: 40.1756,
    elevation_ft: 700,
    runways: [{ ident: '10/28', length_m: 3000, length_ft: 9843, surface: 'Asphalt' }],
    official_portal_url: 'https://deirezzorairport.gov.sy/',
    api_endpoint: 'https://deirezzorairport.gov.sy/api/flights.php',
    metadata_source: 'Syrian eAIP & OurAirports',
  },
  KAC: {
    airport_id: 'KAC',
    iata_code: 'KAC',
    icao_code: 'OSKL',
    name: 'Qamishli Airport',
    name_ar: 'مطار القامشلي',
    city: 'Qamishli',
    city_ar: 'القامشلي',
    country: 'Syria',
    timezone: 'Asia/Damascus',
    airport_type: 'domestic',
    classification: 'civil',
    operational_status: 'active',
    latitude: 37.0228,
    longitude: 41.1969,
    elevation_ft: 1480,
    runways: [{ ident: '03/21', length_m: 3615, length_ft: 11860, surface: 'Asphalt' }],
    official_portal_url: 'https://qamishliairport.gov.sy/',
    api_endpoint: 'https://qamishliairport.gov.sy/api/flights.php',
    metadata_source: 'Syrian eAIP & OurAirports',
  },
  PMS: {
    airport_id: 'PMS',
    iata_code: 'PMS',
    icao_code: 'OSPM',
    name: 'Palmyra Airport',
    name_ar: 'مطار تدمر',
    city: 'Palmyra',
    city_ar: 'تدمر',
    country: 'Syria',
    timezone: 'Asia/Damascus',
    airport_type: 'domestic',
    classification: 'civil_restricted',
    operational_status: 'limited',
    latitude: 34.5572,
    longitude: 38.3172,
    elevation_ft: 1322,
    runways: [{ ident: '08/26', length_m: 2880, length_ft: 9449, surface: 'Asphalt' }],
    official_portal_url: 'https://eaip.gaca.gov.sy/',
    api_endpoint: null,
    metadata_source: 'Syrian eAIP & OurAirports',
  },
  OMDM: {
    airport_id: 'OMDM',
    iata_code: null,
    icao_code: 'OMDM',
    name: 'Damascus Mezzeh Military Airport',
    name_ar: 'مطار المزة العسكري',
    city: 'Damascus Mezzeh',
    city_ar: 'المزة',
    country: 'Syria',
    timezone: 'Asia/Damascus',
    airport_type: 'military',
    classification: 'military',
    operational_status: 'restricted',
    latitude: 33.4775,
    longitude: 36.2233,
    elevation_ft: 2407,
    runways: [{ ident: '06/24', length_m: 2980, length_ft: 9777, surface: 'Asphalt' }],
    official_portal_url: null,
    api_endpoint: null,
    metadata_source: 'Aeronautical Charts',
  },
};

export interface ExportMeta {
  dataset_name: string;
  geographic_scope: string;
  scope: string;
  dataset_category: string;
  category: string;
  evidence_level: string;
  source_provenance: string;
  provenance: string;
  source_observation_period: string;
  generation_timestamp: string;
  known_limitations: string;
}

export const EXPORT_METADATA: Record<string, ExportMeta> = {
  all_syrian_flight_events: {
    dataset_name: 'All Syrian Aerodromes Flight Events',
    geographic_scope: 'All Syrian Aerodromes (DAM, ALP, LTK, DEZ, KAC)',
    scope: 'All Syrian Aerodromes',
    dataset_category: 'flight_events',
    category: 'flight_events',
    evidence_level: 'multi_tier_commercial_and_timetable',
    source_provenance: 'Official Syrian airport authority portals & Flightradar24 commercial feeds',
    provenance: 'Official Syrian airport authority portals & Flightradar24 commercial feeds',
    source_observation_period: '2026-07-05 to 2026-10-10',
    generation_timestamp: '2026-10-11T17:45:00Z',
    known_limitations:
      'Operational events represent commercial status messages; estimated timestamps are strictly separated into estimated_dep_time and estimated_arr_time; ground runway radar sensor telemetry is pending.',
  },
  damascus_flight_events: {
    dataset_name: 'Damascus International Airport Flight Events',
    geographic_scope: 'Damascus International Airport (DAM / OSDI)',
    scope: 'Damascus International Airport (DAM / OSDI)',
    dataset_category: 'flight_events',
    category: 'flight_events',
    evidence_level: 'multi_tier_commercial_and_timetable',
    source_provenance: 'damairport.gov.sy official flight board & Flightradar24 commercial feeds',
    provenance: 'damairport.gov.sy official flight board & Flightradar24 commercial feeds',
    source_observation_period: '2026-07-05 to 2026-10-10',
    generation_timestamp: '2026-10-11T17:45:00Z',
    known_limitations:
      'Operational events represent commercial status updates with actual timestamps; estimated timestamps are strictly separated into estimated_dep_time and estimated_arr_time; direct runway radar telemetry is pending.',
  },
  daily_airport_movements: {
    dataset_name: 'Daily Aerodrome Movements Rollup',
    geographic_scope: 'All Syrian Aerodromes (DAM, ALP, DEZ, LTK, KAC)',
    scope: 'All Syrian Aerodromes',
    dataset_category: 'daily_aggregates',
    category: 'daily_aggregates',
    evidence_level: 'operational_aggregates',
    source_provenance: 'Layer A operational database daily rollup',
    provenance: 'Layer A operational database daily rollup',
    source_observation_period: '2026-07-05 to 2026-10-10',
    generation_timestamp: '2026-10-11T17:45:00Z',
    known_limitations: 'Aggregates commercial flight events and scheduled timetable services per airport.',
  },
  damascus_daily_movements: {
    dataset_name: 'Damascus Daily Airport Movements',
    geographic_scope: 'Damascus International Airport (DAM / OSDI)',
    scope: 'Damascus International Airport (DAM / OSDI)',
    dataset_category: 'daily_aggregates',
    category: 'daily_aggregates',
    evidence_level: 'operational_aggregates',
    source_provenance: 'Layer A operational database Damascus daily rollup',
    provenance: 'Layer A operational database Damascus daily rollup',
    source_observation_period: '2026-07-05 to 2026-10-10',
    generation_timestamp: '2026-10-11T17:45:00Z',
    known_limitations: 'Reflects normalized commercial operations and timetable listings for Damascus only.',
  },
  historical_daily_movements_2024: {
    dataset_name: 'Syria Economic Monitor 2024 Commercial Gateways Aggregate',
    geographic_scope: 'DAM_ALP_LTK (Three-airport regional aggregate: Damascus, Aleppo, Latakia combined)',
    scope: 'DAM_ALP_LTK (Three-airport regional aggregate: Damascus, Aleppo, Latakia combined)',
    dataset_category: 'regional_aggregate',
    category: 'regional_aggregate',
    evidence_level: 'macro_commercial_gateway_series',
    source_provenance: 'Syria Economic Monitor (World Bank / Data Partnership)',
    provenance: 'Syria Economic Monitor (World Bank / Data Partnership)',
    source_observation_period: '2024-01-01 to 2024-10-15',
    generation_timestamp: '2026-10-11T17:45:00Z',
    known_limitations:
      'Three-airport aggregate. Zero DAM-specific disaggregation available. Must not be counted as DAM-only movements.',
  },
  syrian_airports_registry: {
    dataset_name: 'Syrian Aerodromes Authoritative Registry',
    geographic_scope: '7 Syrian Aerodromes',
    scope: '7 Syrian Aerodromes',
    dataset_category: 'infrastructure_reference',
    category: 'infrastructure_reference',
    evidence_level: 'authoritative_aeronautical_specifications',
    source_provenance: 'Syrian Civil Aviation Authority eAIP & OurAirports',
    provenance: 'Syrian Civil Aviation Authority eAIP & OurAirports',
    source_observation_period: '2026-10-11',
    generation_timestamp: '2026-10-11T17:45:00Z',
    known_limitations: 'Static aeronautical infrastructure reference specifications.',
  },
  deduplication_audit: {
    dataset_name: 'Cross-Source Flight Deduplication Audit',
    geographic_scope: 'All Syrian Aerodromes',
    scope: 'All Syrian Aerodromes',
    dataset_category: 'audit_log',
    category: 'audit_log',
    evidence_level: 'cross_source_identity_resolution',
    source_provenance: 'Syrian Airport Data Engine Deduplication Ledger',
    provenance: 'Syrian Airport Data Engine Deduplication Ledger',
    source_observation_period: '2026-07-05 to 2026-10-10',
    generation_timestamp: '2026-10-11T17:45:00Z',
    known_limitations: 'Audit log of multi-provider comparisons and marketing codeshare matching.',
  },
  historical_coverage_matrix_2024_2026: {
    dataset_name: 'Historical Coverage Matrix (2024-2026)',
    geographic_scope: 'All Syrian Aerodromes (DAM, ALP, LTK, DEZ, KAC)',
    scope: 'All Syrian Aerodromes',
    dataset_category: 'coverage_audit',
    category: 'coverage_audit',
    evidence_level: 'empirical_coverage_classification',
    source_provenance: 'Syrian Airport Data Engine Coverage Matrix',
    provenance: 'Syrian Airport Data Engine Coverage Matrix',
    source_observation_period: '2024-01-01 to 2026-10-11',
    generation_timestamp: '2026-10-11T17:45:00Z',
    known_limitations: 'Explicitly separates observed coverage, schedule-only coverage, and unverified data gaps.',
  },
  v2_18_damascus_coverage: {
    dataset_name: 'Baseline Damascus Historical Coverage (V2.18)',
    geographic_scope: 'Damascus International Airport & Regional Aggregates',
    scope: 'Damascus & Regional Aggregates',
    dataset_category: 'coverage_audit',
    category: 'coverage_audit',
    evidence_level: 'baseline_monthly_coverage',
    source_provenance: 'V2.18 Historical Coverage Audit',
    provenance: 'V2.18 Historical Coverage Audit',
    source_observation_period: '2024-01 to 2026-10',
    generation_timestamp: '2026-10-11T17:45:00Z',
    known_limitations: 'Superseded by V2.18.1 scope correction audit.',
  },
  v2_18_1_coverage_correction: {
    dataset_name: 'Damascus Monthly Coverage Correction (V2.18.1)',
    geographic_scope: 'DAM & DAM_ALP_LTK Scope Separation',
    scope: 'DAM & DAM_ALP_LTK',
    dataset_category: 'coverage_audit',
    category: 'coverage_audit',
    evidence_level: 'corrected_monthly_coverage',
    source_provenance: 'V2.18.1 Coverage Scope Correction Audit',
    provenance: 'V2.18.1 Coverage Scope Correction Audit',
    source_observation_period: '2024-01 to 2026-10',
    generation_timestamp: '2026-10-11T17:45:00Z',
    known_limitations: 'Separates multi-airport regional aggregates from single-airport Damascus records.',
  },
  v2_18_1_dataset_scope_audit: {
    dataset_name: 'Dataset Geographic Scope Audit (V2.18.1)',
    geographic_scope: 'Discovered Open Aviation Datasets',
    scope: 'Discovered Open Aviation Datasets',
    dataset_category: 'audit_log',
    category: 'audit_log',
    evidence_level: 'dataset_scope_verification',
    source_provenance: 'V2.18.1 Dataset Scope Audit',
    provenance: 'V2.18.1 Dataset Scope Audit',
    source_observation_period: '2024 to 2026',
    generation_timestamp: '2026-10-11T17:45:00Z',
    known_limitations: 'Evaluates geographic scope and Damascus coverage eligibility across candidate datasets.',
  },
  v2_18_dataset_scoring: {
    dataset_name: 'Candidate Aviation Dataset Scoring Matrix',
    geographic_scope: 'Global & Regional Open Datasets',
    scope: 'Global & Regional Open Datasets',
    dataset_category: 'audit_log',
    category: 'audit_log',
    evidence_level: 'dataset_evaluation_scoring',
    source_provenance: 'V2.18 Dataset Recovery Scoring',
    provenance: 'V2.18 Dataset Recovery Scoring',
    source_observation_period: '2024 to 2026',
    generation_timestamp: '2026-10-11T17:45:00Z',
    known_limitations: 'Quantitative assessment of candidate public aviation data sources.',
  },
  v2_18_dataset_inventory: {
    dataset_name: 'Public Aviation Dataset Discovery Inventory',
    geographic_scope: 'Public Aviation Repositories',
    scope: 'Public Aviation Repositories',
    dataset_category: 'audit_log',
    category: 'audit_log',
    evidence_level: 'candidate_discovery_inventory',
    source_provenance: 'V2.18 Candidate Discovery',
    provenance: 'V2.18 Candidate Discovery',
    source_observation_period: '2024 to 2026',
    generation_timestamp: '2026-10-11T17:45:00Z',
    known_limitations: 'Catalog of publicly identified aviation repositories.',
  },
  v2_19_2_physical_movement_audit: {
    dataset_name: 'Event-Level Operational Movement Provenance Audit',
    geographic_scope: 'All Syrian Aerodromes Physical Movements (131 records)',
    scope: 'All Syrian Aerodromes Physical Movements (131 records)',
    dataset_category: 'audit_log',
    category: 'audit_log',
    evidence_level: 'event_level_provenance_audit',
    source_provenance: 'V2.19.2 Forensic Physical Movement Audit',
    provenance: 'V2.19.2 Forensic Physical Movement Audit',
    source_observation_period: '2026-10-09 to 2026-10-10',
    generation_timestamp: '2026-10-11T17:45:00Z',
    known_limitations: 'Verifies 0 direct runway sensor contacts among 131 commercially reported operational events.',
  },
  v2_20_6_mislabeled_evidence_audit: {
    dataset_name: 'Forensic Mislabeled Evidence Audit (76 Records)',
    geographic_scope: 'DAM & ALP Aerodromes',
    scope: 'DAM & ALP Aerodromes',
    dataset_category: 'audit_log',
    category: 'audit_log',
    evidence_level: 'event_level_provenance_audit',
    source_provenance: 'V2.20.6 Forensic Evidence Taxonomy Audit',
    provenance: 'V2.20.6 Forensic Evidence Taxonomy Audit',
    source_observation_period: '2026-10-09 to 2026-10-10',
    generation_timestamp: '2026-10-11T18:55:00Z',
    known_limitations:
      'Complete inventory of 76 evidence rows derived from estimated timestamps rather than Mode-S telemetry. Immutable ledger preserved.',
  },
};

export const VALID_EXPORT_DATASETS: Record<string, string> = {
  all_syrian_flight_events: 'all_syrian_flight_events',
  damascus_flight_events: 'damascus_flight_events',
  damascus_flights: 'damascus_flight_events',
  flight_events: 'damascus_flight_events',
  daily_airport_movements: 'daily_airport_movements',
  damascus_daily_movements: 'damascus_daily_movements',
  daily_movements: 'damascus_daily_movements',
  historical_2024: 'historical_daily_movements_2024',
  historical_daily_movements_2024: 'historical_daily_movements_2024',
  syrian_airports: 'syrian_airports_registry',
  airports: 'syrian_airports_registry',
  deduplication_audit: 'deduplication_audit',
  historical_coverage_matrix: 'historical_coverage_matrix_2024_2026',
  coverage_matrix: 'historical_coverage_matrix_2024_2026',
  v2_18_damascus_coverage: 'v2_18_damascus_coverage',
  damascus_coverage: 'v2_18_damascus_coverage',
  v2_18_1_coverage_correction: 'v2_18_1_coverage_correction',
  coverage_correction: 'v2_18_1_coverage_correction',
  v2_18_1_dataset_scope_audit: 'v2_18_1_dataset_scope_audit',
  dataset_scope_audit: 'v2_18_1_dataset_scope_audit',
  v2_18_dataset_scoring: 'v2_18_dataset_scoring',
  dataset_scoring: 'v2_18_dataset_scoring',
  v2_18_dataset_inventory: 'v2_18_dataset_inventory',
  dataset_inventory: 'v2_18_dataset_inventory',
  v2_19_2_physical_movement_audit: 'v2_19_2_physical_movement_audit',
  physical_movement_audit: 'v2_19_2_physical_movement_audit',
  v2_20_6_mislabeled_evidence_audit: 'v2_20_6_mislabeled_evidence_audit',
  mislabeled_evidence_audit: 'v2_20_6_mislabeled_evidence_audit',
  evidence_audit: 'v2_20_6_mislabeled_evidence_audit',
};
