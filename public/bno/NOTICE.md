# Airport data

Airport/country metadata: OurAirports, https://ourairports.com/data/ — Public Domain.
IANA timezone enrichment: OpenFlights, https://openflights.org/data.php — Open Database License 1.0 (https://opendatacommons.org/licenses/odbl/1-0/); individual contents under Database Contents License 1.0 (https://opendatacommons.org/licenses/dbcl/1-0/).

The combined airports.json database is made available under ODbL 1.0. This applies to the airport database, not users' private travel records. Sources, pinned commits and checksums are in sources.json. Reproduce with `python3 scripts/bno/generate-airports.py`. Source data can be incomplete or outdated; missing or ambiguous timezones require explicit selection. Airport snapshots stored with flights preserve past entries when this index is updated.
