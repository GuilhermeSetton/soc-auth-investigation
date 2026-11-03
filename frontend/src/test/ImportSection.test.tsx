import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportSection } from '../components/ImportSection';
import * as api from '../api';
import type { ImportResponse } from '../types';

describe('ImportSection Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects files larger than 2 MiB on client selection', async () => {
    const onImportSuccess = vi.fn();
    render(<ImportSection onImportSuccess={onImportSuccess} />);

    // Create 2.1 MiB file
    const largeContent = new Uint8Array(2.1 * 1024 * 1024);
    const file = new File([largeContent], 'heavy.log', { type: 'text/plain' });

    const input = screen.getByLabelText(/Select Log File/i) as HTMLInputElement;
    await userEvent.upload(input, file);

    expect(
      screen.getByText(/File size exceeds 2 MiB limit/i)
    ).toBeInTheDocument();
    expect(onImportSuccess).not.toHaveBeenCalled();
  });

  it('uploads valid log file and displays summary metrics with invalid lines table', async () => {
    const onImportSuccess = vi.fn();
    const mockResult: ImportResponse = {
      id: 'import-123',
      filename: 'auth.log',
      total_lines: 35,
      imported_events: 30,
      duplicate_events: 3,
      invalid_lines: [
        { line_number: 4, reason: 'unsupported_message' },
        { line_number: 12, reason: 'invalid_timestamp' },
      ],
    };

    vi.spyOn(api, 'uploadLogFile').mockResolvedValueOnce(mockResult);

    render(<ImportSection onImportSuccess={onImportSuccess} />);

    const validContent = '2026-10-01T12:00:00Z lab sshd[1]: Failed password for root...';
    const file = new File([validContent], 'auth.log', { type: 'text/plain' });

    const input = screen.getByLabelText(/Select Log File/i) as HTMLInputElement;
    await userEvent.upload(input, file);

    const uploadBtn = screen.getByRole('button', { name: /Upload & Ingest/i });
    await userEvent.click(uploadBtn);

    await waitFor(() => {
      expect(screen.getByText(/Ingestion Summary: auth.log/i)).toBeInTheDocument();
    });

    expect(screen.getByText('30')).toBeInTheDocument(); // imported
    expect(screen.getByText('3')).toBeInTheDocument(); // duplicates
    expect(screen.getByText('2')).toBeInTheDocument(); // invalid lines count

    // Check invalid lines rendered
    expect(screen.getByText('#4')).toBeInTheDocument();
    expect(screen.getByText('unsupported_message')).toBeInTheDocument();
    expect(screen.getByText('#12')).toBeInTheDocument();
    expect(screen.getByText('invalid_timestamp')).toBeInTheDocument();

    expect(onImportSuccess).toHaveBeenCalledWith(mockResult);
  });

  it('displays API error message when upload fails', async () => {
    const onImportSuccess = vi.fn();
    vi.spyOn(api, 'uploadLogFile').mockRejectedValueOnce(
      new Error('File must be valid UTF-8; nothing was imported')
    );

    render(<ImportSection onImportSuccess={onImportSuccess} />);

    const file = new File(['corrupted'], 'broken.log', { type: 'text/plain' });
    const input = screen.getByLabelText(/Select Log File/i) as HTMLInputElement;
    await userEvent.upload(input, file);

    const uploadBtn = screen.getByRole('button', { name: /Upload & Ingest/i });
    await userEvent.click(uploadBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/File must be valid UTF-8; nothing was imported/i)
      ).toBeInTheDocument();
    });
  });
});
