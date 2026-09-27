import type { Airport } from './types';
let airportPromise: Promise<Airport[]> | undefined;
export function loadAirports(): Promise<Airport[]> {
  return airportPromise ??= fetch('/bno/airports.json').then(async r => {
    if (!r.ok) throw new Error('Airport search is unavailable. Check your connection and retry.');
    return await r.json() as Airport[];
  }).catch(error => { airportPromise = undefined; throw error; });
}
export function searchAirports(airports: Airport[], query: string): Airport[] {
  const q = query.trim().toLocaleLowerCase(); if (!q) return [];
  const rank = (a: Airport) => a.code.toLowerCase() === q ? 0 : a.code.toLowerCase().startsWith(q) ? 1 : 2;
  return airports.filter(a => `${a.code} ${a.name} ${a.city} ${a.country}`.toLocaleLowerCase().includes(q))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 12);
}
export function airportCombobox(input: HTMLInputElement, list: HTMLElement, onSelect: (airport: Airport | null) => void) {
  let results: Airport[] = [], active = -1, sequence = 0;
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', list.id); input.setAttribute('aria-expanded', 'false'); list.setAttribute('role', 'listbox');
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  const select = (i: number) => { const a = results[i]; if (!a) return; input.value = `${a.code} — ${a.name}`; onSelect(a); close(); };
  input.addEventListener('input', async () => {
    onSelect(null); const token = ++sequence; active = -1;
    try {
      results = searchAirports(await loadAirports(), input.value); if (token !== sequence) return;
      list.replaceChildren(...results.map((a, i) => { const option = document.createElement('div'); option.id = `${list.id}-${i}`; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false'); option.textContent = `${a.code} — ${a.name} · ${a.city}, ${a.country}`;
        option.addEventListener('mousedown', e => e.preventDefault()); option.addEventListener('click', () => select(i)); return option; }));
      if (!results.length) { const empty = document.createElement('p'); empty.textContent = 'No matching airports. Try a city or IATA code.'; list.append(empty); }
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
    } catch (error) { list.textContent = error instanceof Error ? error.message : 'Search failed.'; list.hidden = false; }
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && results.length) { e.preventDefault(); list.hidden = false; input.setAttribute('aria-expanded', 'true'); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      [...list.children].forEach((el, i) => el.setAttribute('aria-selected', String(i === active))); input.setAttribute('aria-activedescendant', `${list.id}-${active}`); list.children[active]?.scrollIntoView?.({ block: 'nearest' }); }
    if (e.key === 'Enter' && !list.hidden && active >= 0) { e.preventDefault(); select(active); }
  });
  input.addEventListener('blur', () => window.setTimeout(close, 150));
}
