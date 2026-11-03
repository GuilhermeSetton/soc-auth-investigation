import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchHealth,
  fetchSummary,
  uploadLogFile,
  fetchEvents,
  fetchAlerts,
  updateInvestigation,
  downloadReport,
  ApiError,
} from '../api';

describe('API Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchHealth returns status ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ok' }),
    } as Response);

    const res = await fetchHealth();
    expect(res).toEqual({ status: 'ok' });
  });

  it('fetchHealth throws ApiError on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({ detail: 'Database unavailable' }),
    } as Response);

    await expect(fetchHealth()).rejects.toThrow('API Error 503: Database unavailable');
  });

  it('fetchSummary returns system counters', async () => {
    const mockSummary = {
      events: 35,
      alerts: 6,
      open_alerts: 6,
      successful_authentications: 8,
      failed_authentications: 27,
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockSummary,
    } as Response);

    const res = await fetchSummary();
    expect(res).toEqual(mockSummary);
  });

  it('uploadLogFile rejects files larger than 2 MiB before network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const largeBlob = new Blob([new Uint8Array(2 * 1024 * 1024 + 10)]);
    const file = new File([largeBlob], 'too-large.log');

    await expect(uploadLogFile(file)).rejects.toThrow(ApiError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uploadLogFile sends multipart form data and parses result', async () => {
    const mockResponse = {
      id: 'import-uuid-1',
      filename: 'sample.log',
      total_lines: 10,
      imported_events: 8,
      duplicate_events: 1,
      invalid_lines: [{ line_number: 5, reason: 'invalid_timestamp' }],
    };

    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url, init) => {
      expect(String(url)).toContain('/api/imports');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeInstanceOf(FormData);
      return {
        ok: true,
        json: async () => mockResponse,
      } as Response;
    });

    const file = new File(['valid log content'], 'sample.log', { type: 'text/plain' });
    const res = await uploadLogFile(file);
    expect(res).toEqual(mockResponse);
  });

  it('fetchEvents builds correct query string with limits and filters', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url) => {
      const parsedUrl = new URL(String(url));
      expect(parsedUrl.pathname).toBe('/api/events');
      expect(parsedUrl.searchParams.get('source')).toBe('192.0.2.1');
      expect(parsedUrl.searchParams.get('outcome')).toBe('failure');
      expect(parsedUrl.searchParams.get('limit')).toBe('25');
      expect(parsedUrl.searchParams.get('offset')).toBe('50');
      return {
        ok: true,
        json: async () => ({ items: [], total: 0 }),
      } as Response;
    });

    await fetchEvents({
      source: '192.0.2.1',
      outcome: 'failure',
      limit: 25,
      offset: 50,
    });
  });

  it('fetchAlerts serializes rule and status params', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url) => {
      const parsedUrl = new URL(String(url));
      expect(parsedUrl.pathname).toBe('/api/alerts');
      expect(parsedUrl.searchParams.get('rule_id')).toBe('repeated_failures');
      expect(parsedUrl.searchParams.get('status')).toBe('open');
      return {
        ok: true,
        json: async () => ({ items: [], total: 0 }),
      } as Response;
    });

    await fetchAlerts({
      rule_id: 'repeated_failures',
      status: 'open',
    });
  });

  it('updateInvestigation sends PATCH with JSON body', async () => {
    const updatedInv = {
      alert_id: 'alert-1',
      status: 'closed' as const,
      classification: 'benign' as const,
      notes: 'Verified scheduled backup task.',
      updated_at: '2026-10-01T12:00:00Z',
    };

    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url, init) => {
      expect(String(url)).toContain('/api/alerts/alert-1/investigation');
      expect(init?.method).toBe('PATCH');
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(init?.body as string)).toEqual({
        status: 'closed',
        classification: 'benign',
        notes: 'Verified scheduled backup task.',
      });
      return {
        ok: true,
        json: async () => updatedInv,
      } as Response;
    });

    const res = await updateInvestigation('alert-1', {
      status: 'closed',
      classification: 'benign',
      notes: 'Verified scheduled backup task.',
    });
    expect(res).toEqual(updatedInv);
  });

  it('downloadReport triggers browser download', async () => {
    const mockBlob = new Blob(['# Report content'], { type: 'text/markdown' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      blob: async () => mockBlob,
    } as Response);

    const createObjectURLMock = vi.fn().mockReturnValue('blob:http://localhost/uuid');
    const revokeObjectURLMock = vi.fn();
    window.URL.createObjectURL = createObjectURLMock;
    window.URL.revokeObjectURL = revokeObjectURLMock;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadReport('alert-123', 'markdown');

    expect(createObjectURLMock).toHaveBeenCalledWith(mockBlob);
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost/uuid');
  });
});
