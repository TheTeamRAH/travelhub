export interface RailJourneyReference {
  id: string;
  originName: string;
  originCrs: string;
  destinationName: string;
  destinationCrs: string;
  operatorCodes: string[];
  viaStationNames: string[];
}

export interface EngineeringOperator {
  code?: string;
  name: string;
}

export interface EngineeringJourneyMatch {
  journeyId: string;
  journeyName: string;
  reasons: string[];
}

export interface EngineeringWork {
  id: string;
  source: "api" | "scraping";
  summary: string;
  description: string;
  routesAffected: string;
  startsAt?: string;
  endsAt?: string;
  planned: boolean;
  operatorsAffected: EngineeringOperator[];
  infoUrl?: string;
  impactedJourneys: EngineeringJourneyMatch[];
  uncertainJourneys: EngineeringJourneyMatch[];
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function stripMarkup(value: string | undefined | null): string {
  if (!value) return "";

  return compactWhitespace(
    value
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/p>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'")
  );
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map(value => compactWhitespace(value)).filter(Boolean)));
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function candidateStationTerms(name: string, crs: string): string[] {
  const lowerName = name.toLowerCase().trim();
  const withoutLondon = lowerName.replace(/^london\s+/, "");
  const withoutStation = lowerName.replace(/\s+station$/, "");
  const noAmpersand = lowerName.replace(/&/g, "and");

  return dedupeStrings([
    lowerName,
    withoutLondon,
    withoutStation,
    noAmpersand,
    crs.toLowerCase().trim(),
  ]).filter(term => term.length >= 3);
}

function containsTerm(haystack: string, term: string): boolean {
  if (!haystack || !term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, "i").test(haystack) || haystack.includes(term);
}

export function attachJourneyImpacts(
  works: EngineeringWork[],
  journeys: RailJourneyReference[]
): EngineeringWork[] {
  return works.map(work => {
    const haystack = normalizeForMatch([
      work.summary,
      work.description,
      work.routesAffected,
      work.operatorsAffected.map(operator => `${operator.name} ${operator.code || ""}`).join(" "),
    ].join(" "));

    const workOperatorCodes = new Set(
      work.operatorsAffected
        .map(operator => operator.code?.toUpperCase())
        .filter((code): code is string => Boolean(code))
    );

    const impactedJourneys: EngineeringJourneyMatch[] = [];
    const uncertainJourneys: EngineeringJourneyMatch[] = [];

    for (const journey of journeys) {
      const originTerms = candidateStationTerms(journey.originName, journey.originCrs);
      const destinationTerms = candidateStationTerms(journey.destinationName, journey.destinationCrs);
      const viaTerms = dedupeStrings(
        journey.viaStationNames.flatMap(station => candidateStationTerms(station, ""))
      ).filter(term => term.length >= 3);

      const originMatchedTerms = originTerms.filter(term => containsTerm(haystack, term));
      const destinationMatchedTerms = destinationTerms.filter(term => containsTerm(haystack, term));
      const viaMatchedTerms = viaTerms.filter(term => containsTerm(haystack, term));
      const operatorMatched = journey.operatorCodes.some(code => workOperatorCodes.has(code.toUpperCase()));

      const reasons: string[] = [];
      if (destinationMatchedTerms.length > 0) {
        reasons.push(`destination mentioned: ${destinationMatchedTerms[0]}`);
      }
      if (originMatchedTerms.length > 0) {
        reasons.push(`origin mentioned: ${originMatchedTerms[0]}`);
      }
      if (viaMatchedTerms.length > 0) {
        reasons.push(`route mentioned: ${viaMatchedTerms[0]}`);
      }
      if (operatorMatched) {
        reasons.push("operator matched");
      }

      const hasStrongViaEvidence = viaMatchedTerms.length >= 2 || (viaMatchedTerms.length >= 1 && originMatchedTerms.length > 0);

      if (destinationMatchedTerms.length > 0 || hasStrongViaEvidence) {
        impactedJourneys.push({
          journeyId: journey.id,
          journeyName: journey.destinationName,
          reasons,
        });
        continue;
      }

      if (originMatchedTerms.length > 0 || viaMatchedTerms.length > 0 || operatorMatched) {
        uncertainJourneys.push({
          journeyId: journey.id,
          journeyName: journey.destinationName,
          reasons: reasons.length > 0 ? reasons : ["operator or route context matched weakly"],
        });
      }
    }

    return {
      ...work,
      impactedJourneys,
      uncertainJourneys,
    };
  });
}
