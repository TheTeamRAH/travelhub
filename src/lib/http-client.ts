import axios, { AxiosError } from "axios";
import dns from "node:dns";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";

const ipv4Lookup: typeof dns.lookup = (hostname, options, callback) => {
  if (typeof options === "function") {
    return dns.lookup(hostname, { family: 4 }, options);
  }

  return dns.lookup(
    hostname,
    {
      ...options,
      family: 4,
      all: false,
    },
    callback
  );
};

export const outboundHttpClient = axios.create({
  httpAgent: new HttpAgent({ lookup: ipv4Lookup }),
  httpsAgent: new HttpsAgent({ lookup: ipv4Lookup }),
});

export function describeRequestError(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : String(error);
  }

  const axiosError = error as AxiosError;
  const parts = [
    axiosError.message,
    axiosError.code ? `code=${axiosError.code}` : null,
    axiosError.response?.status ? `status=${axiosError.response.status}` : null,
    axiosError.config?.url ? `url=${axiosError.config.url}` : null,
  ].filter(Boolean);

  return parts.join(" | ");
}
