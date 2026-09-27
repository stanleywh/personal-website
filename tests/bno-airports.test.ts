import { describe, expect, it, vi } from 'vitest';
import { airportCombobox, searchAirports } from '../src/bno/airports';
import type { Airport } from '../src/bno/types';
const airport = (code:string,name:string,city:string):Airport=>({code,name,city,country:'United Kingdom',countryCode:'GB',latitude:0,longitude:0,timezone:'Europe/London',uk:true});
const data=[airport('LHR','Heathrow','London'),airport('LGW','Gatwick','London'),airport('ABC','LHR Memorial','Elsewhere')];
describe('airport autocomplete',()=>{
 it('prioritizes exact IATA before name matches and searches cities/countries',()=>{expect(searchAirports(data,'lhr').map(a=>a.code)).toEqual(['LHR','ABC']);expect(searchAirports(data,'London')).toHaveLength(2);expect(searchAirports(data,'United Kingdom')).toHaveLength(3);});
 it('supports keyboard selection and clears stale selections on typing',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>data})));
  document.body.innerHTML='<input id="airport"><div id="results" hidden></div>';
  const input=document.querySelector('input')!,list=document.querySelector('div')!,onSelect=vi.fn();airportCombobox(input,list,onSelect);
  input.value='LHR';input.dispatchEvent(new Event('input'));await vi.waitFor(()=>expect(list.children).toHaveLength(2));
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));expect(input.getAttribute('aria-activedescendant')).toBe('results-0');
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));expect(onSelect).toHaveBeenLastCalledWith(data[0]);expect(list.hidden).toBe(true);
  input.value='other';input.dispatchEvent(new Event('input'));expect(onSelect).toHaveBeenLastCalledWith(null);vi.unstubAllGlobals();
 });
});
