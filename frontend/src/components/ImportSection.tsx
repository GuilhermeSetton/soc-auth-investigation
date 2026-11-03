import React, { useState } from 'react';
import { uploadLogFile } from '../api';
import type { ImportResponse } from '../types';

interface ImportSectionProps {
  onImportSuccess: (result: ImportResponse) => void;
}

export const ImportSection: React.FC<ImportSectionProps> = ({ onImportSuccess }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ImportResponse | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.size > 2 * 1024 * 1024) {
        setError(
          `File size exceeds 2 MiB limit (${(file.size / (1024 * 1024)).toFixed(2)} MiB). Upload rejected.`
        );
        setSelectedFile(null);
        e.target.value = '';
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setError('Please select a file to import.');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const result = await uploadLogFile(selectedFile);
      setLastResult(result);
      setSelectedFile(null);
      // Reset input element
      const inputEl = document.getElementById('log-file-input') as HTMLInputElement | null;
      if (inputEl) inputEl.value = '';
      onImportSuccess(result);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred during upload.');
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="card" aria-labelledby="import-title">
      <div className="card-header">
        <h2 id="import-title" className="card-title">
          Import OpenSSH Authentication Logs
        </h2>
      </div>

      <div className="card-body">
        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '14px',
            marginBottom: '20px',
            fontSize: '13px',
          }}
        >
          <h3
            style={{
              fontSize: '13px',
              fontWeight: 700,
              color: 'var(--accent-blue)',
              marginBottom: '6px',
            }}
          >
            Log Format Guidelines
          </h3>
          <ul style={{ paddingLeft: '20px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            <li>
              <strong>Timestamp requirement:</strong> Strict RFC3339 prefix with explicit timezone
              offset (e.g.{' '}
              <code className="font-mono">2026-10-01T12:00:00Z</code> or{' '}
              <code className="font-mono">+00:00</code>).
            </li>
            <li>
              <strong>Content:</strong> One OpenSSH authentication event per line (Failed/Accepted
              password/publickey).
            </li>
            <li>
              <strong>Encoding:</strong> Strict UTF-8 without byte-order mark (BOM).
            </li>
            <li>
              <strong>File limits:</strong> Maximum 2 MiB file size, maximum 10,000 lines, maximum 8
              KiB per line.
            </li>
            <li>
              <strong>Deduplication:</strong> Repeated events (identical SHA-256 line hash) are
              silently deduplicated and counted.
            </li>
          </ul>
        </div>

        <form onSubmit={handleUpload} style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label
              htmlFor="log-file-input"
              className="form-label"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
              }}
            >
              Select Log File:
              <input
                id="log-file-input"
                type="file"
                accept=".log,.txt"
                onChange={handleFileChange}
                disabled={uploading}
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px',
                }}
              />
            </label>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={!selectedFile || uploading}
              aria-busy={uploading}
            >
              {uploading ? (
                <>
                  <span className="spinner" style={{ width: '14px', height: '14px' }} />
                  Processing Import…
                </>
              ) : (
                'Upload & Ingest'
              )}
            </button>
          </div>

          {selectedFile && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              Selected: <strong>{selectedFile.name}</strong> (
              {(selectedFile.size / 1024).toFixed(1)} KB)
            </div>
          )}
        </form>

        {error && (
          <div
            className="state-box error"
            role="alert"
            style={{ marginBottom: '20px', textAlign: 'left', alignItems: 'flex-start' }}
          >
            <strong>Import Error:</strong>
            <div>{error}</div>
          </div>
        )}

        {lastResult && (
          <div
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '16px',
            }}
          >
            <h3
              style={{
                fontSize: '14px',
                fontWeight: 700,
                color: 'var(--success)',
                marginBottom: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>✓</span> Ingestion Summary: {lastResult.filename}
            </h3>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '12px',
                marginBottom: '16px',
              }}
            >
              <div className="metric-card">
                <div className="metric-label">Total Lines</div>
                <div className="metric-value">{lastResult.total_lines}</div>
              </div>

              <div className="metric-card">
                <div className="metric-label">Imported Events</div>
                <div className="metric-value success">{lastResult.imported_events}</div>
              </div>

              <div className="metric-card">
                <div className="metric-label">Duplicates</div>
                <div className="metric-value">{lastResult.duplicate_events}</div>
              </div>

              <div className="metric-card">
                <div className="metric-label">Invalid Lines</div>
                <div
                  className={`metric-value ${lastResult.invalid_lines.length > 0 ? 'failed' : ''}`}
                >
                  {lastResult.invalid_lines.length}
                </div>
              </div>
            </div>

            {lastResult.invalid_lines.length > 0 && (
              <div>
                <h4
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--warning)',
                    textTransform: 'uppercase',
                    marginBottom: '8px',
                    letterSpacing: '0.04em',
                  }}
                >
                  Invalid Lines Detected ({lastResult.invalid_lines.length})
                </h4>
                <div className="data-table-wrapper" style={{ maxHeight: '240px' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="col-line" style={{ width: '100px' }}>Line #</th>
                        <th>Rejection Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lastResult.invalid_lines.map((inv, idx) => (
                        <tr key={idx}>
                          <td className="font-mono col-line">#{inv.line_number}</td>
                          <td>
                            <code className="font-mono" style={{ color: 'var(--warning)' }}>
                              {inv.reason}
                            </code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
