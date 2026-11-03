import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventsSection } from '../components/EventsSection';
import * as api from '../api';
import type { EventItem } from '../types';

describe('EventsSection Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockEvents: EventItem[] = [
    {
      id: 'evt-1',
      timestamp: '2026-10-01T12:00:00Z',
      host: 'lab',
      source: '192.0.2.10',
      username: 'alice',
      outcome: 'failure',
      method: 'password',
      import_id: 'imp-1',
      line_number: 1,
      raw_line: '2026-10-01T12:00:00Z lab sshd[101]: Failed password for alice from 192.0.2.10 port 50000 ssh2',
    },
    {
      id: 'evt-2',
      timestamp: '2026-10-01T12:01:00Z',
      host: 'lab',
      source: '192.0.2.10',
      username: 'bob',
      outcome: 'success',
      method: 'publickey',
      import_id: 'imp-1',
      line_number: 2,
      raw_line: '2026-10-01T12:01:00Z lab sshd[102]: Accepted publickey for bob from 192.0.2.10 port 50001 ssh2',
    },
  ];

  it('renders events table with UTC timestamps and outcome badges', async () => {
    vi.spyOn(api, 'fetchEvents').mockResolvedValueOnce({
      items: mockEvents,
      total: 2,
    });

    render(<EventsSection refreshTrigger={0} />);

    await waitFor(() => {
      expect(screen.getByText('2026-10-01T12:00:00Z')).toBeInTheDocument();
      expect(screen.getByText('alice')).toBeInTheDocument();
      expect(screen.getByText('bob')).toBeInTheDocument();
      expect(screen.getAllByText('192.0.2.10').length).toBeGreaterThanOrEqual(2);
    });

    expect(screen.getByText('failure')).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
  });

  it('filters events and triggers updated search queries', async () => {
    const fetchSpy = vi.spyOn(api, 'fetchEvents').mockResolvedValue({
      items: [mockEvents[0]],
      total: 1,
    });

    render(<EventsSection refreshTrigger={0} />);

    const sourceInput = screen.getByLabelText(/Source IP/i);
    await userEvent.type(sourceInput, '192.0.2.10');

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ source: '192.0.2.10' })
      );
    });
  });

  it('protects against XSS: renders malicious raw lines and usernames strictly as text', async () => {
    const maliciousPayload = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
    const xssEvent: EventItem = {
      id: 'evt-xss',
      timestamp: '2026-10-01T12:00:00Z',
      host: 'lab',
      source: '192.0.2.99',
      username: maliciousPayload,
      outcome: 'failure',
      method: 'password',
      import_id: null,
      line_number: 99,
      raw_line: `2026-10-01T12:00:00Z lab sshd[999]: Failed password for ${maliciousPayload} from 192.0.2.99 ssh2`,
    };

    vi.spyOn(api, 'fetchEvents').mockResolvedValueOnce({
      items: [xssEvent],
      total: 1,
    });

    render(<EventsSection refreshTrigger={0} />);

    await waitFor(() => {
      // Find element containing the string as text content
      const userEl = screen.getByText(maliciousPayload);
      expect(userEl).toBeInTheDocument();
      // Ensure no script or img tags were injected into DOM
      expect(document.querySelector('script[src]')).toBeNull();
      expect(document.querySelector('img[onerror]')).toBeNull();
    });
  });

  it('differentiates query errors (422) from empty results and does not show false 0 events or pagination (F4)', async () => {
    // 1. Initial success load
    vi.spyOn(api, 'fetchEvents').mockResolvedValueOnce({
      items: mockEvents,
      total: 2,
    });

    render(<EventsSection refreshTrigger={0} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Authentication Events Log \(2\)/i })).toBeInTheDocument();
      expect(screen.getByText(/Page 1 of 1/i)).toBeInTheDocument();
    });

    // 2. Simulate 422 error when from_time > to_time
    vi.spyOn(api, 'fetchEvents').mockRejectedValueOnce(
      new api.ApiError(422, 'from_time must be earlier than or equal to to_time')
    );

    const fromInput = screen.getByLabelText(/From Time \(UTC\)/i);
    fireEvent.change(fromInput, { target: { value: '2026-10-01T13:00:00Z' } });

    await waitFor(() => {
      expect(
        screen.getByText(/API Error 422: from_time must be earlier than or equal to to_time/i)
      ).toBeInTheDocument();
    });

    // F4 requirement: must NOT show (0) or Page 1 of 1 for nonexistent/failed query result
    expect(screen.queryByRole('heading', { name: /Authentication Events Log \(0\)/i })).toBeNull();
    expect(screen.queryByText(/Page 1 of 1/i)).toBeNull();

    // 3. User corrects the filter (or resets filters) -> recovers real query result
    vi.spyOn(api, 'fetchEvents').mockResolvedValueOnce({
      items: mockEvents,
      total: 2,
    });

    const resetBtn = screen.getByRole('button', { name: /Reset event filters/i });
    await userEvent.click(resetBtn);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Authentication Events Log \(2\)/i })).toBeInTheDocument();
      expect(screen.getByText(/Page 1 of 1/i)).toBeInTheDocument();
      expect(screen.queryByText(/API Error 422/i)).toBeNull();
    });
  });
});
