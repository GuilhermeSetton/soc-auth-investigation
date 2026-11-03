import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import * as api from '../api';

describe('App Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockSummary = {
    events: 35,
    alerts: 6,
    open_alerts: 6,
    successful_authentications: 8,
    failed_authentications: 27,
  };

  it('loads health and summary on mount and renders global metrics', async () => {
    vi.spyOn(api, 'fetchHealth').mockResolvedValueOnce({ status: 'ok' });
    vi.spyOn(api, 'fetchSummary').mockResolvedValueOnce(mockSummary);
    vi.spyOn(api, 'fetchAlerts').mockResolvedValueOnce({ items: [], total: 0 });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('API: Connected (127.0.0.1:8000)')).toBeInTheDocument();
      expect(screen.getByText('Global Metrics (System-wide, unaffected by view filters)')).toBeInTheDocument();
    });

    // Check metric values
    expect(screen.getAllByText('35').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('27')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('switches navigation tabs between Alerts, Events, and Ingest Logs', async () => {
    vi.spyOn(api, 'fetchHealth').mockResolvedValue({ status: 'ok' });
    vi.spyOn(api, 'fetchSummary').mockResolvedValue(mockSummary);
    vi.spyOn(api, 'fetchAlerts').mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(api, 'fetchEvents').mockResolvedValue({ items: [], total: 0 });

    render(<App />);

    // Default tab is Alerts
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Alerts & Triage/i })).toHaveClass('active');
    });

    // Switch to All Events tab
    const eventsTab = screen.getByRole('tab', { name: /All Events/i });
    await userEvent.click(eventsTab);
    expect(eventsTab).toHaveClass('active');
    expect(screen.getByRole('heading', { name: /Authentication Events Log/i })).toBeInTheDocument();

    // Switch to Ingest Logs tab
    const importTab = screen.getByRole('tab', { name: /Ingest Logs/i });
    await userEvent.click(importTab);
    expect(importTab).toHaveClass('active');
    expect(screen.getByRole('heading', { name: /Import OpenSSH Authentication Logs/i })).toBeInTheDocument();
  });

  it('protects unsaved notes and retains alert selection across tab switches (F1 & F3)', async () => {
    const mockAlerts = [
      {
        id: 'alert-1',
        rule_id: 'repeated_failures' as const,
        rule_version: 1,
        source: '198.51.100.7',
        timestamp: '2026-10-01T12:12:00Z',
        title: 'Repeated failed logins from one source',
        reason: '5 failures in 300s',
        false_positives: ['Fat finger'],
        event_count: 5,
        status: 'open' as const,
      },
      {
        id: 'alert-2',
        rule_id: 'success_after_failures' as const,
        rule_version: 1,
        source: '192.0.2.88',
        timestamp: '2026-10-01T12:33:00Z',
        title: 'Successful login after repeated failures',
        reason: '3 failures then success',
        false_positives: ['Password reset'],
        event_count: 4,
        status: 'in_progress' as const,
      },
    ];

    vi.spyOn(api, 'fetchHealth').mockResolvedValue({ status: 'ok' });
    vi.spyOn(api, 'fetchSummary').mockResolvedValue(mockSummary);
    vi.spyOn(api, 'fetchAlerts').mockResolvedValue({ items: mockAlerts, total: 2 });
    vi.spyOn(api, 'fetchAlertDetail').mockImplementation(async (id) => {
      const a = mockAlerts.find((item) => item.id === id) || mockAlerts[0];
      return {
        alert: a,
        events: [],
        investigation: {
          alert_id: a.id,
          status: a.status,
          classification: 'unclassified' as const,
          notes: '',
        },
      };
    });

    render(<App />);

    // Wait for alerts to load and select the second alert
    await waitFor(() => {
      expect(screen.getByText('Successful login after repeated failures')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Successful login after repeated failures'));

    // Wait for AlertDetail of second alert to load
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Analyst Assessment & Notes/i })).toBeInTheDocument();
    });

    // Type draft text into investigation notes
    const textarea = screen.getByRole('textbox', { name: /Analyst Assessment & Notes/i });
    await userEvent.type(textarea, 'Draft analysis for incident 192.0.2.88');
    expect(textarea).toHaveValue('Draft analysis for incident 192.0.2.88');

    // Attempt to switch to "All Events" tab while unsaved
    const eventsTab = screen.getByRole('tab', { name: /All Events/i });
    await userEvent.click(eventsTab);

    // Confirmation modal MUST be shown to protect unsaved notes
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Unsaved Investigation Changes/i)).toBeInTheDocument();

    const keepBtn = screen.getByRole('button', { name: /Keep Editing/i });
    const discardBtn = screen.getByRole('button', { name: /Discard & Switch/i });

    // Initial focus must be on Keep Editing
    expect(keepBtn).toHaveFocus();

    // Tab cycles between modal buttons and does not leave modal
    await userEvent.keyboard('{Tab}');
    expect(discardBtn).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    expect(keepBtn).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    expect(discardBtn).toHaveFocus();

    // Shift+Tab cycles backwards
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(keepBtn).toHaveFocus();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(discardBtn).toHaveFocus();

    // Escape closes modal and returns focus to the tab button that triggered the switch
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(eventsTab).toHaveFocus();
    expect(screen.getByRole('textbox', { name: /Analyst Assessment & Notes/i })).toHaveValue(
      'Draft analysis for incident 192.0.2.88'
    );

    // Selected alert must still be alert-2
    expect(
      screen.getByRole('heading', { name: 'Successful login after repeated failures' })
    ).toBeInTheDocument();

    // Click "All Events" again -> modal appears
    await userEvent.click(eventsTab);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Click Keep Editing -> returns focus to eventsTab
    await userEvent.click(screen.getByRole('button', { name: /Keep Editing/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(eventsTab).toHaveFocus();

    // Click "All Events" again and choose "Discard & Switch"
    await userEvent.click(eventsTab);
    const discardBtn2 = screen.getByRole('button', { name: /Discard & Switch/i });
    await userEvent.click(discardBtn2);

    // Now tab switches to All Events and focus moves to the active tab button
    expect(eventsTab).toHaveClass('active');
    expect(eventsTab).toHaveFocus();
    expect(screen.getByRole('heading', { name: /Authentication Events Log/i })).toBeInTheDocument();

    // Switch back to Alerts & Triage tab
    const alertsTab = screen.getByRole('tab', { name: /Alerts & Triage/i });
    await userEvent.click(alertsTab);

    // F3: Selected alert is preserved (still alert-2), did NOT revert to first alert!
    expect(
      screen.getByRole('heading', { name: 'Successful login after repeated failures' })
    ).toBeInTheDocument();
  });
});
