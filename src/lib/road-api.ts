import axios from "axios";

export async function fetchRoadTravelData(
  origins: string,
  destinations: string,
  ids: string,
  apiKey: string
): Promise<Record<string, any>> {
  console.log(`Fetching road travel for ${origins} to ${destinations}`);
  console.log(`Google Maps API key configured (length: ${apiKey.length})`);
  const response = await axios.get("https://maps.googleapis.com/maps/api/distancematrix/json", {
    params: {
      origins,
      destinations,
      departure_time: "now",
      traffic_model: "best_guess",
      units: "imperial",
      key: apiKey,
    },
    timeout: 5000
  });

  const data = response.data;
  console.log(`Maps API Response Status: ${data.status}`);

  const results: Record<string, any> = {};

  if (data.status === "OK") {
    const idList = ids.split("|");
    idList.forEach((destId: string, index: number) => {
      const row = data.rows[index];
      if (!row) return;

      const element = row.elements[index];
      if (!element) return;

      if (element.status === "OK") {
        results[destId] = {
          travelTime: element.duration_in_traffic?.text || element.duration?.text || "--",
          trafficStatus: element.duration_in_traffic ? (element.duration_in_traffic.value > element.duration.value * 1.2 ? "Heavy traffic" : "Normal traffic") : "Normal traffic",
          distance: element.distance?.text || "--",
          summary: "Via main route"
        };
      } else {
        console.warn(`Element status for ${destId}: ${element.status}`);
      }
    });
  } else {
    console.error(`Maps API Error Status: ${data.status}`, data.error_message);
    throw new Error(data.error_message || data.status);
  }

  return results;
}
