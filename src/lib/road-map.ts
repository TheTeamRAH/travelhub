import { URLSearchParams } from "node:url";

export interface StaticMapRequest {
  encodedPolyline: string;
  apiKey: string;
  width?: number;
  height?: number;
  trafficStatus?: string;
}

function trafficColour(status?: string): string {
  if (status === "Severe delays") return "0xDC2626FF";
  if (status === "Delays building") return "0xD97706FF";
  return "0x2563EBFF";
}

function decodePolyline(encoded: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= encoded.length);
    latitude += (result & 1) ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= encoded.length);
    longitude += (result & 1) ? ~(result >> 1) : result >> 1;
    points.push([latitude / 1e5, longitude / 1e5]);
  }

  return points;
}

function getViewport(encodedPolyline: string): { center: string; zoom: string } | undefined {
  try {
    const points = decodePolyline(encodedPolyline);
    if (points.length < 2) return undefined;
    const latitudes = points.map(([latitude]) => latitude);
    const longitudes = points.map(([, longitude]) => longitude);
    const latSpan = Math.max(...latitudes) - Math.min(...latitudes);
    const lonSpan = Math.max(...longitudes) - Math.min(...longitudes);
    const span = Math.max(latSpan, lonSpan, 0.0005);
    const zoom = Math.max(1, Math.min(20, Math.floor(Math.log2(360 / (span * 111)) + 8)));
    return {
      center: `${((Math.max(...latitudes) + Math.min(...latitudes)) / 2).toFixed(6)},${((Math.max(...longitudes) + Math.min(...longitudes)) / 2).toFixed(6)}`,
      zoom: String(zoom),
    };
  } catch {
    return undefined;
  }
}

export function buildStaticMapUrl({
  encodedPolyline,
  apiKey,
  width = 640,
  height = 360,
  trafficStatus,
}: StaticMapRequest): string {
  if (!encodedPolyline) throw new Error("A route polyline is required");
  if (!apiKey) throw new Error("A Google Maps API key is required");

  const viewport = getViewport(encodedPolyline);
  const params = new URLSearchParams({
    size: `${width}x${height}`,
    scale: "2",
    maptype: "roadmap",
    path: `weight:6|color:${trafficColour(trafficStatus)}|enc:${encodedPolyline}`,
    ...(viewport || {}),
    key: apiKey,
  });

  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}
