import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

import { scrapeEngineeringWorks, scrapeRailDepartures } from "./src/lib/rail-scraper";
import { fetchRailApiDepartures } from "./src/lib/rail-api";
import { fetchRoadTravelData } from "./src/lib/road-api";
import { attachJourneyImpacts, RailJourneyReference } from "./src/lib/rail-engineering";
import { fetchKnowledgebaseEngineeringWorks } from "./src/lib/rail-engineering-api";
import { describeRequestError } from "./src/lib/http-client";


const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

function loadRailConfig() {
  const configPath = path.resolve(process.cwd(), "config", "rail.yaml");
  if (!fs.existsSync(configPath)) {
    return { _configMissing: true as const };
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = yaml.load(raw) as any;

  if (!parsed?.homeStation || !parsed?.destinations) {
    throw new Error("rail.yaml must contain 'homeStation' and 'destinations'");
  }

  return {
    homeStation: parsed.homeStation,
    operatorCodes: parsed.operatorCodes || (parsed.operatorCode ? [parsed.operatorCode] : ["LE"]),
    destinations: parsed.destinations,
    walkTimeMins: parsed.walkTimeMins || 10
  };
}

function extractStationName(stop: string): string {
  return stop.replace(/\s+\([^)]*\)\s*$/, "").trim();
}

