import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import * as cheerio from "cheerio";

export interface RoadIncident {
  id: string;
  source: "national-highways";
  title: string;
  description: string;
  category: string;
  severity: "high" | "medium" | "low";
  road: string;
  reportedAt?: string;
  link?: string;
  approxDistanceMiles?: number;
  distanceLabel?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function normalizeWhitespace(value: string | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function extractRoadNames(text: string): string[] {
  const matches = text.match(/\b(?:M\d+(?:\([A-Z]\))?|A\d+(?:\([A-Z]\))?|B\d+)\b/gi) || [];
  return [...new Set(matches.map(match => match.toUpperCase()))];
}

function inferSeverity(text: string): "high" | "medium" | "low" {
  const normalized = text.toLowerCase();
  if (/(collision|crash|overturned|vehicle fire|fatal|closed|closure|blocked|police incident|obstruction|object in road|debris|spillage)/.test(normalized)) {
    return "high";
  }
  if (/(broken down|recovery|lane closed|congestion|delays|queue)/.test(normalized)) {
    return "medium";
  }
  return "low";
}

function extractFeedDescription(descriptionHtml: string): string {
  if (!descriptionHtml) return "";
  const $ = cheerio.load(descriptionHtml);
  return normalizeWhitespace($.root().text());
}

async function getNationalHighwaysAllIncidentsFeedUrl(): Promise<string | null> {
  const response = await axios.get("https://nationalhighways.co.uk/travel-updates/traffic-information-rss-feeds/", {
    timeout: 8000,
  });
  const $ = cheerio.load(response.data);

  let feedUrl: string | null = null;

  $("a").each((_, link) => {
    if (feedUrl) return;
    const text = normalizeWhitespace($(link).text()).toLowerCase();
    const href = $(link).attr("href");
    if (text === "current incidents" && href) {
      feedUrl = new URL(href, "https://nationalhighways.co.uk").toString();
    }
  });

  return feedUrl;
}

async function fetchNationalHighwaysIncidents(): Promise<RoadIncident[]> {
  const feedUrl = await getNationalHighwaysAllIncidentsFeedUrl();
  if (!feedUrl) {
    return [];
  }

  const response = await axios.get(feedUrl, {
    timeout: 8000,
    responseType: "text",
  });

  const parsed = parser.parse(response.data);
  const items = asArray(parsed?.rss?.channel?.item || parsed?.feed?.entry);

  return items.map((item: any) => {
    const title = normalizeWhitespace(item?.title?.["#text"] || item?.title);
    const description = extractFeedDescription(item?.description || item?.summary || "");
    const combinedText = `${title} ${description}`;
    const road = extractRoadNames(combinedText)[0] || "Unknown road";
    const category = normalizeWhitespace(item?.category?.["#text"] || item?.category || "");

    return {
      id: normalizeWhitespace(item?.guid?.["#text"] || item?.guid || item?.id || item?.link || title),
      source: "national-highways",
      title,
      description,
      category: category || "Incident",
      severity: inferSeverity(`${category} ${combinedText}`),
      road,
      reportedAt: normalizeWhitespace(item?.pubDate || item?.updated || ""),
      link: normalizeWhitespace(item?.link?.href || item?.link || ""),
    } satisfies RoadIncident;
  }).filter((incident: RoadIncident) => Boolean(incident.title));
}

export async function fetchRouteAwareIncidents(
  routeRoads: string[],
  distanceByRoad: Map<string, number>
): Promise<RoadIncident[]> {
  if (routeRoads.length === 0) {
    return [];
  }

  try {
    const incidents = await fetchNationalHighwaysIncidents();

    return incidents
      .filter(incident => {
        const haystack = `${incident.title} ${incident.description} ${incident.category}`.toUpperCase();
        return routeRoads.some(road => haystack.includes(road));
      })
      .map(incident => {
        const matchingRoad = routeRoads.find(road => {
          const haystack = `${incident.title} ${incident.description} ${incident.category}`.toUpperCase();
          return haystack.includes(road);
        }) || incident.road;
        const approxDistanceMeters = distanceByRoad.get(matchingRoad);
        const approxDistanceMiles = approxDistanceMeters == null
          ? undefined
          : Number((approxDistanceMeters / 1609.344).toFixed(1));

        return {
          ...incident,
          road: matchingRoad,
          approxDistanceMiles,
          distanceLabel: approxDistanceMiles == null
            ? undefined
            : approxDistanceMiles < 0.2
              ? "On the current route segment"
              : `Approx. ${approxDistanceMiles} mi ahead`,
        };
      })
      .sort((a, b) => {
        const aDistance = a.approxDistanceMiles ?? Number.POSITIVE_INFINITY;
        const bDistance = b.approxDistanceMiles ?? Number.POSITIVE_INFINITY;
        if (aDistance !== bDistance) return aDistance - bDistance;

        const severityRank = { high: 0, medium: 1, low: 2 };
        return severityRank[a.severity] - severityRank[b.severity];
      })
      .slice(0, 5);
  } catch (error) {
    console.warn("Failed to fetch route-aware road incidents", error);
    return [];
  }
}
