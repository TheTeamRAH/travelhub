import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

import { scrapeEngineeringWorks, scrapeRailDepartures } from "./src/lib/rail-scraper";
import { fetchRailApiDepartures } from "./src/lib/rail-api";
import { fetchRoadTravelData } from "./src/lib/road-api";


const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

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
      console.error("Official REST Rail API failed:", error.message);
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
    const operatorQuery = req.query.operator;
    let operators: string[] = [];

    if (Array.isArray(operatorQuery)) {
      operators = operatorQuery.map(op => String(op));
    } else if (typeof operatorQuery === 'string') {
      operators = [operatorQuery];
    } else {
      operators = ['LE']; // Default fallback
    }

    const works = await scrapeEngineeringWorks(operators);
    res.json({ works });
  } catch (error) {
    res.json({ works: ["Service information currently unavailable."] });
  }
});

// --- Rail Journey Config ---
app.get("/api/config/rail", (req, res) => {
  const configPath = path.resolve(process.cwd(), "config", "rail.yaml");
  if (!fs.existsSync(configPath)) {
    return res.json({ _configMissing: true });
  }
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = yaml.load(raw) as any;
    if (!parsed?.homeStation || !parsed?.destinations) {
      return res.status(400).json({ _error: "rail.yaml must contain 'homeStation' and 'destinations'" });
    }
    res.json({
      homeStation: parsed.homeStation,
      operatorCodes: parsed.operatorCodes || (parsed.operatorCode ? [parsed.operatorCode] : ["LE"]),
      destinations: parsed.destinations,
      walkTimeMins: parsed.walkTimeMins || 10
    });
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
    res.json({ _error: error.message || "Failed to fetch road data" });
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
