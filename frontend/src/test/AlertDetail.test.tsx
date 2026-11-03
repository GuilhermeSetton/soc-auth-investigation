import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertDetail } from '../components/AlertDetail';
import * as api from '../api';
import type { AlertDetailResponse } from '../types';

describe('AlertDetail Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockDetail: AlertDetailResponse = {
    alert: {
      id: 'alert-1',
      rule_id: 'repeated_failures',
      rule_version: 1,
      source: '192.0.2.10',
      timestamp: '2026-10-01T12:05:00Z',
      title: 'Repeated authentication failures (5 events)',
      reason: 'Observed 5 failed authentication attempts from 192.0.2.10 within 300 seconds.',
      false_positives: ['User forgot password', 'Automated healthcheck without updated key'],
      event_count: 5,
      status: 'open',
    },
    events: [
      {
        id: 'evt-1',
        timestamp: '2026-10-01T12:00:00Z',
        host: 'lab',
        source: '192.0.2.10',
        username: 'alice',
        outcome: 'failure',
        method: 'password',
        import_id: null, // Known backend v1 bug/behavior: import_id is null
        line_number: 1,
        raw_line: '2026-10-01T12:00:00Z lab sshd[101]: Failed password for alice from 192.0.2.10 port 50000 ssh2',
      },
    ],
    investigation: {
      alert_id: 'alert-1',
      status: 'open',
      classification: 'unclassified',
      notes: 'Initial triage pending.',
      updated_at: '2026-10-01T12:05:00Z',
    },
  };

  it('renders alert details, justification, and timeline with null import_id handled cleanly', async () => {
    vi.spyOn(api, 'fetchAlertDetail').mockResolvedValueOnce(mockDetail);
    const onSaved = vi.fn();
    const onUnsavedStatusChange = vi.fn();

    render(
      <AlertDetail
        alertId="alert-1"
        onInvestigationSaved={onSaved}
        onUnsavedStatusChange={onUnsavedStatusChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Repeated authentication failures (5 events)')).toBeInTheDocument();
      expect(screen.getByText(/Observed 5 failed authentication attempts/i)).toBeInTheDocument();
      expect(screen.getByText(/User forgot password/i)).toBeInTheDocument();
    });

    // Check handling of null import_id
    expect(screen.getByText('Unavailable')).toBeInTheDocument();

    // Check investigation notes loaded
    const textarea = screen.getByRole('textbox', { name: /Analyst Assessment & Notes/i });
    expect(textarea).toHaveValue('Initial triage pending.');
  });

  it('allows updating investigation status, classification, and notes, and calls PATCH API', async () => {
    vi.spyOn(api, 'fetchAlertDetail').mockResolvedValueOnce(mockDetail);
    const patchSpy = vi.spyOn(api, 'updateInvestigation').mockResolvedValueOnce({
      alert_id: 'alert-1',
      status: 'in_progress',
      classification: 'suspicious',
      notes: 'Correlating with firewall logs for 192.0.2.10.',
      updated_at: '2026-10-01T12:10:00Z',
    });

    const onSaved = vi.fn();
    const onUnsavedStatusChange = vi.fn();

    render(
      <AlertDetail
        alertId="alert-1"
        onInvestigationSaved={onSaved}
        onUnsavedStatusChange={onUnsavedStatusChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Analyst Assessment & Notes/i })).toBeInTheDocument();
    });

    // Change status
    const statusSelect = screen.getByLabelText(/Triage Status/i);
    await userEvent.selectOptions(statusSelect, 'in_progress');

    // Change classification
    const classSelect = screen.getByLabelText(/Incident Classification/i);
    await userEvent.selectOptions(classSelect, 'suspicious');

    // Update notes
    const textarea = screen.getByRole('textbox', { name: /Analyst Assessment & Notes/i });
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'Correlating with firewall logs for 192.0.2.10.');

    expect(onUnsavedStatusChange).toHaveBeenCalledWith(true);

    // Save
    const saveBtn = screen.getByRole('button', { name: /Save Investigation/i });
    await userEvent.click(saveBtn);

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith('alert-1', {
        status: 'in_progress',
        classification: 'suspicious',
        notes: 'Correlating with firewall logs for 192.0.2.10.',
      });
      expect(screen.getByText(/Investigation saved successfully/i)).toBeInTheDocument();
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it('triggers report download for JSON and Markdown formats', async () => {
    vi.spyOn(api, 'fetchAlertDetail').mockResolvedValueOnce(mockDetail);
    const downloadSpy = vi.spyOn(api, 'downloadReport').mockResolvedValue(undefined);

    render(
      <AlertDetail
        alertId="alert-1"
        onInvestigationSaved={vi.fn()}
        onUnsavedStatusChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Export JSON/i })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /Export JSON/i }));
    expect(downloadSpy).toHaveBeenCalledWith('alert-1', 'json');

    await userEvent.click(screen.getByRole('button', { name: /Export Markdown/i }));
    expect(downloadSpy).toHaveBeenCalledWith('alert-1', 'markdown');
  });

  it('does not update state or invoke callbacks when unmounted before PATCH resolves (N3)', async () => {
    let resolvePatch!: (value: any) => void;
    const delayedPromise = new Promise((resolve) => {
      resolvePatch = resolve;
    });

    vi.spyOn(api, 'fetchAlertDetail').mockResolvedValueOnce(mockDetail);
    const patchSpy = vi.spyOn(api, 'updateInvestigation').mockReturnValueOnce(delayedPromise as any);
    const onSaved = vi.fn();

    const { unmount } = render(
      <AlertDetail
        alertId="alert-1"
        onInvestigationSaved={onSaved}
        onUnsavedStatusChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Analyst Assessment & Notes/i })).toBeInTheDocument();
    });

    // Make changes and trigger save
    const textarea = screen.getByRole('textbox', { name: /Analyst Assessment & Notes/i });
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'Draft note during async save test');

    const saveBtn = screen.getByRole('button', { name: /Save Investigation/i });
    await userEvent.click(saveBtn);

    expect(patchSpy).toHaveBeenCalledWith('alert-1', expect.anything());

    // Unmount before PATCH resolves (simulating switching away to another alert)
    unmount();

    // Now resolve the PATCH response
    resolvePatch({
      alert_id: 'alert-1',
      status: 'open',
      classification: 'unclassified',
      notes: 'Draft note during async save test',
      updated_at: '2026-10-01T12:30:00Z',
    });

    // Allow any pending microtasks to flush
    await new Promise((r) => setTimeout(r, 10));

    // Callback must NOT be invoked after unmount
    expect(onSaved).not.toHaveBeenCalled();
  });
});
