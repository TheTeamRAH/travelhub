# 🚉 Personal Travel Hub

A personal, self-hosted real-time travel dashboard tailored for common travel. It displays live UK rail departures for your chosen home station to stations frequently visited (and planned engineering works).
It also displays road travel times with live traffic, and lets you share routes directly to your phone via QR code.

Rail and road journeys are configured in `config/rail.yaml` and `config/roads.yaml` respectively. These files are gitignored and should be populated with your personal travel information (examples are provided).

Live road traffic is provided by Google Maps Routes API. You will need to obtain an API key from Google Cloud Console and set it as an environment variable `GOOGLE_MAPS_API_KEY`. The key should have `Routes API` enabled; `Maps Embed API` is still useful for the embedded route panels. Travelhub also supplements route results with official National Highways incident feeds so road cards can flag collisions, closures, obstructions, and similar hazards on the monitored roads ahead. If `Routes API` access is denied for the configured key, the app falls back to Google Distance Matrix for travel times and traffic status, but incident matching is unavailable on that fallback path.

Live rail departures are provided by National Rail when a token is provided via the environment variable `NATIONAL_RAIL_TOKEN`, however this isn't required as the the app will fall back to web scraping. Engineering works can additionally use the National Rail Knowledgebase Incidents feed when `NATIONAL_RAIL_KB_TOKEN` is configured; otherwise they fall back to scraping National Rail’s public disruption pages.

**Current Status:** This project has been built with Antigravity and is a work inprogress

## Planned feature specifications

- [Impacted journey maps](docs/features/2026-08-27-14-55-impacted-journey-maps.md) — specification for route-specific traffic and incident visualisation, including a manual Slack-ready image output. Implementation has not started; this specification is submitted for review first.

![Frontend Preview](static/example_frontend.png)


---

## ✨ Features

