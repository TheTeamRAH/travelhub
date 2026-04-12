import axios from "axios";
import { fetchRouteAwareIncidents, type RoadIncident } from "./road-incidents";

interface RoadJourneyRequest {
  id: string;
  origin: string;
  destination: string;
}

interface GoogleRouteResponse {
  routes?: Array<{
    duration?: string;
    staticDuration?: string;
    distanceMeters?: number;
    description?: string;
    travelAdvisory?: {
      speedReadingIntervals?: Array<{
        speed?: string;
      }>;
    };
    legs?: Array<{
      steps?: Array<{
        distanceMeters?: number;
        navigationInstruction?: {
          instructions?: string;
        };
      }>;
    }>;
  }>;
}

export interface RoadJourneyData {
  travelTime: string;
  trafficStatus: string;
  distance: string;
  summary: string;
  incidents: RoadIncident[];
}

function deriveTrafficStatusFromMatrix(durationSeconds?: number, trafficDurationSeconds?: number): string {
  if (!durationSeconds || !trafficDurationSeconds) {
    return "Live traffic";
  }
  if (trafficDurationSeconds > durationSeconds * 1.35) {
    return "Severe delays";
  }
  if (trafficDurationSeconds > durationSeconds * 1.15) {
    return "Delays building";
  }
  return "Flowing normally";
}

function formatDuration(durationValue?: string): string {
  if (!durationValue) return "--";
  const totalSeconds = Number(durationValue.replace("s", ""));
  if (Number.isNaN(totalSeconds)) return "--";

  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

function formatDistance(distanceMeters?: number): string {
  if (!distanceMeters || Number.isNaN(distanceMeters)) return "--";
  const miles = distanceMeters / 1609.344;
  return miles >= 10 ? `${Math.round(miles)} mi` : `${miles.toFixed(1)} mi`;
}

function extractRoadNames(text: string): string[] {
  const matches = text.match(/\b(?:M\d+(?:\([A-Z]\))?|A\d+(?:\([A-Z]\))?|B\d+)\b/gi) || [];
  return [...new Set(matches.map(match => match.toUpperCase()))];
}

function deriveTrafficStatus(durationSeconds?: number, staticDurationSeconds?: number, intervalSpeeds: string[] = []): string {
  if (!durationSeconds || !staticDurationSeconds) {
    return "Live traffic";
  }

  if (intervalSpeeds.includes("TRAFFIC_JAM") || durationSeconds > staticDurationSeconds * 1.35) {
    return "Severe delays";
  }
  if (intervalSpeeds.includes("SLOW") || durationSeconds > staticDurationSeconds * 1.15) {
    return "Delays building";
  }
  return "Flowing normally";
}

function parseDurationSeconds(durationValue?: string): number | undefined {
  if (!durationValue) return undefined;
  const value = Number(durationValue.replace("s", ""));
  return Number.isNaN(value) ? undefined : value;
}

function buildRoadDistanceIndex(route: NonNullable<GoogleRouteResponse["routes"]>[number]): Map<string, number> {
  const distanceByRoad = new Map<string, number>();
  let runningMeters = 0;

  route.legs?.forEach(leg => {
    leg.steps?.forEach(step => {
      const instruction = step.navigationInstruction?.instructions || "";
      const stepRoads = extractRoadNames(instruction);
      stepRoads.forEach(road => {
        if (!distanceByRoad.has(road)) {
          distanceByRoad.set(road, runningMeters);
        }
      });
      runningMeters += step.distanceMeters || 0;
    });
  });

  return distanceByRoad;
}

async function fetchRouteForJourney(journey: RoadJourneyRequest, apiKey: string): Promise<RoadJourneyData> {
  const response = await axios.post<GoogleRouteResponse>(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      origin: { address: journey.origin },
      destination: { address: journey.destination },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      departureTime: new Date().toISOString(),
      languageCode: "en-GB",
      units: "IMPERIAL",
    },
    {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "routes.duration",
          "routes.staticDuration",
          "routes.distanceMeters",
          "routes.description",
          "routes.travelAdvisory.speedReadingIntervals.speed",
          "routes.legs.steps.distanceMeters",
          "routes.legs.steps.navigationInstruction.instructions",
        ].join(","),
      },
      timeout: 10000,
    }
  );

  const route = response.data.routes?.[0];
  if (!route) {
    throw new Error("No route returned from Google Routes API");
  }

  const durationSeconds = parseDurationSeconds(route.duration);
  const staticDurationSeconds = parseDurationSeconds(route.staticDuration);
  const stepInstructions = route.legs?.flatMap(leg =>
    leg.steps?.map(step => step.navigationInstruction?.instructions || "") || []
  ) || [];
  const routeRoads = [
    ...new Set([
      ...extractRoadNames(route.description || ""),
      ...extractRoadNames(stepInstructions.join(" ")),
    ]),
  ];

  const distanceByRoad = buildRoadDistanceIndex(route);
  const incidents = await fetchRouteAwareIncidents(routeRoads, distanceByRoad);
  const summary = route.description || `Via ${routeRoads.slice(0, 2).join(" / ") || "main route"}`;

  return {
    travelTime: formatDuration(route.duration),
    trafficStatus: deriveTrafficStatus(
      durationSeconds,
      staticDurationSeconds,
      route.travelAdvisory?.speedReadingIntervals?.map(interval => interval.speed || "").filter(Boolean) || []
    ),
    distance: formatDistance(route.distanceMeters),
    summary,
    incidents,
  };
}

async function fetchRoadTravelDataViaDistanceMatrix(
  journeys: RoadJourneyRequest[],
  apiKey: string
): Promise<Record<string, RoadJourneyData>> {
  const origins = journeys.map(journey => journey.origin).join("|");
  const destinations = journeys.map(journey => journey.destination).join("|");

  const response = await axios.get("https://maps.googleapis.com/maps/api/distancematrix/json", {
    params: {
      origins,
      destinations,
      departure_time: "now",
      traffic_model: "best_guess",
      units: "imperial",
      key: apiKey,
    },
    timeout: 10000,
  });

  const data = response.data;
  if (data.status !== "OK") {
    throw new Error(data.error_message || data.status || "Distance Matrix fallback failed");
  }

  const results: Record<string, RoadJourneyData> = {};

  journeys.forEach((journey, index) => {
    const element = data.rows?.[index]?.elements?.[index];
    if (!element || element.status !== "OK") {
      return;
    }

    const durationSeconds = element.duration?.value as number | undefined;
    const trafficDurationSeconds = element.duration_in_traffic?.value as number | undefined;

    results[journey.id] = {
      travelTime: element.duration_in_traffic?.text || element.duration?.text || "--",
      trafficStatus: deriveTrafficStatusFromMatrix(durationSeconds, trafficDurationSeconds),
      distance: element.distance?.text || "--",
      summary: "Via main route",
      incidents: [],
    };
  });

  return results;
}

export async function fetchRoadTravelData(
  journeys: RoadJourneyRequest[],
  apiKey: string
): Promise<Record<string, RoadJourneyData>> {
  console.log(`Fetching route-aware road travel for ${journeys.length} journeys`);
  console.log(`Google Maps API key configured (length: ${apiKey.length})`);

  try {
    const results = await Promise.all(
      journeys.map(async journey => {
        const route = await fetchRouteForJourney(journey, apiKey);
        return [journey.id, route] as const;
      })
    );

    return Object.fromEntries(results);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.warn("Routes API failed, falling back to Distance Matrix", error.response?.status, error.response?.data);
      return fetchRoadTravelDataViaDistanceMatrix(journeys, apiKey);
    }
    throw error;
  }
}
