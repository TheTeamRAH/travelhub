import { useEffect, useRef, useState } from "react";

interface GoogleRouteMapProps {
  encodedPolyline?: string;
  trafficStatus: string;
  title: string;
}

type GoogleMapsApi = {
  maps: {
    Map: new (element: HTMLElement, options: Record<string, unknown>) => any;
    Polyline: new (options: Record<string, unknown>) => any;
    LatLngBounds: new () => any;
    LatLng: new (lat: number, lng: number) => any;
    Marker: new (options: Record<string, unknown>) => any;
  };
};

declare global {
  interface Window {
    google?: GoogleMapsApi;
  }
}

let mapsPromise: Promise<GoogleMapsApi> | null = null;

function loadGoogleMaps(): Promise<GoogleMapsApi> {
  if (window.google?.maps) return Promise.resolve(window.google);
  if (mapsPromise) return mapsPromise;

  mapsPromise = fetch("/api/config/maps")
    .then(response => {
      if (!response.ok) throw new Error("Google Maps browser key unavailable");
      return response.json();
    })
    .then(({ apiKey }) => {
      if (!apiKey) throw new Error("Google Maps browser key unavailable");
      return new Promise<GoogleMapsApi>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>("script[data-travelhub-google-maps]");
        if (existing) {
          existing.addEventListener("load", () => window.google ? resolve(window.google) : reject(new Error("Google Maps failed to load")));
          existing.addEventListener("error", () => reject(new Error("Google Maps failed to load")));
          return;
        }

        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
        script.async = true;
        script.defer = true;
        script.dataset.travelhubGoogleMaps = "true";
        script.onload = () => window.google ? resolve(window.google) : reject(new Error("Google Maps failed to load"));
        script.onerror = () => reject(new Error("Google Maps failed to load"));
        document.head.appendChild(script);
      });
    });

  return mapsPromise;
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

function routeColour(status: string): string {
  if (status === "Severe delays") return "#dc2626";
  if (status === "Delays building") return "#d97706";
  return "#2563eb";
}

export default function GoogleRouteMap({ encodedPolyline, trafficStatus, title }: GoogleRouteMapProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapElement.current || !encodedPolyline) return;
    let cancelled = false;

    loadGoogleMaps()
      .then(google => {
        if (cancelled || !mapElement.current) return;
        const points = decodePolyline(encodedPolyline);
        if (points.length < 2) throw new Error("Route geometry is invalid");

        const path = points.map(([lat, lng]) => new google.maps.LatLng(lat, lng));
        const bounds = new google.maps.LatLngBounds();
        path.forEach(point => bounds.extend(point));
        const map = new google.maps.Map(mapElement.current, {
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: "cooperative",
        });
        map.fitBounds(bounds, 32);

        new google.maps.Polyline({
          map,
          path,
          strokeColor: routeColour(trafficStatus),
          strokeOpacity: 0.65,
          strokeWeight: 3,
          clickable: false,
          zIndex: 2,
        });

        new google.maps.Marker({ position: path[0], map, title: `${title} origin`, label: "A" });
        new google.maps.Marker({ position: path[path.length - 1], map, title: `${title} destination`, label: "B" });
      })
      .catch(reason => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Google Maps failed to load");
      });

    return () => { cancelled = true; };
  }, [encodedPolyline, title, trafficStatus]);

  if (!encodedPolyline) {
    return <div className="h-full flex items-center justify-center text-sm text-slate-500">Route map unavailable</div>;
  }

  return (
    <div className="relative h-full w-full">
      <div ref={mapElement} className="h-full w-full" role="img" aria-label={`Google map showing ${title}`} />
      {error && <div className="absolute inset-0 flex items-center justify-center bg-slate-100/95 p-4 text-center text-sm text-slate-600">{error}</div>}
    </div>
  );
}
