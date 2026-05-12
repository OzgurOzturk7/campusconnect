/**
 * Public service barrel.
 *
 * Import from "../services" instead of reaching directly into supabase / fetch
 * from page code. See ./README.md for the rationale.
 */
export { authService } from "./auth";
export { storageService } from "./storage";
export {
  subscribeToTable,
  subscribeToBroadcast,
  broadcast,
  type PostgresEvent,
  type PostgresChangePayload,
  type Subscription,
} from "./realtime";
