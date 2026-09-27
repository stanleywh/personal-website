"""Rebuild the vendored airport index; Python standard library only. Network required."""
import csv, io, json, pathlib, urllib.request, hashlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCES = {
 'airports': 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/c263f96aed8f4f7cc2832c4faf5712248e28f3dc/airports.csv',
 'countries': 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/c263f96aed8f4f7cc2832c4faf5712248e28f3dc/countries.csv',
 'timezones': 'https://raw.githubusercontent.com/jpatokal/openflights/7d1a611e070295dba776d6afb86e57d0d1aa1cef/data/airports.dat',
}
raw = {key: urllib.request.urlopen(url).read() for key, url in SOURCES.items()}
zones = {}
for row in csv.reader(io.StringIO(raw['timezones'].decode())):
 if len(row) > 11 and row[4] != '\\N' and '/' in row[11]: zones.setdefault(row[4], set()).add(row[11])
countries = {r['code']: r['name'] for r in csv.DictReader(io.StringIO(raw['countries'].decode()))}
result = []
for row in csv.DictReader(io.StringIO(raw['airports'].decode())):
 code = row['iata_code']
 if len(code) != 3 or row['type'] in ['closed', 'heliport', 'seaplane_base']: continue
 tz = sorted(zones.get(code, []))
 result.append(dict(code=code, name=row['name'], city=row['municipality'], country=countries.get(row['iso_country'], row['iso_country']), countryCode=row['iso_country'], latitude=float(row['latitude_deg']), longitude=float(row['longitude_deg']), timezone=tz[0] if len(tz)==1 else '', uk=row['iso_country']=='GB'))
result.sort(key=lambda r: (r['code'], r['name']))
out = ROOT/'public/bno'; out.mkdir(parents=True, exist_ok=True)
(out/'airports.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'))+'\n')
(out/'sources.json').write_text(json.dumps({k: {'url': SOURCES[k], 'sha256': hashlib.sha256(v).hexdigest()} for k,v in raw.items()}, indent=2)+'\n')
print(f'Generated {len(result)} airport entries; {sum(not r["timezone"] for r in result)} require timezone selection.')
