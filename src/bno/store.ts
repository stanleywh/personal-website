import type { SupabaseClient } from '@supabase/supabase-js';
import { isAuthorizationFailure } from '../auth/client';
import { emptyState, type Flight, type ManualTrip, type PlannedTrip, type Settings, type State } from './types';
export type Table = 'travel_flights' | 'manual_trips' | 'planned_trips';
export type TravelRecord = Flight | ManualTrip | PlannedTrip;
export const cacheKey = (userId: string) => `bno:user:${userId}:cache:v1`;
export function clearBnoCache(userId: string): void { try { localStorage.removeItem(cacheKey(userId)); } catch { /* Storage may be disabled. */ } }
export class BnoAuthorizationError extends Error {}
export class ConflictError extends Error { constructor() { super('This record changed on another device. Refresh and review it before saving again. Your form has been kept.'); } }
export class BnoRepository {
  private generation = 0;
  private active = true;
  constructor(private client: SupabaseClient, readonly userId: string) {}
  dispose(): void { this.active = false; this.generation++; }
  private check(): void { if (!this.active) throw new BnoAuthorizationError('Your session changed. Sign in again.'); }
  private failure(result: { error: { message: string; code?: string } | null; status?: number }): void {
    this.check();
    if (result.error) {
      if (isAuthorizationFailure(result.error, result.status)) throw new BnoAuthorizationError('Your session is no longer authorized.');
      throw new Error(result.error.message);
    }
  }
  private online(): void { this.check(); if (!navigator.onLine) throw new Error('Connect to the internet to save. Your form is still available.'); }
  async load(): Promise<{ state: State; cachedAt: string; offline: boolean }> {
    this.check(); const generation = ++this.generation;
    try {
      if (!navigator.onLine) throw new Error('Offline');
      const results = await Promise.all([
        this.client.from('travel_flights').select('*').eq('user_id', this.userId).order('departure_at'),
        this.client.from('manual_trips').select('*').eq('user_id', this.userId).order('departed_uk_date'),
        this.client.from('planned_trips').select('*').eq('user_id', this.userId).order('departure_date'),
        this.client.from('residency_settings').select('*').eq('user_id', this.userId).maybeSingle(),
      ]);
      results.forEach(r => this.failure(r)); this.check();
      if (generation !== this.generation) throw new BnoAuthorizationError('Superseded load.');
      const state: State = { flights: results[0].data as unknown as Flight[], manual: results[1].data as unknown as ManualTrip[], planned: results[2].data as unknown as PlannedTrip[], settings: results[3].data as unknown as Settings ?? emptyState().settings };
      const cachedAt = new Date().toISOString();
      try { localStorage.setItem(cacheKey(this.userId), JSON.stringify({ state, cachedAt })); } catch { /* Cloud remains authoritative. */ }
      return { state, cachedAt, offline: false };
    } catch (error) {
      this.check(); if (error instanceof BnoAuthorizationError) throw error;
      // Only network failures may fall back. Schema and RLS failures must remain visible.
      const networkFailure = !navigator.onLine || (error instanceof Error && /fetch|network|load failed/i.test(error.message));
      if (networkFailure) {
        try { const cached = JSON.parse(localStorage.getItem(cacheKey(this.userId)) ?? 'null');
          if (cached?.state && Array.isArray(cached.state.flights) && Array.isArray(cached.state.manual) && Array.isArray(cached.state.planned) && cached.state.settings && typeof cached.cachedAt === 'string') return { ...cached, offline: true };
        } catch { /* Invalid cache is not a new empty account. */ }
      }
      throw error;
    }
  }
  async save(table: Table, record: TravelRecord): Promise<void> {
    this.online(); const { version, created_at: _created, updated_at: _updated, ...fields } = record;
    const payload: Record<string, unknown> = { ...fields, user_id: this.userId };
    const result = version === 0
      ? await this.client.from(table).insert(payload).select('id').single()
      : await this.client.from(table).update(payload).eq('id', record.id).eq('user_id', this.userId).eq('version', version).select('id').maybeSingle();
    this.failure(result); if (!result.data) throw new ConflictError();
  }
  async saveSettings(settings: Settings): Promise<void> {
    this.online(); const { version, ...fields } = settings;
    const result = version === 0
      ? await this.client.from('residency_settings').insert({ ...fields, user_id: this.userId }).select('user_id').single()
      : await this.client.from('residency_settings').update({ ...fields, user_id: this.userId }).eq('user_id', this.userId).eq('version', version).select('user_id').maybeSingle();
    this.failure(result); if (!result.data) throw new ConflictError();
  }
  async remove(table: Table, record: TravelRecord): Promise<void> {
    this.online(); const result = await this.client.from(table).delete().eq('id', record.id).eq('user_id', this.userId).eq('version', record.version).select('id').maybeSingle();
    this.failure(result); if (!result.data) throw new ConflictError();
  }
  async deleteFlights(flights: Flight[]): Promise<void> {
    this.online(); const result = await this.client.rpc('bno_delete_flights', { records: flights.map(f => ({ id: f.id, version: f.version })) }); this.failure(result);
  }
  async convertPlan(plan: PlannedTrip): Promise<void> {
    this.online(); const result = await this.client.rpc('bno_convert_plan', { plan_id: plan.id, expected_version: plan.version }); this.failure(result);
  }
}