async function loadJourneyPathHints(config: {
  homeStation: { name: string; crs: string };
  destinations: { id: string; name: string; crs: string }[];
}) {
  const hints: Record<string, string[]> = {};
  const departureToken = process.env.NATIONAL_RAIL_TOKEN?.replace(/^["']|["']$/g, "").trim();

  try {
    if (departureToken) {
      const departures = await fetchRailApiDepartures(
        config.homeStation.crs,
        config.destinations.map(destination => destination.name),
        config.destinations.map(destination => destination.crs),
        departureToken
      );

      for (const destination of config.destinations) {
        const services = departures[destination.name] || [];
        const via = Array.from(new Set(
          services
            .slice(0, 5)
            .flatMap((service: any) => service.stops || [])
            .map((stop: string) => extractStationName(stop))
            .filter(Boolean)
        ));

        hints[destination.id] = via;
      }

      return hints;
    }

    for (const destination of config.destinations) {
      const services = await scrapeRailDepartures(config.homeStation.crs, destination.name, destination.crs);
      const via = Array.from(new Set(
        services
          .slice(0, 5)
          .flatMap((service: any) => service.stops || [])
          .map((stop: string) => extractStationName(stop))
          .filter(Boolean)
      ));

      hints[destination.id] = via;
    }
  } catch (error: any) {
    console.error("Failed to load journey path hints:", error.message);
  }

  return hints;
}

// --- Rail Integration ---
app.get("/api/rail/departures", async (req, res) => {
  const crs = (req.query.crs as string || 'SNF').toUpperCase();
  const destinationsStr = req.query.destinations as string || '';
  const destinations = destinationsStr.split(',').filter(Boolean);
  const destCrsStr = req.query.destCrs as string || '';
  const destCrsList = destCrsStr.split(',').filter(Boolean);

  const token = process.env.NATIONAL_RAIL_TOKEN?.replace(/^["']|["']$/g, '').trim();

  if (token) {
    // strict mode: if token is present, NO fallback to scraping
    try {
      const results = await fetchRailApiDepartures(crs, destinations, destCrsList, token);
      return res.json({ source: "api", departures: results });
    } catch (error: any) {
      console.error("Official REST Rail API failed:", describeRequestError(error));
      return res.status(502).json({ error: "Failed to fetch from National Rail Data API. No scraping fallback permitted." });
    }
  }

  // Fallback to Scraping if NO token is present
  try {
    const results: Record<string, any[]> = {};
    const targets = destinations.length > 0 ? destinations : [null];

    for (let i = 0; i < targets.length; i++) {
      const dest = targets[i];
      const destCrs = dest ? (destCrsList[i] || null) : null;
      if (dest) {
        results[dest] = await scrapeRailDepartures(crs, dest, destCrs || undefined);
      } else {
        results["all"] = await scrapeRailDepartures(crs);
      }
    }

    res.json({ source: "scraping", departures: results });
  } catch (error: any) {
    console.error("Rail Fallback Error:", error.message);
    res.status(500).json({ error: "Failed to fetch rail data via scraping" });
  }
});

app.get("/api/rail/engineering", async (req, res) => {
  try {
    const config = (() => {
      try {
        return loadRailConfig();
      } catch (error: any) {
        return { _error: error.message };
      }
    })();

    const operatorQuery = req.query.operator;
    let operators: string[] = [];

    if (Array.isArray(operatorQuery)) {
      operators = operatorQuery.map(op => String(op).toUpperCase());
    } else if (typeof operatorQuery === "string") {
      operators = [operatorQuery.toUpperCase()];
    } else if (!("_configMissing" in config) && !("_error" in config)) {
      operators = config.operatorCodes.map((op: string) => op.toUpperCase());
    } else {
      operators = ["LE"];
    }

    const journeyPathHints = !("_configMissing" in config) && !("_error" in config)
      ? await loadJourneyPathHints(config)
      : {};

    const journeys: RailJourneyReference[] = !("_configMissing" in config) && !("_error" in config)
      ? config.destinations.map((destination: any) => ({
        id: destination.id,
        originName: config.homeStation.name,
        originCrs: config.homeStation.crs,
        destinationName: destination.name,
        destinationCrs: destination.crs,
        operatorCodes: operators,
        viaStationNames: journeyPathHints[destination.id] || [],
      }))
      : [];

    const kbToken = process.env.NATIONAL_RAIL_KB_TOKEN?.replace(/^["']|["']$/g, "").trim();

    let works;
    let source: "api" | "scraping";

    if (kbToken) {
      try {
        works = await fetchKnowledgebaseEngineeringWorks(kbToken);
        source = "api";
      } catch (error: any) {
        console.error("Knowledgebase engineering API failed:", error.message);
        works = await scrapeEngineeringWorks(operators);
        source = "scraping";
      }
    } else {
      works = await scrapeEngineeringWorks(operators);
      source = "scraping";
    }

    const filteredWorks = operators.length > 0
      ? works.filter(work => {
        if (work.operatorsAffected.length === 0) return true;
        return work.operatorsAffected.some(operator => operator.code && operators.includes(operator.code.toUpperCase()));
      })
      : works;

    const enrichedWorks = attachJourneyImpacts(filteredWorks, journeys)
      .filter(work => work.impactedJourneys.length > 0);

    res.json({ source, works: enrichedWorks });
  } catch (error) {
    res.json({ source: "scraping", works: [] });
  }
});

// --- Rail Journey Config ---
app.get("/api/config/rail", (req, res) => {
  try {
    const config = loadRailConfig();
    if ("_configMissing" in config) {
      return res.json({ _configMissing: true });
    }
    res.json(config);
  } catch (e: any) {
    console.error("Failed to parse rail.yaml:", e.message);
    res.status(500).json({ _error: `Failed to parse rail.yaml: ${e.message}` });
  }
});

// --- Road Journey Config ---
app.get("/api/config/roads", (req, res) => {
  const configPath = path.resolve(process.cwd(), "config", "roads.yaml");
  if (!fs.existsSync(configPath)) {
    return res.json({ _configMissing: true, journeys: [] });
  }
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = yaml.load(raw) as { journeys: any[] };
    if (!parsed?.journeys || !Array.isArray(parsed.journeys)) {
      return res.status(400).json({ _error: "roads.yaml must contain a top-level 'journeys' array" });
    }
    res.json({ journeys: parsed.journeys });
  } catch (e: any) {
    console.error("Failed to parse roads.yaml:", e.message);
    res.status(500).json({ _error: `Failed to parse roads.yaml: ${e.message}` });
  }
});

// --- Google Maps Distance Matrix Integration ---
app.get("/api/road/travel", async (req, res) => {
  const { origins, destinations, ids } = req.query;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.replace(/^["']|["']$/g, '').trim();

  if (!apiKey) {
    return res.json({ _configRequired: true });
  }

  try {
    const results = await fetchRoadTravelData(
      origins as string,
      destinations as string,
      (ids as string) || (destinations as string),
      apiKey
    );
    res.json(results);
  } catch (error: any) {
    console.error("Google Maps Distance Matrix failed:", describeRequestError(error));
    res.json({ _error: describeRequestError(error) || "Failed to fetch road data" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
