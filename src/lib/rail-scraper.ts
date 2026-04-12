import axios from "axios";
import * as cheerio from "cheerio";
import { EngineeringWork } from "./rail-engineering";

interface NationalRailService {
  rid?: string;
  destination?: Array<{ locationName?: string; crs?: string }>;
  journeyDetails?: {
    to?: { locationName?: string; crs?: string };
    stops?: Array<{ stationName?: string; description?: string }>;
    arrivalInfo?: { scheduled?: string };
  };
  departureInfo?: { scheduled?: string };
  arrivalInfo?: { scheduled?: string };
  status?: { status?: string; delay?: string };
  platform?: string;
}

interface CallingPoint {
  name: string;
  crs?: string;
}

function normaliseStationText(value?: string) {
  return (value || "").trim().toLowerCase();
}

async function fetchBoardServices(url: string): Promise<NationalRailService[]> {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.5',
    },
    maxRedirects: 5,
    timeout: 10000
  });

  const $ = cheerio.load(response.data);
  const nextDataScript = $('#__NEXT_DATA__').html();

  if (!nextDataScript) {
    console.warn(`Could not find __NEXT_DATA__ script tag on National Rail page for ${url}`);
    return [];
  }

  const nextData = JSON.parse(nextDataScript);
  return nextData.props?.pageProps?.liveTrainsState?.queries?.[0]?.state?.data?.pages?.[0]?.services || [];
}

