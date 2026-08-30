# Feature specification: impacted journey maps

- **Date/time:** 2026-08-27 14:55 UTC
- **Status:** Specification for review; implementation has not started
- **Branch:** `feature/impacted-journey-maps`
- **Related research:** [Explore Homelab GCP impacted-journey maps](https://github.com/TheTeamRAH/explore-homelab/pull/6)

## Purpose

Extend Travelhub so it can produce a trustworthy, route-specific visual snapshot for configured road journeys. The first consumer is an explicitly requested Slack-ready image showing the route, current Google traffic condition, separately sourced incidents or restrictions, freshness and confidence.

Travelhub should remain the owner of route acquisition and journey configuration. Presentation outputs should consume one structured snapshot so the browser view, static image and text summary cannot disagree about the same refresh.

## User outcome

For every configured journey, a user can distinguish:

- the route Google calculated;
- traffic conditions on that route at retrieval time;
- externally sourced incidents or restrictions that may affect it;
- confirmed versus approximate information;
- when the snapshot was retrieved; and
- whether the result is current, stale or unavailable.

Journeys must remain separate. One alternative route must not hide an impact on another route.

## Scope

### In scope

1. Extend the existing server-side Google Routes API response with the minimum route geometry needed for visualisation.
2. Preserve current travel-time, distance, traffic-status and incident behavior unless the new contract requires a compatible shape.
3. Introduce a typed, serialisable route-snapshot contract with stable journey ID, retrieval time, source status, route geometry, traffic intervals, impacts, confidence and errors.
4. Add a browser rendering path using Maps JavaScript API that consumes the server-returned route geometry without another Routes API call.
5. Add a server-side static-image output suitable for manual Slack attachment, subject to Google Maps Platform attribution, quota, billing and terms review.
6. Add fixture-based contract and rendering tests without using real addresses or API credentials.
7. Document the feature and safe configuration in the README.

### Out of scope for this feature

- Automatic Slack posting or scheduled Slack delivery.
- Modifying National Rail behavior.
- Replacing the current incident source or claiming complete local-roadworks coverage.
- Exposing Google API keys to the browser or embedding keys in image URLs stored in logs.
- Making a traffic category equivalent to a closure, roadworks notice or confirmed obstruction.
- Changing configured personal journeys in the repository.
- Production deployment, live billing changes or enabling new Google APIs without explicit approval.

## Proposed design

### Data flow

1. Read configured journeys from the existing private YAML contract.
2. Request each route independently through the existing server-side Google Routes API wrapper.
3. Request only required fields through a narrow field mask: route/leg geometry, duration, static duration, distance and traffic interval data.
4. Join route data with incident/restriction data as a separate evidence layer.
5. Return a route snapshot keyed by stable journey ID.
6. Render the same snapshot in the browser and in a static image endpoint or renderer.

### Snapshot contract

The implementation should introduce a typed contract equivalent to:

```ts
interface RouteSnapshot {
  journeyId: string;
  title: string;
  retrievedAt: string;
  status: "ok" | "stale" | "unavailable";
  route?: {
    encodedPolyline?: string;
    distanceMeters?: number;
    duration?: string;
    staticDuration?: string;
    trafficIntervals?: Array<{
      startPolylinePointIndex?: number;
      endPolylinePointIndex?: number;
      speed: "NORMAL" | "SLOW" | "TRAFFIC_JAM";
    }>;
  };
  impacts: Array<{
    id: string;
    source: string;
    title: string;
    severity: "low" | "medium" | "high";
    confidence: "confirmed" | "approximate" | "unknown";
    reportedAt?: string;
    routePosition?: {
      startPolylinePointIndex?: number;
      endPolylinePointIndex?: number;
    };
    link?: string;
  }>;
  error?: {
    kind: "route" | "impact-source" | "render" | "configuration";
    message: string;
  };
}
```

The exact field names may change during implementation, but the separation between route data, traffic, impact evidence, confidence, freshness and failure state is mandatory.

### Rendering

- Primary browser view: use the Google Maps JavaScript API with a browser-restricted key to render the server-computed route on a normal Google map. Reuse the encoded polyline returned by the server; do not call Routes API again from the browser.
- Draw only the selected/configured journey. Do not show Google-generated alternatives unless explicitly requested.
- Use a modest route stroke, Google map labels, start/end markers and separate impact markers. Traffic colouring should be added only when route interval geometry is available; otherwise show the overall traffic status separately.
- Static Maps remains a fallback/manual export path, not the primary visual product.
- Slack delivery remains manual until the dynamic rendering is validated; provide a text summary alongside any image or link.
- Accessibility: display journey title, retrieval time, source labels, confidence and stale/unavailable state outside the map canvas.

## Acceptance criteria

### Contract and API

- [ ] Each configured journey is returned independently by stable ID.
- [ ] The server never returns or logs the Google API key.
- [ ] Route geometry, traffic data and impact evidence have distinct provenance.
- [ ] A route failure does not erase a successful impact-source result, and an impact-source failure does not erase route geometry.
- [ ] Existing consumers either continue to work or receive an explicitly versioned response change.
- [ ] Requests use a narrow field mask and are protected by the existing refresh policy plus an implementation-level cache or equivalent request guard.

### Visual output

- [ ] Browser rendering shows route identity, start/end, freshness, legend and source/confidence labels.
- [ ] Traffic colouring is used only when the response provides sufficient geometry/index information.
- [ ] Incident/restriction markers are visually distinct from Google traffic colouring.
- [ ] Static output has agreed Slack dimensions, readable text and a text-summary companion.
- [ ] Separate gym alternatives and work journeys remain separately reviewable.

### Testing and safety

- [ ] Fixtures cover normal, traffic-only, impact-only, conflicting-source, stale and unavailable states.
- [ ] Tests contain synthetic or redacted values only.
- [ ] API-key absence, upstream failure, malformed geometry and long-route rendering are exercised.
- [ ] Billing, quota, attribution and key-restriction decisions are documented before live use.
- [ ] No automatic Slack delivery is added in this feature.

## Compatibility and safety

- Keep `GOOGLE_MAPS_API_KEY` server-side and continue loading it only from the environment.
- Use a separate `GOOGLE_MAPS_BROWSER_API_KEY` restricted by HTTP referrer for Maps JavaScript API; never expose the server key to the browser.
- Do not read or commit `.env`, private `config/roads.yaml`, raw addresses or live API responses.
- Maintain the project’s stated target of staying within 50% of the monthly free-tier allowance; measure route and image requests separately.
- Cache route snapshots and avoid making each image request trigger an upstream route call.
- Display retrieval time and stale/unavailable states prominently.
- Treat name-only incident matching as approximate. Do not label a route closed without authoritative closure evidence.
- Follow Google Maps Platform terms and attribution requirements for both browser and static outputs.
- Use Docker for project verification; do not run local `node`, `npm`, or `npx` commands.

## Verification plan

1. Run the existing TypeScript/lint/build checks inside Docker after implementation.
2. Run contract tests against synthetic route responses.
3. Render deterministic fixture outputs and inspect browser/static agreement.
4. Confirm no secrets or personal journey values are present in the diff or logs.
5. Perform a separately approved live GCP test with a restricted key, request-count measurement and a disposable or already-authorized route configuration.
6. Perform a separately approved manual Slack attachment test; record image appearance and text accessibility.

## Implementation sequence after approval

1. Add the contract and fixtures.
2. Extend `src/lib/road-api.ts` with geometry and provenance while preserving existing fields.
3. Add the browser map/route renderer and error/freshness states.
4. Add static image generation and a manual download/attachment path, not automatic Slack posting.
5. Update README and project documentation.
6. Run Docker verification, review the full diff, and only then request authorization for live GCP and Slack tests.

## Definition of done for this specification PR

This PR is complete when the specification is reviewed and merged. It must not include implementation, live API calls, new credentials, automatic Slack delivery or production configuration changes.
