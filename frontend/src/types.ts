/**
 * Type definitions matching SOC Auth Investigation API (contract v1).
 */

export type Outcome = 'failure' | 'success';

export type RuleId = 'repeated_failures' | 'multiple_users' | 'success_after_failures';

export type AlertStatus = 'open' | 'in_progress' | 'closed';

export type Classification = 'unclassified' | 'benign' | 'suspicious' | 'confirmed_incident';

export interface Summary {
  events: number;
  alerts: number;
  open_alerts: number;
  successful_authentications: number;
  failed_authentications: number;
}

export interface EventItem {
  id: string;
  timestamp: string; // RFC3339 UTC string
  host: string;
  source: string;
  username: string;
  outcome: Outcome;
  method: string;
  import_id: string | null;
  line_number: number;
  raw_line: string;
}

export interface AlertItem {
  id: string;
  rule_id: RuleId;
  rule_version: number;
  source: string;
  timestamp: string;
  title: string;
  reason: string;
  false_positives: string[];
  event_count: number;
  status: AlertStatus;
}

export interface Investigation {
  alert_id: string;
  status: AlertStatus;
  classification: Classification;
  notes: string;
  updated_at?: string;
}

export interface AlertDetailResponse {
  alert: AlertItem;
  events: EventItem[];
  investigation: Investigation;
}

export interface InvalidLine {
  line_number: number;
  reason: string;
}

export interface ImportResponse {
  id: string;
  filename: string;
  total_lines: number;
  imported_events: number;
  duplicate_events: number;
  invalid_lines: InvalidLine[];
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
}

export interface EventFilterParams {
  source?: string;
  username?: string;
  outcome?: Outcome;
  from_time?: string;
  to_time?: string;
  limit?: number;
  offset?: number;
}

export interface AlertFilterParams {
  rule_id?: RuleId;
  status?: AlertStatus;
  source?: string;
  from_time?: string;
  to_time?: string;
  limit?: number;
  offset?: number;
}
