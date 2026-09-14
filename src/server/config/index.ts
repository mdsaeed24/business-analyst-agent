import "server-only";
import { validateServerEnv } from "./env";

// Lazy validation keeps builds and liveness independent of database configuration.
export function getServerEnv() {
  return validateServerEnv(process.env);
}
