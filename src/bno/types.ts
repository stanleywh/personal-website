export type Day = string;
export type Mode = 'official' | 'conservative';
export interface Airport {
  code: string; name: string; city: string; country: string; countryCode: string;
  latitude: number; longitude: number; timezone: string; uk: boolean;
}
export interface RecordBase { id: string; version: number; created_at?: string; updated_at?: string }
export interface Flight extends RecordBase {
  departure_airport: Airport; arrival_airport: Airport; departure_at: string; arrival_at: string;
  flight_number: string; airline: string; booking_reference: string; notes: string;
}
export interface ManualTrip extends RecordBase {
  departed_uk_date: Day; returned_uk_date: Day | null; countries: string[];
  departure_location: string; return_location: string; notes: string;
}
export interface PlannedTrip extends RecordBase {
  departure_date: Day; return_date: Day; destination: string; departure_airport: Airport | null;
  arrival_airport: Airport | null; notes: string; status: 'planned' | 'converted' | 'fulfilled';
  converted_manual_id: string | null; flight_ids: string[];
}
export interface Settings {
  user_id?: string; version: number; bno_start_date: Day | null; ilr_date: Day | null;
  citizenship_application_date: Day | null; planning_mode: Mode; warning_thresholds: number[];
  coverage_start: Day | null; initial_location: 'uk' | 'outside' | 'unknown';
}
export interface State { flights: Flight[]; manual: ManualTrip[]; planned: PlannedTrip[]; settings: Settings }
export interface Trip {
  id: string; source: 'flight' | 'manual' | 'planned'; departure: Day; returned: Day | null;
  countries: string[]; flights: Flight[]; notes: string; departureLocation?: string; returnLocation?: string;
}
export interface Issue { recordIds: string[]; message: string; blocking: boolean }
export interface Timeline { trips: Trip[]; issues: Issue[]; settings: Settings; today: Day }
export interface Counts { official: number; conservative: number }
export interface WindowTotal extends Counts { start: Day; end: Day }
export interface Rolling {
  points: WindowTotal[]; current: WindowTotal; worst: WindowTotal; conservativeWorst: WindowTotal;
  complete: boolean; issues: Issue[];
}
export const defaultSettings = (): Settings => ({ version: 0, bno_start_date: null, ilr_date: null,
  citizenship_application_date: null, planning_mode: 'official', warning_thresholds: [70, 85, 95],
  coverage_start: null, initial_location: 'unknown' });
export const emptyState = (): State => ({ flights: [], manual: [], planned: [], settings: defaultSettings() });