async function fetchCallingPoints(rid: string, fromCrs: string, toCrs: string): Promise<CallingPoint[]> {
  try {
    const gqlResponse = await axios.post('https://nreservices.nationalrail.co.uk/live-info', {
      operationName: "ServiceDetails",
      variables: {
        rid: rid,
        fromCrs: fromCrs,
        toCrs: toCrs,
        direction: "DEPARTURE"
      },
      query: `query ServiceDetails($rid: ID!, $fromCrs: String, $toCrs: String, $direction: NreDirectionType!) {
        ServiceDetails(rid: $rid, fromCrs: $fromCrs, toCrs: $toCrs, direction: $direction) {
          callingPoints {
            stationInfo {
              locationName
              crs
            }
          }
        }
      }`
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Origin': 'https://www.nationalrail.co.uk',
        'Referer': 'https://www.nationalrail.co.uk/',
      },
      timeout: 5000
    });

    const allStops = gqlResponse.data?.data?.ServiceDetails?.callingPoints || [];
    const fromIndex = allStops.findIndex((cp: any) => cp.stationInfo.crs === fromCrs);
    const subsequentStops = fromIndex !== -1 ? allStops.slice(fromIndex + 1) : allStops;

    return subsequentStops.map((cp: any) => ({
      name: cp.stationInfo.locationName,
      crs: cp.stationInfo.crs
    })).filter((cp: CallingPoint) => cp.name);
  } catch (e) {
    console.error("Calling points fetch failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

// --- Rail Scraping Fallback ---
export async function scrapeRailDepartures(crs: string, destination?: string, destCrs?: string) {
  try {
    const stationCode = (crs || 'SNF').toUpperCase().substring(0, 3);
    const destCode = destCrs ? destCrs.toUpperCase().substring(0, 3) : null;
    const boardUrl = `https://www.nationalrail.co.uk/live-trains/departures/${stationCode}/`;
    const filteredUrl = destCode
      ? `https://www.nationalrail.co.uk/live-trains/departures/${stationCode}/${destCode}/`
      : boardUrl;

    let services = await fetchBoardServices(filteredUrl);

    if (services.length === 0 && (destination || destCode) && filteredUrl !== boardUrl) {
      console.log(`[Scrape] ${stationCode} → ${destCode}: filtered board empty, retrying full board`);
      services = await fetchBoardServices(boardUrl);
    }

    console.log(`[Scrape] ${stationCode} → ${destCode || 'Everywhere'} (Departures): ${services.length} total services from board`);

    const departurePromises = services.map(async (s: any) => {
      const depInfo = s.departureInfo || {};
      const actualDestArrivalInfo = s.arrivalInfo || {};
      const arrivalAtDest = s.journeyDetails?.arrivalInfo || actualDestArrivalInfo;
      const directDestinationName = s.destination?.[0]?.locationName || s.journeyDetails?.to?.locationName || "";
      const directDestinationCrs = (s.destination?.[0]?.crs || s.journeyDetails?.to?.crs || "").toUpperCase();
      const destinationNameLower = normaliseStationText(destination);

      let departureTime = depInfo.scheduled ? new Date(depInfo.scheduled).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : "N/A";
      let eta = arrivalAtDest.scheduled ? new Date(arrivalAtDest.scheduled).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : "N/A";
      let duration = 0;
      let status = "Unknown";
      let callingPoints: CallingPoint[] = [];
      let stops: string[] = [];

      if (depInfo.scheduled && arrivalAtDest.scheduled) {
        const start = new Date(depInfo.scheduled).getTime();
        const end = new Date(arrivalAtDest.scheduled).getTime();
        duration = Math.round((end - start) / (1000 * 60));
      }

      let statusSlug = s.status?.status || "Unknown";
      if (statusSlug === "OnTime") status = "On time";
      else if (statusSlug === "Cancelled") status = "Cancelled";
      else if (statusSlug === "Delayed") status = "Delayed";
      else if (s.status?.delay) status = s.status.delay;
      else status = statusSlug;

      const matchesDirectDestination =
        (!!destCode && directDestinationCrs === destCode) ||
        (!!destinationNameLower && normaliseStationText(directDestinationName).includes(destinationNameLower));

      if (s.rid && directDestinationCrs && ((destination && !matchesDirectDestination) || !destination)) {
        callingPoints = await fetchCallingPoints(s.rid, stationCode, directDestinationCrs);
        stops = callingPoints.map(cp => cp.name);
      }

      if (stops.length === 0 && Array.isArray(s.journeyDetails?.stops)) {
        stops = s.journeyDetails.stops.map((stop: any) =>
          stop?.stationName || stop?.description || "Unknown stop"
        ).filter(Boolean);
      }

      if (destination || destCode) {
        const matchesStopByCode = !!destCode && callingPoints.some(cp => cp.crs?.toUpperCase() === destCode);
        const matchesStopByName = !!destinationNameLower && callingPoints.some(cp => normaliseStationText(cp.name).includes(destinationNameLower));
        if (!matchesDirectDestination && !matchesStopByCode && !matchesStopByName) return null;
      }

      return {
        id: `${s.rid || Math.random().toString(36).substr(2, 9)}-${destination || 'board'}`,
        time: departureTime,
        destination: directDestinationName || destination || "Unknown",
        status: status,
        platform: s.platform || "TBC",
        duration: duration > 0 ? duration : 0,
        eta: eta,
        stops: stops
      };
    });

    const departures = (await Promise.all(departurePromises)).filter((d): d is Exclude<typeof d, null> => d !== null);
    console.log(`[Scrape] ${stationCode} → ${destination || 'all'}: ${departures.length} services match destination`);
    return departures;
  } catch (error: any) {
    console.error(`Scraping failed for ${crs}:`, error.message);
    return [];
  }
}

// Helper to parse National Rail's Rich Text JSON format
function parseNreRichText(node: any): string {
  if (!node) return "";
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(parseNreRichText).join("");

  let text = "";
  if (node.nodeType === 'text') {
    text += node.value || "";
  }

  if (node.content && Array.isArray(node.content)) {
    text += node.content.map(parseNreRichText).join("");
  }

  return text;
}

export async function scrapeEngineeringWorks(operators: string[] = ['LE']) {
  const allDisruptions: EngineeringWork[] = [];
  const seenSlugs = new Set<string>();

  const parseRichTextValue = (value: any): string => {
    if (!value) return "";
    if (value.json) return parseNreRichText(value.json).trim();
    if (typeof value === "string") return value.trim();
    return parseNreRichText(value).trim();
  };

  const normaliseOperators = (item: any): { code?: string; name: string }[] => {
    const candidates = item?.trainOperatorsAffected || item?.operatorsAffected || item?.operators || item?.trainOperators || [];
    const list = Array.isArray(candidates) ? candidates : [candidates];

    return list.map((operator: any) => {
      if (typeof operator === "string") {
        return { name: operator.trim() };
      }

      return {
        code: operator?.code || operator?.operatorCode || operator?.tocCode,
        name: (operator?.name || operator?.operatorName || operator?.title || operator?.code || "").trim(),
      };
    }).filter(operator => operator.name);
  };

  for (const code of operators) {
    try {
      const url = `https://www.nationalrail.co.uk/status-and-disruptions/?operatorCode=${code}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
        timeout: 10000
      });

      const $ = cheerio.load(response.data);
      const nextDataScript = $('#__NEXT_DATA__').html();

      if (!nextDataScript) continue;

      const nextData = JSON.parse(nextDataScript);
      const disruptionsData = nextData.props?.pageProps?.data?.disruptionsData;

      if (!disruptionsData) {
        console.warn(`No disruptionsData found for operator ${code} at the expected path.`);
        continue;
      }

      const planned = disruptionsData.engineeringWorks || [];

      planned.forEach((item: any) => {
        if (item.slug && !seenSlugs.has(item.slug)) {
          seenSlugs.add(item.slug);

          const summary = parseRichTextValue(item.summary || item.title || item.heading);
          const description = parseRichTextValue(item.description || item.body || item.details);
          const routesAffected = parseRichTextValue(
            item.routesAffected || item.routeAffected || item.affectedRoutes || item.routeDescription
          );
          const infoUrl = item.url || item.href || (item.slug ? `https://www.nationalrail.co.uk/engineering-works/${item.slug}/` : undefined);

          if (summary && summary.length > 10) {
            allDisruptions.push({
              id: item.slug || item.id || summary,
              source: "scraping",
              summary,
              description,
              routesAffected,
              startsAt: item.startDate || item.startDateTime || item.validFrom,
              endsAt: item.endDate || item.endDateTime || item.validTo,
              planned: true,
              operatorsAffected: normaliseOperators(item),
              infoUrl,
              impactedJourneys: [],
              uncertainJourneys: [],
            });
          }
        }
      });
    } catch (e) {
      console.error(`Status fetch failed for operator ${code}:`, e instanceof Error ? e.message : e);
    }
  }

  return allDisruptions.slice(0, 8);
}
