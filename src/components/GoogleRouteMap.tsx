import { useEffect, useRef, useState } from "react";

interface GoogleRouteMapProps {
  origin: string;
  destination: string;
  trafficStatus: string;
  title: string;
  enabled?: boolean;
}

type GoogleMapsApi = {
  maps: {
    importLibrary: (name: string) => Promise<any>;
    Map: new (element: HTMLElement, options: Record<string, unknown>) => any;
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

function buildEmbedUrl(origin: string, destination: string): string {
  const url = new URL("https://maps.google.com/maps");
  url.searchParams.set("saddr", origin);
  url.searchParams.set("daddr", destination);
  url.searchParams.set("ie", "UTF8");
  url.searchParams.set("iwloc", "");
  url.searchParams.set("output", "embed");
  return url.toString();
}

function EmbedMap({ origin, destination, title, interactive = true }: Pick<GoogleRouteMapProps, "origin" | "destination" | "title"> & { interactive?: boolean }) {
  return (
    <iframe
      width="100%"
      height="100%"
      style={{ border: 0 }}
      src={buildEmbedUrl(origin, destination)}
      allowFullScreen
      className={`h-full w-full ${interactive ? '' : 'pointer-events-none'}`}
      title={`Google Maps route for ${title}`}
    />
  );
}

export default function GoogleRouteMap({ origin, destination, trafficStatus, title, enabled = true }: GoogleRouteMapProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !mapElement.current) return;
    let cancelled = false;

    loadGoogleMaps()
      .then(async google => {
        if (cancelled || !mapElement.current) return;
        const { Route } = await google.maps.importLibrary("routes");
        const { routes } = await Route.computeRoutes({
          origin,
          destination,
          travelMode: "DRIVING",
          routingPreference: "TRAFFIC_AWARE",
          extraComputations: ["TRAFFIC_ON_POLYLINE"],
          fields: ["path", "speedPaths", "routeLabels", "viewport"],
        });
        if (cancelled || !routes?.[0] || !mapElement.current) throw new Error("Google returned no route");

        const route = routes[0];
        const map = new google.maps.Map(mapElement.current, {
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: "cooperative",
        });
        if (route.viewport) map.fitBounds(route.viewport, 32);
        route.createPolylines({
          polylineOptions: {
            map,
            zIndex: 2,
          },
        });
        await route.createWaypointAdvancedMarkers({ map });
      })
      .catch(reason => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Google Maps route failed");
      });

    return () => { cancelled = true; };
  }, [destination, enabled, origin, title, trafficStatus]);

  if (!enabled || error) {
    return <EmbedMap origin={origin} destination={destination} title={title} interactive={enabled} />;
  }

  return (
    <div className="relative h-full w-full">
      <div ref={mapElement} className="h-full w-full" role="img" aria-label={`Google map showing ${title}`} />
      {error && <div className="absolute inset-0 flex items-center justify-center bg-slate-100/95 p-4 text-center text-sm text-slate-600">{error}</div>}
    </div>
  );
}
