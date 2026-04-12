import axios from "axios";

export async function fetchRailApiDepartures(
  crs: string,
  destinations: string[],
  destCrsList: string[],
  token: string
): Promise<Record<string, any[]>> {
  const results: Record<string, any[]> = {};
  const targets = destinations.length > 0 ? destinations : [null];

  console.log(`Targets: ${targets}, CrsList: ${destCrsList}, origin: ${crs}`);

  for (let i = 0; i < targets.length; i++) {
    const dest = targets[i];
    let url;
    let params: any = {
      numRows: 149,
      timeWindow: 120,
    };

    const destCrs = dest ? (destCrsList[i] || null) : null;

    if (destCrs) {
      url = `https://api1.raildata.org.uk/1010-live-arrival-and-departure-boards-arr-and-dep1_1/LDBWS/api/20220120/GetArrDepBoardWithDetails/${destCrs}`;
      params.filterCrs = crs;
      params.filterType = 'from';
    } else {
      url = `https://api1.raildata.org.uk/1010-live-arrival-and-departure-boards-arr-and-dep1_1/LDBWS/api/20220120/GetDepBoardWithDetails/${crs}`;
      params.filterType = 'to';
    }
    console.log(`Querying ${url} with params`, params);

    let combinedServices: any[] = [];
    const offsets = [0, 40, 80];

    for (const offset of offsets) {
      params.timeOffset = offset;
      try {
        const response = await axios.get(url, {
          params,
          headers: {
            'x-apikey': token,
            'Accept': 'application/json'
          },
          timeout: 10000
        });
        const board = response.data;
        const services = board.trainServices || [];
        combinedServices = combinedServices.concat(Array.isArray(services) ? services : [services]);
      } catch (e: any) {
        console.error(`Error fetching offset ${offset} for ${dest}:`, e.message);
      }
    }

    const uniqueServicesMap = new Map();
    for (const s of combinedServices) {
      if (s && s.serviceID) {
        uniqueServicesMap.set(s.serviceID, s);
      }
    }
    const uniqueServices = Array.from(uniqueServicesMap.values());

    console.log(`[RDM] ${destCrs || crs} uniqueServices count:`, uniqueServices.length);
    if (uniqueServices.length > 0) {
      const formattedServices = uniqueServices.map((s: any) => {
        let depTime = "";
        let arrTime = "";
        let depStatus = "";
        let duration = 0;
        let destName = s.destination?.[0]?.locationName || dest || "Unknown";
        let allStops: any[] = [];

        if (destCrs) {
          const arrStd = s.sta || s.std;
          const arrEtd = s.eta || s.etd;
          arrTime = arrEtd && arrEtd !== "On time" && arrEtd !== "Delayed" && arrEtd !== "Cancelled" ? arrEtd : arrStd;

          const prevPoints = s.previousCallingPoints?.[0]?.callingPoint || [];
          allStops = [...prevPoints];

          const originStop = prevPoints.find((cp: any) => cp.crs === crs || cp.locationName.toLowerCase().includes("pancras"));

          if (originStop) {
            depTime = originStop.et && originStop.et !== "On time" && originStop.et !== "Delayed" && originStop.et !== "Cancelled" ? originStop.et : originStop.st;
            depStatus = originStop.et === "On time" ? "On time" : (originStop.et || originStop.st);
          } else {
            depTime = arrTime;
            depStatus = "Unknown";
          }
        } else {
          const depStd = s.std;
          const depEtd = s.etd;
          depTime = depEtd && depEtd !== "On time" && depEtd !== "Delayed" && depEtd !== "Cancelled" ? depEtd : depStd;
          depStatus = depEtd === "On time" ? "On time" : depEtd;

          const subPoints = s.subsequentCallingPoints?.[0]?.callingPoint || [];
          allStops = [...subPoints];

          const targetStop = dest
            ? subPoints.find((cp: any) => cp.locationName.toLowerCase().includes(dest.toLowerCase()) || dest.toLowerCase().includes(cp.locationName.toLowerCase()))
            : null;

          if (targetStop || subPoints.length > 0) {
            const finalStop = targetStop || subPoints[subPoints.length - 1];
            arrTime = finalStop.et && finalStop.et !== "On time" && finalStop.et !== "Delayed" && finalStop.et !== "Cancelled" ? finalStop.et : finalStop.st;
            if (targetStop) {
              destName = targetStop.locationName;
            }
          } else {
            arrTime = depTime;
          }
        }

        if (depTime && arrTime && depTime.includes(':') && arrTime.includes(':')) {
          const [depH, depM] = depTime.split(':').map(Number);
          const [arrH, arrM] = arrTime.split(':').map(Number);

          let depTotalMins = depH * 60 + depM;
          let arrTotalMins = arrH * 60 + arrM;

          if (arrTotalMins < depTotalMins) {
            arrTotalMins += 24 * 60;
          }
          duration = arrTotalMins - depTotalMins;
        }

        return {
          id: s.serviceID,
          time: depTime || s.std,
          destination: destName,
          status: depStatus || "On time",
          platform: s.platform || "TBC",
          duration: duration,
          eta: arrTime || depTime || s.std,
          stops: allStops.map((cp: any) => {
            let time = cp.st || "";
            if (cp.et && cp.et !== "On time" && cp.et !== "Delayed" && cp.et !== "Cancelled") time = cp.et;
            return time ? `${cp.locationName} (${time})` : cp.locationName;
          }) || []
        };
      });

      if (dest) {
        results[dest] = formattedServices;
      } else {
        results["all"] = formattedServices;
      }
    }
  }

  // If no services were loaded at all (e.g. failure for all endpoints), throw so it handles error cleanly
  if (Object.keys(results).length === 0 || Object.values(results).every(val => val.length === 0)) {
    throw new Error("No services retrieved via REST API.");
  }

  return results;
}
