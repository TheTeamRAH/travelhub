# Live Data Contracts

## Source Selection Rules

- Rail data uses `NATIONAL_RAIL_TOKEN` when present.
- Without `NATIONAL_RAIL_TOKEN`, rail falls back to scraping.
- Road data uses `GOOGLE_MAPS_API_KEY`.
- Without `GOOGLE_MAPS_API_KEY`, road responses should fail clearly without breaking the rest of the app.

## Primary Runtime Files

- `server.ts` owns API routes, config loading, and source selection.
- `src/lib/rail-api.ts` owns National Rail API requests and response formatting.
- `src/lib/rail-scraper.ts` owns National Rail scraping fallback and engineering works scraping.
- `src/lib/road-api.ts` owns Google Maps Distance Matrix requests and response shaping.
- `src/services/travelService.ts` owns frontend HTTP request shaping.
- `src/App.tsx` owns config fetches, refresh behavior, and mapping backend results into UI state.

## Config Contracts

### `config/rail.yaml`

Expected server response shape:

- `homeStation`
- `operatorCodes`
- `destinations`
- `walkTimeMins`

Important behavior:

- `homeStation.crs` is used as the origin for rail requests.
- Each destination should keep a stable `id`, `name`, and `crs`.
- Destination `name` participates in backend/frontend response matching.
- `operatorCodes` drives engineering works queries.

### `config/roads.yaml`

Expected server response shape:

- `journeys`

Important behavior:

- Each journey should keep a stable `id`.
- `origin` and `destination` are passed through to the road API layer.
- The frontend may derive `mapQuery` if it is missing.

## Endpoint Contracts

### `GET /api/rail/departures`

Response shape:

- `source`: `"api"` or `"scraping"`
- `departures`: object keyed by destination name

Important behavior:

- Frontend code maps results by configured destination name first, then by a looser fallback.
- Changes to grouping keys can silently empty cards in the UI.

### `GET /api/rail/engineering`

Response shape:

- `works`: string array

### `GET /api/config/rail`

Response shape:

- config payload or `_configMissing` or `_error`

### `GET /api/config/roads`

Response shape:

- journeys payload or `_configMissing` or `_error`

### `GET /api/road/travel`

Response shape:

- journey results keyed by journey id
- or `_configRequired`
- or `_error`

## Verification Expectations

- Use Docker-based validation only.
- Do not switch the repo to local `npm`/`node` verification.
- When behavior changes, verify the full path: config load, backend response, frontend mapping, and error handling.
