export const API_VERSION = "v1";

export type HealthStatus = {
  status: "ok";
  service: string;
  version: string;
  timestamp: string;
  database: "connected" | "disconnected" | "connecting" | "unknown";
};
