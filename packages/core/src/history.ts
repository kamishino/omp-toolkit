export type HistoryEventKind =
  | "route_check"
  | "policy_change"
  | "manual_intervention"
  | "restore"
  | "incident"
  | "incident_resolved"
  | "alert"
  | "session_start";

export interface HistoryEvent {
  at: number;
  machineId: string;
  kind: HistoryEventKind;
  provider?: string;
  account?: string;
  status?: string;
  incidentId?: string;
  detail?: string;
}
