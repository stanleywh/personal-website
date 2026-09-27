import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BnoAuthorizationError, BnoRepository, cacheKey, clearBnoCache, ConflictError } from '../src/bno/store';
import { emptyState, type ManualTrip } from '../src/bno/types';
import { safeNextPage, accountUrl } from '../src/auth/navigation';
function client(result: { data: unknown; error: { message: string; code?: string } | null; status?: number }) {
 const calls: Array<[string, unknown[]]> = [];
 const query: Record<string, unknown> = {};
 for (const name of ['select','eq','order','insert','update','delete','single','maybeSingle']) query[name] = (...args: unknown[]) => { calls.push([name,args]); return query; };
 query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
 return { calls, value: { from: vi.fn(() => query), rpc: vi.fn(async () => result) } as unknown as SupabaseClient };
}
const manual: ManualTrip = { id:'trip',version:2,departed_uk_date:'2026-01-01',returned_uk_date:'2026-01-03',countries:['Japan'],departure_location:'',return_location:'',notes:'' };
beforeEach(() => { localStorage.clear(); Object.defineProperty(navigator,'onLine',{configurable:true,value:true}); });
describe('BNO persistence', () => {
 it('isolates offline caches and does not treat a missing cache as empty history',async()=>{
  const c=client({data:null,error:null});const state=emptyState();state.manual=[manual];localStorage.setItem(cacheKey('a'),JSON.stringify({state,cachedAt:'2026-01-04T00:00Z'}));Object.defineProperty(navigator,'onLine',{value:false});
  expect((await new BnoRepository(c.value,'a').load()).state.manual).toHaveLength(1);
  await expect(new BnoRepository(c.value,'b').load()).rejects.toThrow('Offline');clearBnoCache('a');expect(localStorage.getItem(cacheKey('a'))).toBeNull();
 });
 it('rejects offline saves without issuing a request',async()=>{const c=client({data:{id:'trip'},error:null});Object.defineProperty(navigator,'onLine',{value:false});await expect(new BnoRepository(c.value,'a').save('manual_trips',manual)).rejects.toThrow('Connect');expect(c.value.from).not.toHaveBeenCalled();});
 it('uses owner and original version in updates; missing row is a conflict',async()=>{
  const c=client({data:null,error:null});await expect(new BnoRepository(c.value,'a').save('manual_trips',manual)).rejects.toBeInstanceOf(ConflictError);
  expect(c.calls).toContainEqual(['eq',['user_id','a']]);expect(c.calls).toContainEqual(['eq',['version',2]]);
 });
 it('does not silently fall back to cache for authorization or schema errors',async()=>{
  localStorage.setItem(cacheKey('a'),JSON.stringify({state:emptyState(),cachedAt:'2026-01-01'}));
  await expect(new BnoRepository(client({data:null,error:{message:'denied',code:'42501'},status:403}).value,'a').load()).rejects.toBeInstanceOf(BnoAuthorizationError);
  await expect(new BnoRepository(client({data:null,error:{message:'table does not exist',code:'42P01'}}).value,'a').load()).rejects.toThrow('does not exist');
 });
 it('blocks stale work after an account change',async()=>{const c=client({data:[],error:null});const r=new BnoRepository(c.value,'a');const pending=r.load();r.dispose();await expect(pending).rejects.toBeInstanceOf(BnoAuthorizationError);expect(localStorage.getItem(cacheKey('a'))).toBeNull();});
 it('keeps failed updates as errors without writing an offline queue',async()=>{const c=client({data:null,error:{message:'Network failed'}});await expect(new BnoRepository(c.value,'a').save('manual_trips',manual)).rejects.toThrow('Network failed');expect(localStorage.length).toBe(0);});
 it('uses atomic RPCs for conversion and multi-flight deletion',async()=>{const c=client({data:'actual-id',error:null});const r=new BnoRepository(c.value,'a');await r.deleteFlights([]);expect(c.value.rpc).toHaveBeenCalledWith('bno_delete_flights',{records:[]});});
 it('allows bno auth return destinations without allowing external redirects',()=>{expect(safeNextPage('bno')).toBe('bno');expect(accountUrl('callback','bno').searchParams.get('next')).toBe('bno');expect(safeNextPage('https://evil.example/bno')).toBe('home');});
});
