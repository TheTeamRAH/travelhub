import { XMLParser } from "fast-xml-parser";
import { EngineeringWork, stripMarkup } from "./rail-engineering";
import axios from "axios";

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeDateRange(validityPeriod: any): { startsAt?: string; endsAt?: string } {
  const periods = asArray(validityPeriod);
  const starts = periods.map(period => period?.StartTime).filter(Boolean);
  const ends = periods.map(period => period?.EndTime).filter(Boolean);

  return {
    startsAt: starts[0],
    endsAt: ends[ends.length - 1],
  };
}

export async function fetchKnowledgebaseEngineeringWorks(token: string): Promise<EngineeringWork[]> {
  const baseUrl = process.env.NATIONAL_RAIL_KB_BASE_URL?.trim() || "https://opendata.nationalrail.co.uk/api/staticfeeds";
  const url = `${baseUrl.replace(/\/$/, "")}/5.0/incidents`;

  const response = await axios.get(url, {
    headers: {
      "X-Auth-Token": token,
      "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
    timeout: 15000,
    responseType: "text",
  });

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    trimValues: true,
    parseTagValue: false,
  });

  const parsed = parser.parse(response.data);
  const incidents = asArray(parsed?.Incidents?.PtIncident || parsed?.PtIncident);

  return incidents
    .filter((incident: any) => String(incident?.Planned).toLowerCase() === "true")
    .filter((incident: any) => String(incident?.ClearedIncident).toLowerCase() !== "true")
    .map((incident: any) => {
      const operators = asArray(incident?.Affects?.Operators?.AffectedOperator).map((operator: any) => ({
        code: operator?.OperatorRef,
        name: stripMarkup(operator?.OperatorName || operator?.OperatorRef || ""),
      })).filter((operator: any) => operator.name);

      const dateRange = normalizeDateRange(incident?.ValidityPeriod);
      const infoUrl = asArray(incident?.InfoLinks?.InfoLink)
        .map((link: any) => link?.Uri)
        .find(Boolean);

      return {
        id: incident?.IncidentNumber || incident?.Version || Math.random().toString(36).slice(2),
        source: "api" as const,
        summary: stripMarkup(incident?.Summary),
        description: stripMarkup(incident?.Description),
        routesAffected: stripMarkup(incident?.Affects?.RoutesAffected),
        startsAt: dateRange.startsAt,
        endsAt: dateRange.endsAt,
        planned: true,
        operatorsAffected: operators,
        infoUrl,
        impactedJourneys: [],
        uncertainJourneys: [],
      };
    })
    .filter((incident: EngineeringWork) => Boolean(incident.summary));
}
