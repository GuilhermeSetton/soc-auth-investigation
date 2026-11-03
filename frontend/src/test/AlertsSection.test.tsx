import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertsSection } from '../components/AlertsSection';
import * as api from '../api';
import type { AlertItem } from '../types';

describe('AlertsSection Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockAlerts: AlertItem[] = [
    {
      id: 'alert-1',
      rule_id: 'repeated_failures',
      rule_version: 1,
      source: '192.0.2.10',
      timestamp: '2026-10-01T12:05:00Z',
      title: 'Repeated failures from 192.0.2.10',
      reason: '5 failures in 300s',
      false_positives: ['Fat finger'],
      event_count: 5,
      status: 'open',
    },
    {
      id: 'alert-2',
      rule_id: 'multiple_users',
      rule_version: 1,
      source: '192.0.2.20',
      timestamp: '2026-10-01T12:10:00Z',
      title: 'Multiple users targeted from 192.0.2.20',
      reason: '5 users targeted in 300s',
      false_positives: ['Internal scanner'],
      event_count: 8,
      status: 'in_progress',
    },
  ];

  it('renders alerts list and triage disclaimer notice', async () => {
    vi.spyOn(api, 'fetchAlerts').mockResolvedValueOnce({
      items: mockAlerts,
      total: 2,
    });
    vi.spyOn(api, 'fetchAlertDetail').mockResolvedValue({
      alert: mockAlerts[0],
      events: [],
      investigation: {
        alert_id: 'alert-1',
        status: 'open',
        classification: 'unclassified',
        notes: '',
      },
    });

    render(<AlertsSection onInvestigationSaved={vi.fn()} refreshTrigger={0} />);

    // Triage disclaimer check
    expect(
      screen.getByText(/An alert does not confirm intrusion or system compromise/i)
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Repeated failures from 192.0.2.10')).toBeInTheDocument();
      expect(screen.getByText('Multiple users targeted from 192.0.2.20')).toBeInTheDocument();
    });
  });

  it('protects unsaved changes: switching alert prompts modal with discard or keep editing', async () => {
    vi.spyOn(api, 'fetchAlerts').mockResolvedValue({
      items: mockAlerts,
      total: 2,
    });
    vi.spyOn(api, 'fetchAlertDetail').mockImplementation(async (id) => {
      const al = mockAlerts.find((a) => a.id === id) || mockAlerts[0];
      return {
        alert: al,
        events: [],
        investigation: {
          alert_id: al.id,
          status: al.status,
          classification: 'unclassified',
          notes: 'Saved note for ' + al.id,
        },
      };
    });

    render(<AlertsSection onInvestigationSaved={vi.fn()} refreshTrigger={0} />);

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Analyst Assessment & Notes/i })).toBeInTheDocument();
    });

    // Make an unsaved edit
    const textarea = screen.getByRole('textbox', { name: /Analyst Assessment & Notes/i });
    await userEvent.type(textarea, ' unsaved modifications');

    // Try to click second alert
    const secondAlertCard = screen.getByText('Multiple users targeted from 192.0.2.20');
    await userEvent.click(secondAlertCard);

    // Modal must appear
    expect(screen.getByText(/Unsaved Investigation Changes/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Switching to another alert will discard these changes/i)
    ).toBeInTheDocument();

    const keepBtn = screen.getByRole('button', { name: /Keep Editing/i });
    const discardBtn = screen.getByRole('button', { name: /Discard & Switch/i });

    // Initial focus must be on Keep Editing
    expect(keepBtn).toHaveFocus();

    // Focus trap: Tab cycles between modal buttons and does not leave modal
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

    // Escape closes modal and returns focus to the trigger button without discarding
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText(/Unsaved Investigation Changes/i)).not.toBeInTheDocument();
    const secondAlertOption = screen.getByRole('option', { name: /Multiple users targeted from 192.0.2.20/i });
    expect(secondAlertOption).toHaveFocus();
    expect(textarea).toHaveValue('Saved note for alert-1 unsaved modifications');

    // Reopen modal by clicking second alert card
    await userEvent.click(secondAlertOption);
    expect(screen.getByText(/Unsaved Investigation Changes/i)).toBeInTheDocument();

    // Click "Keep Editing" -> modal closes and focus returns to the trigger button
    await userEvent.click(screen.getByRole('button', { name: /Keep Editing/i }));
    expect(screen.queryByText(/Unsaved Investigation Changes/i)).not.toBeInTheDocument();
    expect(secondAlertOption).toHaveFocus();

    // Open modal again and click Discard & Switch
    await userEvent.click(secondAlertOption);
    const discardBtn2 = screen.getByRole('button', { name: /Discard & Switch/i });
    await userEvent.click(discardBtn2);

    // Now second alert detail should load and focus should be on the new alert button
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Multiple users targeted from 192.0.2.20' })).toBeInTheDocument();
    });
    expect(secondAlertOption).toHaveFocus();
  });
});
