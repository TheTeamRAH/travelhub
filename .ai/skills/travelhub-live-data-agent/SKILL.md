---
name: travelhub-live-data-agent
description: Use this skill when working on Travelhub live rail or road data flows, including National Rail API integration, scraping fallback, Google Maps traffic data, YAML config contracts, frontend/backend mapping, and Docker-based runtime verification.
---

# Travelhub Live Data Agent

Use this skill for changes or debugging related to live travel data behavior. It is intended for work that spans backend fetch logic, scraper fallback, config loading, frontend mapping, and runtime verification.

## Use This Skill When

- Rail departures are missing, duplicated, mismatched, or mapped to the wrong destination.
- The National Rail API path and scraping fallback behavior need to be changed or debugged.
- Engineering works behavior needs investigation.
- Road traffic data is failing, incomplete, or mapped incorrectly.
- `config/rail.yaml` or `config/roads.yaml` contract changes affect runtime behavior.
- Frontend refresh, loading, or data-source display needs to stay aligned with backend responses.

## Do Not Use This Skill For

- Pure styling work with no data-flow impact.
- Generic React cleanup unrelated to live travel data.
- Repo administration tasks that do not touch runtime travel behavior.

## Core Workflow

1. Start with the runtime path that owns the issue.
   Rail and road requests enter through `server.ts`. Trace the path from the API route into `src/lib/` and then into `src/App.tsx` and `src/services/travelService.ts` if UI behavior is affected.

2. Preserve Travelhub source-selection rules.
   If `NATIONAL_RAIL_TOKEN` is present, use the National Rail API path. If it is absent, use web scraping. Do not hardcode keys. Do not introduce mock data unless the user explicitly asks.

3. Treat YAML files as runtime contracts.
   Keep `config/rail.yaml` and `config/roads.yaml` compatible with the server responses the frontend expects. If contract changes are necessary, update code and documentation together.

4. Verify with Docker-oriented workflows.
   Follow `AGENTS.md`: do not use local `npm`, `node`, or `npx` commands for project testing. Use Docker commands or commands executed inside the running container.

5. Update docs when behavior changes.
   If live-data behavior, config requirements, or runtime expectations change, update `README.md`.

## High-Value Files

- `server.ts`
- `src/lib/rail-api.ts`
- `src/lib/rail-scraper.ts`
- `src/lib/road-api.ts`
- `src/services/travelService.ts`
- `src/App.tsx`
- `config/rail.example.yaml`
- `config/roads.example.yaml`
- `docker-compose.yml`
- `README.md`

## Guardrails

- Do not read `.env` files.
- Use environment variables for secrets only.
- Keep API integration logic separate from scraping logic.
- Prefer small, explicit fixes over broad refactors when debugging live data.
- If a change affects runtime semantics, document the reason and verify the end-to-end path.

## References

- For repo-specific live-data rules and config contracts, read `references/live-data-contracts.md`.
