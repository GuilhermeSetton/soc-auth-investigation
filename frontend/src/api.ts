import type {
  AlertDetailResponse,
  AlertFilterParams,
  AlertItem,
  AlertStatus,
  Classification,
  EventFilterParams,
  EventItem,
  ImportResponse,
  Investigation,
  PaginatedResponse,
  Summary,
} from './types';

export const API_BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ||
  'http://127.0.0.1:8000/api';

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`API Error ${status}: ${detail}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText || 'Unknown error';
    try {
      const data = await res.json();
      if (data && typeof data.detail === 'string') {
        detail = data.detail;
      } else if (data && typeof data.detail === 'object') {
        detail = JSON.stringify(data.detail);
      }
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export async function fetchHealth(): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE_URL}/health`);
  return handleResponse<{ status: string }>(res);
}

export async function fetchSummary(): Promise<Summary> {
  const res = await fetch(`${API_BASE_URL}/summary`);
  return handleResponse<Summary>(res);
}

export async function uploadLogFile(file: File): Promise<ImportResponse> {
  if (file.size > 2 * 1024 * 1024) {
    throw new ApiError(413, 'File size exceeds client limit of 2 MiB');
  }

  const formData = new FormData();
  formData.append('file', file, file.name);

  const res = await fetch(`${API_BASE_URL}/imports`, {
    method: 'POST',
    body: formData,
  });
  return handleResponse<ImportResponse>(res);
}

export async function fetchEvents(
  params: EventFilterParams = {}
): Promise<PaginatedResponse<EventItem>> {
  const query = new URLSearchParams();
  if (params.source) query.set('source', params.source);
  if (params.username) query.set('username', params.username);
  if (params.outcome) query.set('outcome', params.outcome);
  if (params.from_time) query.set('from_time', params.from_time);
  if (params.to_time) query.set('to_time', params.to_time);
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));

  const qs = query.toString();
  const url = `${API_BASE_URL}/events${qs ? `?${qs}` : ''}`;
  const res = await fetch(url);
  return handleResponse<PaginatedResponse<EventItem>>(res);
}

export async function fetchAlerts(
  params: AlertFilterParams = {}
): Promise<PaginatedResponse<AlertItem>> {
  const query = new URLSearchParams();
  if (params.rule_id) query.set('rule_id', params.rule_id);
  if (params.status) query.set('status', params.status);
  if (params.source) query.set('source', params.source);
  if (params.from_time) query.set('from_time', params.from_time);
  if (params.to_time) query.set('to_time', params.to_time);
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));

  const qs = query.toString();
  const url = `${API_BASE_URL}/alerts${qs ? `?${qs}` : ''}`;
  const res = await fetch(url);
  return handleResponse<PaginatedResponse<AlertItem>>(res);
}

export async function fetchAlertDetail(alertId: string): Promise<AlertDetailResponse> {
  const res = await fetch(`${API_BASE_URL}/alerts/${alertId}`);
  return handleResponse<AlertDetailResponse>(res);
}

export async function updateInvestigation(
  alertId: string,
  body: {
    status: AlertStatus;
    classification: Classification;
    notes: string;
  }
): Promise<Investigation> {
  const res = await fetch(`${API_BASE_URL}/alerts/${alertId}/investigation`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return handleResponse<Investigation>(res);
}

export async function downloadReport(alertId: string, format: 'json' | 'markdown'): Promise<void> {
  const url = `${API_BASE_URL}/alerts/${alertId}/report?format=${format}`;
  const res = await fetch(url);
  if (!res.ok) {
    let detail = res.statusText || 'Failed to download report';
    try {
      const err = await res.json();
      if (err.detail) detail = err.detail;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, detail);
  }

  const blob = await res.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `alert-${alertId}.${format === 'json' ? 'json' : 'md'}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(downloadUrl);
}