| Feature | Detail |
|---|---|
| 🚂 **Live Rail Departures** | Real-time train times from the National Rail [Rail Data Marketplace](https://raildata.org.uk) JSON API, grouped per destination. Shows best-arriving and next train, ETA, platform, status, and calling points. Falls back to web scraping if no API token is set |
| 🚗 **Live Road Travel** | Google Maps Routes API — live travel time, traffic-aware route summaries, and route-matched incidents per journey |
| 🛠️ **Engineering Works** | Planned disruptions only when they match one of your configured rail journeys, including likely intermediate stations inferred from live departures. Uses the National Rail Knowledgebase Incidents feed when available, otherwise falls back to National Rail website scraping |
| 📱 **Send to Device** | QR code modal + copy-link button to easily open a route on your phone |
| 🗺️ **Embedded Maps** | Google Maps embedded per route with single-click full-screen expansion |
| ⏱️ **Auto-refresh** | Rail refreshes every 5 minutes. Road refreshes every 25 minutes (6am–midnight only, to stay within API free tier) |
| 🕒 **Per-source timestamps** | Footer tracks and displays the last successful update time separately for rail and road data |

---

## 📁 Project Structure

```
travel-hub/
├── .ai/
│   └── skills/
│       └── travelhub-live-data-agent/  # Project skill for live data maintenance workflows
│           ├── SKILL.md                # Skill entrypoint with workflow, scope, and guardrails
│           ├── agents/
│           │   └── openai.yaml         # OpenAI/Codex registration metadata for the skill
│           └── references/
│               └── live-data-contracts.md # Supporting runtime contracts for live rail/road behavior
│
├── src/
│   ├── App.tsx                  # Main React application — all UI, state, and data logic
│   ├── main.tsx                 # React entry point — mounts App into the DOM
│   ├── index.css                # Global styles and Tailwind CSS configuration
│   ├── lib/                     # Core logic modules (Rail API, Road API, Scrapers)
│   │   ├── rail-api.ts          # National Rail Data Marketplace client
│   │   ├── rail-engineering-api.ts # Knowledgebase Incidents client for engineering works
│   │   ├── rail-engineering.ts  # Shared engineering work types and journey impact matcher
│   │   ├── rail-scraper.ts      # Web scraping fallback for departures and engineering works
│   │   ├── road-api.ts          # Google Maps Routes client
│   │   └── road-incidents.ts    # National Highways incident feed matcher
│   └── services/
│       └── travelService.ts     # Client-side API helpers (calls to /api/road and /api/rail endpoints)
│
├── server.ts                    # Express backend server — API routes and data fetching
├── vite.config.ts               # Vite bundler config — React plugin, Tailwind, path aliases
├── tsconfig.json                # TypeScript compiler configuration
├── index.html                   # HTML entry point loaded by Vite
├── package.json                 # NPM dependencies and scripts
│
├── Dockerfile                   # Multi-stage Docker build (build → runtime)
├── docker-compose.yml           # Compose config — port mapping and environment variables
├── .dockerignore                # Files excluded from the Docker build context
├── env.example                  # Template showing required environment variables
├── config/
│   ├── rail.example.yaml        # Template for rail departures config
│   ├── roads.example.yaml       # Template for road journey config
│   ├── rail.yaml                # Your personal rail routes (gitignored)
│   └── roads.yaml               # Your personal road routes (gitignored)
│
├── docs/
│   ├── LDBWS Documentation.pdf  # Subscriber documentation for the National Rail LDBWS JSON API
│   └── raildata-api-examples.md # Example curl commands with authentication for the RDM API
│
├── swagger/
│   └── ldbws-swagger-json.txt   # OpenAPI 2.0 (Swagger) spec for the LDBWS JSON API
│
```

### Key Files in Detail

#### `src/App.tsx`
The heart of the application. Contains:
- All React state (`useState`, `useEffect`, `useRef`) for rail data, road data, loading flags, timestamps, and UI state
- Data fetching on mount and auto-refresh timers (using refs to avoid stale closures)
- Rail card UI — best/next departure logic, expandable train list with calling points
- Unified rail source indicator in the departures header, including engineering-works fallback state
- Road card UI — embedded maps, full-screen overlay, traffic status
- QR code share modal
- Footer with per-source last-updated timestamps

#### `src/services/travelService.ts`
Thin HTTP client layer (using `axios`) that calls the Express backend:
- `getLiveRailDepartures(crs, destinations)` — fetches grouped departures from `/api/rail/departures`
- `getLiveRoadTravel(journeys)` — fetches travel times from `/api/road/travel`

#### `src/lib/`
Contains the core backend logic for data fetching, used by `server.ts`:
- **`rail-api.ts`**: Handles the official National Rail Data Marketplace (RDM) REST API integration.
- **`rail-engineering-api.ts`**: Fetches structured planned engineering works from the National Rail Knowledgebase Incidents feed using `NATIONAL_RAIL_KB_TOKEN`.
- **`rail-engineering.ts`**: Defines the engineering works data model and matches incidents against the configured journeys in `config/rail.yaml`, including likely intermediate stops inferred from live departures.
- **`rail-scraper.ts`**: Provides a robust fallback by scraping the National Rail website when no API token is present. Also handles engineering works fallback.
- **`road-api.ts`**: Encapsulates the logic for querying the Google Maps Routes API and shaping traffic-aware route data.
- **`road-incidents.ts`**: Fetches official National Highways incident feeds and matches them to roads used by the computed route.

#### `server.ts`
Express server that acts as a secure backend proxy. It delegates the heavy lifting to the modules in `src/lib/`:
- **`GET /api/rail/departures`**: Uses `fetchRailApiDepartures` (from `rail-api.ts`) if a token is provided; otherwise, falls back to `scrapeRailDepartures` (from `rail-scraper.ts`).
- **`GET /api/rail/engineering`**: Uses `fetchKnowledgebaseEngineeringWorks` (from `rail-engineering-api.ts`) when `NATIONAL_RAIL_KB_TOKEN` is configured; otherwise falls back to `scrapeEngineeringWorks` (from `rail-scraper.ts`). The route returns structured incidents and includes configured-journey impact matching.
- **`GET /api/road/travel`**: Uses `fetchRoadTravelData` from `road-api.ts`, including route-aware incident matching from `road-incidents.ts`.
- **Configuration Routes**: Serves the rail and road journey configurations from the `config/` directory.

#### `vite.config.ts`
Configures the Vite dev and build pipeline:
- `@vitejs/plugin-react` for JSX/TSX transformation
- `@tailwindcss/vite` for Tailwind CSS v4 integration (no `postcss.config.js` needed)
- `@` alias resolves to the project root

#### `config/` Directory

External YAML files mounted at runtime via Docker volumes (or read locally during dev). These files keep your personal locations out of the codebase. They are parsed by the server and loaded into the frontend on startup.

**`config/roads.yaml`**
Defines your road journeys and Google Maps query strings.
```yaml
journeys:
  - id: work
    destinationName: Work
    origin: "My Home Address"
    destination: "My Office"
```

**`config/rail.yaml`**
Defines your primary National Rail station and the destinations you commute to.
```yaml
homeStation:
  name: "Shenfield"
  crs: "SNF"

# Engineering works will look for disruptions affecting all operators listed here
# Find 2-letter operator codes here: https://en.wikipedia.org/wiki/List_of_companies_operating_trains_in_the_United_Kingdom
operatorCodes: 
  - "LE" # Greater Anglia
  - "XR" # Elizabeth Line
  - "LO" # London Overground
  - "LT" # London Underground (Tube)

destinations:
  - id: "liverpool-st"
    name: "Liverpool Street"
    crs: "LST"            # Required — 3-letter CRS code for the destination station
```

> **Note:** The `crs` field on each destination is required for the Rail Data Marketplace API to correctly look up arrivals at that station filtered from your home station. If omitted, rail times will not display.

---

## 🔑 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NATIONAL_RAIL_TOKEN` | Optional | API key from [Rail Data Marketplace](https://raildata.org.uk). Subscribe to the **"Live Arrival and Departure Boards (Arr and Dep)"** product, then find the key in the subscriber under **"Specificiation"**. Used as the `x-apikey` header. Without this, the app falls back to web scraping. See [docs/raildata-api-examples.md](docs/raildata-api-examples.md) for an example |
| `NATIONAL_RAIL_KB_TOKEN` | Optional | Knowledgebase auth token for the National Rail `Incidents` feed, used by the engineering works panel to fetch richer planned-engineering data. When absent or invalid, the app falls back to scraping National Rail’s public disruption pages |
| `NATIONAL_RAIL_KB_BASE_URL` | Optional | Override for the Knowledgebase incidents feed base URL. Defaults to `https://opendata.nationalrail.co.uk/api/staticfeeds` |
| `GOOGLE_MAPS_API_KEY` | Optional | A Google Cloud API key with the **Routes API** enabled. If not set, road travel data is unavailable but the app still works |

> **Note:** The application works fully without any keys. Rail departures and engineering works both fall back to scraping when their respective National Rail credentials are absent. Road travel shows a clear "API key not configured" message when the Google Maps key is absent. Route incidents currently use official National Highways feeds, so they are strongest for journeys touching the English strategic road network. If your Google key only has Distance Matrix access, travel times will still work but incidents ahead will be empty until `Routes API` is enabled.

---

## 🐳 Deployment with Docker Compose

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed

### Build and Start

```bash
# Clone the repository
git clone <your-repo-url> travel-hub
cd travel-hub

# Create a .env file with any API environment variables
NATIONAL_RAIL_TOKEN=...
NATIONAL_RAIL_KB_TOKEN=...
GOOGLE_MAPS_API_KEY=...

# Set up journey configurations
cp config/roads.example.yaml config/roads.yaml
cp config/rail.example.yaml config/rail.yaml
# Edit both files in config/ and add your personal routes

# Build the Docker image and start the container
docker compose up --build -d
```

The application will be available at **http://localhost:3000**.

On remote hosts, those variables must exist in the environment used to run `docker compose`. If they are missing there, the container will still start but the app will not use the live APIs for the affected features.

### Stop the Application

```bash
docker compose down
```

### View Logs

```bash
docker compose logs -f
```

### Rebuild After Code Changes

```bash
docker compose up --build -d
```

### How the Docker Build Works

The `Dockerfile` uses a **two-stage build**:

1. **Builder stage** (`node:20-slim`) — installs all dependencies and runs `vite build` to compile the frontend into static assets in `dist/`
2. **Runtime stage** (`node:20-slim`) — copies only the compiled `dist/`, `node_modules/`, and `server.ts` from the builder. Runs the Express server via `tsx` (TypeScript executor), which serves the pre-built static frontend in production mode

This keeps the final image lean by excluding build-only tooling.

---

## 🤖 AI Project Files

The `.ai/` directory contains project-specific assistant guidance for repository-aware AI tools. These files are documentation and workflow metadata for maintenance tasks; they are not used by the Travelhub application at runtime.

### `.ai/skills/travelhub-live-data-agent/SKILL.md`

This is the main skill definition for live-data work. It tells an AI agent:
- when to use the skill
- which Travelhub files own rail and road behavior
- how source selection should work between API usage and scraping fallback
- that verification should use Docker-oriented workflows

Use it for changes involving National Rail integration, engineering works, Google Maps traffic data, config contracts, or frontend/backend mapping for live data.

### `.ai/skills/travelhub-live-data-agent/agents/openai.yaml`

This file registers the skill for OpenAI/Codex-style tooling. It defines:
- the display name shown to the AI tool
- a short description of the skill
- a default prompt that suggests the skill for relevant tasks
- an implicit-invocation policy flag

Its purpose is discovery and activation of the skill within compatible AI tooling.

### `.ai/skills/travelhub-live-data-agent/references/live-data-contracts.md`

This reference file captures the repo’s live-data contracts so AI agents can make safe changes without re-deriving the rules each time. It documents:
- source-selection rules for `NATIONAL_RAIL_TOKEN` and `GOOGLE_MAPS_API_KEY`
- the main runtime files responsible for rail and road flows
- expected shapes for `config/rail.yaml` and `config/roads.yaml`
- response contracts for the `/api/*` endpoints
- the expectation to verify using Docker-based workflows

## 💻 Development And Verification

Per project policy, development and testing should be done with Docker rather than local `npm`, `node`, or `npx` commands.

### Start The App

```bash
docker compose up --build -d
```

The application will be available at **http://localhost:3150**.

### Run Project Commands In The Container

```bash
docker compose exec app sh
```

Run any project-specific inspection or verification commands inside the container so the workflow stays aligned with the deployed environment.

---

## 👩‍💻 Developer Guide

This section is for engineers picking up this project for the first time. Below is an overview of every technology used and curated resources to get up to speed quickly.

---

### Technology Overview

| Technology | Role in this project |
|---|---|
| **React 19** | UI component framework — all rendering and state management |
| **TypeScript** | Type-safe JavaScript used across the entire codebase |
| **Vite 6** | Frontend bundler and development server with HMR |
| **Tailwind CSS v4** | Utility-first CSS framework for all styling |
| **Express** | Minimal Node.js HTTP server for backend API routes |
| **tsx** | TypeScript executor that runs `server.ts` without a compile step |
| **Axios** | HTTP client used on both frontend and backend |
| **Cheerio** | Server-side HTML parser (like jQuery for Node) — used for scraping National Rail |
| **motion** (Framer Motion) | Animation library — layout animations, page transitions, accordion cards |
| **date-fns** | Date/time formatting utilities |
| **lucide-react** | Icon component library |
| **clsx + tailwind-merge** | Utilities for conditionally composing Tailwind class names |
| **fast-xml-parser** | Parses the SOAP/XML response from the National Rail official API |
| **Docker + Compose** | Containerised runtime and the standard development/verification workflow |
| **Codex project skill files (`.ai/`)** | Repository-specific AI guidance for safe live-data maintenance work |

---

### Learning Resources

#### JavaScript (ES2020+)
Understanding modern JS is the foundation for everything else.
- [javascript.info](https://javascript.info/) — The best free, comprehensive JS guide
- [MDN JavaScript Guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide) — Reference documentation
- [Async/Await explained](https://javascript.info/async-await) — Essential for understanding the data fetching in `server.ts` and `travelService.ts`
- [ES Modules (import/export)](https://javascript.info/modules-intro) — How files import from each other

#### TypeScript
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) — Official, well-structured introduction
- [TypeScript in 5 minutes](https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html) — Quick onboarding for JS developers
- [Type narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) — Relevant to how types are checked in the UI data flow
- [Generic types](https://www.typescriptlang.org/docs/handbook/2/generics.html) — Used extensively in React state (`useState<T>`)

#### React
- [React Docs — Quick Start](https://react.dev/learn) — Official, modern docs (covers hooks-based React)
- [useState](https://react.dev/reference/react/useState) — Local state management (heavily used in `App.tsx`)
- [useEffect](https://react.dev/reference/react/useEffect) — Side effects and data fetching
- [useRef](https://react.dev/reference/react/useRef) — Mutable refs, used here to avoid stale closures in intervals
- [useMemo](https://react.dev/reference/react/useMemo) — Derived/computed values

#### Tailwind CSS v4
- [Tailwind CSS Docs](https://tailwindcss.com/docs) — Full utility class reference
- [Core concepts](https://tailwindcss.com/docs/utility-first) — Why utility-first CSS works the way it does
- [Responsive design](https://tailwindcss.com/docs/responsive-design) — The `sm:`, `lg:` prefixes used in the layout
- [Tailwind v4 migration](https://tailwindcss.com/docs/v4-beta) — v4 uses a Vite plugin instead of PostCSS

#### Vite
- [Vite Guide](https://vite.dev/guide/) — How Vite bundles, transforms, and serves your code
- [vite.config.ts reference](https://vite.dev/config/) — All configuration options
- [Environment variables in Vite](https://vite.dev/guide/env-and-mode) — How `.env` files work with Vite's `define`

#### Express (Node.js backend)
- [Express Getting Started](https://expressjs.com/en/starter/hello-world.html) — Quick intro
- [Routing](https://expressjs.com/en/guide/routing.html) — How `app.get('/api/...')` routes work
- [Middleware](https://expressjs.com/en/guide/using-middleware.html) — How `cors()` and `express.json()` fit in

#### Docker & Docker Compose
- [Docker Getting Started](https://docs.docker.com/get-started/) — Containers and images explained
- [Dockerfile reference](https://docs.docker.com/engine/reference/builder/) — Every instruction used in the `Dockerfile`
- [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/) — How the builder → runtime pattern works here
- [Docker Compose overview](https://docs.docker.com/compose/) — Service definitions, ports, and environment variable injection

#### Motion (Framer Motion)
- [Motion for React docs](https://motion.dev/docs/react-quick-start) — Getting started with `<motion.div>` and `AnimatePresence`
- [Layout animations](https://motion.dev/docs/react-layout-animations) — Used for the expanding rail cards

#### Axios
- [Axios docs](https://axios-http.com/docs/intro) — HTTP requests, params, error handling

---

### Architecture at a Glance

```
Browser (React SPA)
    │
    │  HTTP (fetch/axios)
    ▼
Express Server (server.ts) — port 3000
    ├── Serves pre-built Vite dist/ (production)
    ├── Proxies requests to National Rail (scraping / SOAP API)
    └── Proxies requests to Google Maps Routes API and National Highways incident feeds
```

During development-oriented container workflows, Vite is mounted as middleware inside Express so a single port (3000) serves both the frontend and the backend API routes.

In production (Docker), Vite has already compiled the frontend to `dist/`. Express serves those static files directly and continues to handle `/api/*` routes.

---

### Code Style Notes

- **No class components** — all React components use function components and hooks
- **No Redux / external state manager** — all state lives in `App.tsx` using `useState`
- **`cn()` helper** — wraps `clsx` + `tailwind-merge` to safely compose conditional Tailwind classes without duplication
- **Graceful degradation** — every external API (National Rail, Google Maps) has a fallback; the app is usable with zero API keys
