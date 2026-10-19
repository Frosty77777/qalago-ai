// Builds src/mocks/demoPois.json from real OpenStreetMap data (Overpass API).
// The fixture is only used when VITE_USE_MOCKS=true and is always labelled "Demo data" in the UI.
//
// Usage:
//   node scripts/fetch-demo-fixture.mjs                 # query Overpass
//   node scripts/fetch-demo-fixture.mjs raw.json        # normalize an existing Overpass response
import { readFile, writeFile } from 'node:fs/promises'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const AREAS = [
  { lat: 51.09279, lon: 71.42148, radius: 1500 }, // EXPO exhibition centre, way/454853233
  { lat: 51.12829, lon: 71.43045, radius: 1200 }, // Bayterek monument, way/230401645
]

function buildQuery() {
  const parts = AREAS.flatMap(({ lat, lon, radius }) => {
    const around = `(around:${radius},${lat},${lon})`
    return [
      `nwr["name"]["amenity"~"^(cafe|library)$"]${around};`,
      `nwr["name"]["leisure"~"^(park|playground|garden)$"]${around};`,
      `nwr["name"]["tourism"~"^(museum|attraction|artwork|viewpoint)$"]${around};`,
      `nwr["name"]["historic"]${around};`,
    ]
  })
  return `[out:json][timeout:90];(${parts.join('')});out center tags;`
}

function categoryOf(tags) {
  for (const key of ['tourism', 'historic', 'leisure', 'amenity']) {
    if (tags[key]) return key === 'historic' ? 'monument' : tags[key]
  }
  return 'place'
}

function normalize(raw, collectedAt) {
  const seen = new Set()
  const pois = []
  for (const el of raw.elements ?? []) {
    const tags = el.tags ?? {}
    const lat = el.lat ?? el.center?.lat
    const lon = el.lon ?? el.center?.lon
    const id = `${el.type}/${el.id}`
    if (!tags.name || lat == null || lon == null || seen.has(id)) continue
    seen.add(id)
    pois.push({
      id,
      name: tags.name,
      category: categoryOf(tags),
      lat,
      lon,
      opening_hours: tags.opening_hours ?? null,
      tags,
      source: 'OpenStreetMap',
      source_url: `https://www.openstreetmap.org/${id}`,
      collected_at: collectedAt,
    })
  }
  return pois
}

async function main() {
  const inputPath = process.argv[2]
  let raw
  if (inputPath) {
    raw = JSON.parse(await readFile(inputPath, 'utf8'))
  } else {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'User-Agent': 'QalaGoAI-hackathon-dev/0.1', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: buildQuery() }),
    })
    if (!res.ok) throw new Error(`Overpass responded ${res.status}`)
    raw = await res.json()
  }
  const collectedAt = raw.osm3s?.timestamp_osm_base ?? new Date().toISOString()
  const pois = normalize(raw, collectedAt)
  const out = new URL('../src/mocks/demoPois.json', import.meta.url)
  await writeFile(out, JSON.stringify({ collected_at: collectedAt, attribution: '© OpenStreetMap contributors, ODbL', pois }, null, 2) + '\n')
  console.log(`Wrote ${pois.length} POIs (OSM base ${collectedAt})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
