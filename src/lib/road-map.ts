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

export function buildStaticMapUrl({
  encodedPolyline,
  apiKey,
  width = 640,
  height = 360,
  trafficStatus,
}: StaticMapRequest): string {
  if (!encodedPolyline) throw new Error("A route polyline is required");
  if (!apiKey) throw new Error("A Google Maps API key is required");

  const params = new URLSearchParams({
    size: `${width}x${height}`,
    scale: "2",
    maptype: "roadmap",
    path: `weight:6|color:${trafficColour(trafficStatus)}|enc:${encodedPolyline}`,
    key: apiKey,
  });

  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}
