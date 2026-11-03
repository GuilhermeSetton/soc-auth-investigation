import React, { useEffect, useRef, useState } from 'react';
import { downloadReport, fetchAlertDetail, updateInvestigation } from '../api';
import type {
  AlertDetailResponse,
  AlertStatus,
  Classification,
  Investigation,
} from '../types';

interface AlertDetailProps {
  alertId: string;
  onInvestigationSaved: () => void;
  onUnsavedStatusChange: (isDirty: boolean) => void;
  discardTrigger?: number;
}

export const AlertDetail: React.FC<AlertDetailProps> = ({
  alertId,
  onInvestigationSaved,
  onUnsavedStatusChange,
  discardTrigger,
}) => {
  const [data, setData] = useState<AlertDetailResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [status, setStatus] = useState<AlertStatus>('open');
  const [classification, setClassification] = useState<Classification>('unclassified');
  const [notes, setNotes] = useState<string>('');

  // Persisted baseline to detect unsaved changes
  const [savedInvestigation, setSavedInvestigation] = useState<Investigation | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Export states
  const [exportingMd, setExportingMd] = useState<boolean>(false);
  const [exportingJson, setExportingJson] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Compute if form has unsaved modifications
  const isDirty = Boolean(
    savedInvestigation &&
      (status !== savedInvestigation.status ||
        classification !== savedInvestigation.classification ||
        notes !== savedInvestigation.notes)
  );

  useEffect(() => {
    onUnsavedStatusChange(isDirty);
  }, [isDirty, onUnsavedStatusChange]);

  useEffect(() => {
    if (discardTrigger !== undefined && discardTrigger > 0 && savedInvestigation) {
      setStatus(savedInvestigation.status);
      setClassification(savedInvestigation.classification);
      setNotes(savedInvestigation.notes || '');
    }
  }, [discardTrigger, savedInvestigation]);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    setSaveSuccessMessage(null);
    setSaveError(null);
    setExportError(null);

    fetchAlertDetail(alertId)
      .then((res) => {
        if (!isMounted) return;
        setData(res);
        const inv = res.investigation || {
          alert_id: alertId,
          status: 'open',
          classification: 'unclassified',
          notes: '',
        };
        setStatus(inv.status);
        setClassification(inv.classification);
        setNotes(inv.notes || '');
        setSavedInvestigation(inv);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to load alert details.');
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [alertId]);

  const isMountedRef = useRef<boolean>(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleSaveInvestigation = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveSuccessMessage(null);

    try {
      const updated = await updateInvestigation(alertId, {
        status,
        classification,
        notes,
      });
      if (!isMountedRef.current) return;
      setSavedInvestigation(updated);
      setSaveSuccessMessage('Investigation saved successfully.');
      onInvestigationSaved();
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      if (err instanceof Error) {
        setSaveError(err.message);
      } else {
        setSaveError('Failed to save investigation.');
      }
    } finally {
      if (isMountedRef.current) {
        setSaving(false);
      }
    }
  };

  const handleDownload = async (fmt: 'markdown' | 'json') => {
    setExportError(null);
    if (fmt === 'markdown') setExportingMd(true);
    if (fmt === 'json') setExportingJson(true);

    try {
      await downloadReport(alertId, fmt);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setExportError(err.message);
      } else {
        setExportError(`Failed to download ${fmt} report.`);
      }
    } finally {
      if (fmt === 'markdown') setExportingMd(false);
      if (fmt === 'json') setExportingJson(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="state-box" aria-live="polite">
          <div className="spinner" />
          <span>Loading alert investigation & evidence…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card">
        <div className="state-box error" role="alert">
          <strong>Failed to load alert</strong>
          <span>{error || 'Alert not found'}</span>
        </div>
      </div>
    );
  }

  const { alert, events } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Alert Metadata Card */}
      <section className="card" aria-labelledby="alert-detail-title">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 id="alert-detail-title" className="card-title">
              {alert.title}
            </h2>
            <span className={`badge badge-${status}`}>{status}</span>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => handleDownload('json')}
              disabled={exportingJson}
              aria-label="Export JSON report"
            >
              {exportingJson ? 'Exporting…' : 'Export JSON'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => handleDownload('markdown')}
              disabled={exportingMd}
              aria-label="Export Markdown report"
            >
              {exportingMd ? 'Exporting…' : 'Export Markdown'}
            </button>
          </div>
        </div>

        <div className="card-body">
          {exportError && (
            <div
              className="state-box error"
              style={{ padding: '8px 12px', marginBottom: '14px', fontSize: '12px' }}
            >
              Export error: {exportError}
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '12px',
              marginBottom: '16px',
              backgroundColor: 'var(--bg-secondary)',
              padding: '12px',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <div>
              <div className="metric-label">Rule Identifier</div>
              <div className="font-mono" style={{ color: 'var(--accent-blue)' }}>
                {alert.rule_id} (v{alert.rule_version})
              </div>
            </div>

            <div>
              <div className="metric-label">Source IP</div>
              <div className="font-mono">{alert.source}</div>
            </div>

            <div>
              <div className="metric-label">Detection Timestamp (UTC)</div>
              <div className="font-mono">{alert.timestamp}</div>
            </div>

            <div>
              <div className="metric-label">Associated Evidence Events</div>
              <div className="font-mono">{events.length} events</div>
            </div>
          </div>

          <div style={{ marginBottom: '14px' }}>
            <div className="metric-label" style={{ marginBottom: '4px' }}>
              Rule Justification & Thresholds
            </div>
            <div
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px',
                fontSize: '13px',
                color: 'var(--text-primary)',
              }}
            >
              {alert.reason}
            </div>
          </div>

          <div>
            <div className="metric-label" style={{ marginBottom: '6px' }}>
              Potential False Positives (Analyst Reference)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {alert.false_positives && alert.false_positives.length > 0 ? (
                alert.false_positives.map((fp, i) => (
                  <span
                    key={i}
                    style={{
                      backgroundColor: 'var(--bg-surface-hover)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 10px',
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    • {fp}
                  </span>
                ))
              ) : (
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                  None documented.
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Investigation Notes & Classification Card */}
      <section className="card" aria-labelledby="investigation-form-title">
        <div className="card-header">
          <h3 id="investigation-form-title" className="card-title">
            Analyst Investigation & Triage
          </h3>
          {isDirty && (
            <span
              style={{
                fontSize: '11px',
                color: 'var(--warning)',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              Unsaved modifications
            </span>
          )}
        </div>

        <div className="card-body">
          <form onSubmit={handleSaveInvestigation}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                marginBottom: '16px',
              }}
            >
              <div className="form-group">
                <label htmlFor="inv-status" className="form-label">
                  Triage Status
                </label>
                <select
                  id="inv-status"
                  className="form-select"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as AlertStatus)}
                  disabled={saving}
                >
                  <option value="open">Open (Initial Triage)</option>
                  <option value="in_progress">In Progress (Active Investigation)</option>
                  <option value="closed">Closed (Resolution Reached)</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="inv-classification" className="form-label">
                  Incident Classification
                </label>
                <select
                  id="inv-classification"
                  className="form-select"
                  value={classification}
                  onChange={(e) => setClassification(e.target.value as Classification)}
                  disabled={saving}
                >
                  <option value="unclassified">Unclassified</option>
                  <option value="benign">Benign (Expected Activity / FP)</option>
                  <option value="suspicious">Suspicious (Elevated Risk)</option>
                  <option value="confirmed_incident">Confirmed incident (analyst judgment)</option>
                </select>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '14px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <label htmlFor="inv-notes" className="form-label">
                  Analyst Assessment & Notes
                </label>
                <span
                  style={{
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    color: notes.length > 9500 ? 'var(--danger)' : 'var(--text-muted)',
                  }}
                >
                  {notes.length.toLocaleString()} / 10,000 characters
                </span>
              </div>
              <textarea
                id="inv-notes"
                className="form-textarea"
                rows={5}
                maxLength={10000}
                placeholder="Document your investigation hypothesis, log corroboration, decision rationale, or mitigation actions..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={saving}
              />
            </div>

            {saveSuccessMessage && (
              <div
                style={{
                  backgroundColor: 'var(--success-subtle)',
                  border: '1px solid var(--success)',
                  color: 'var(--success)',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: '14px',
                  fontSize: '12px',
                }}
              >
                ✓ {saveSuccessMessage}
              </div>
            )}

            {saveError && (
              <div
                className="state-box error"
                style={{ padding: '8px 12px', marginBottom: '14px', fontSize: '12px' }}
              >
                {saveError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              {isDirty && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    if (savedInvestigation) {
                      setStatus(savedInvestigation.status);
                      setClassification(savedInvestigation.classification);
                      setNotes(savedInvestigation.notes || '');
                    }
                  }}
                  disabled={saving}
                >
                  Discard Changes
                </button>
              )}

              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || !isDirty}
                aria-busy={saving}
              >
                {saving ? 'Saving…' : 'Save Investigation'}
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Chronological Evidence Timeline Card */}
      <section className="card" aria-labelledby="timeline-title">
        <div className="card-header">
          <h3 id="timeline-title" className="card-title">
            Chronological Evidence Timeline ({events.length} Events)
          </h3>
        </div>

        <div className="card-body">
          {events.length === 0 ? (
            <div className="state-box">No evidence events found for this alert window.</div>
          ) : (
            <div className="timeline">
              {events.map((evt) => (
                <div key={evt.id} className="timeline-item">
                  <div
                    className={`timeline-dot ${evt.outcome === 'failure' ? 'failure' : 'success'}`}
                    aria-hidden="true"
                  />
                  <div className="timeline-header">
                    <span className="timeline-timestamp">{evt.timestamp}</span>
                    <span className={`badge badge-${evt.outcome}`}>{evt.outcome}</span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '12px',
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      marginBottom: '8px',
                    }}
                  >
                    <span>
                      User: <strong className="font-mono">{evt.username}</strong>
                    </span>
                    <span>
                      Source: <span className="font-mono">{evt.source}</span>
                    </span>
                    <span>
                      Method: <span className="font-mono">{evt.method}</span>
                    </span>
                    <span>
                      Line #{evt.line_number}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      Import Ref:{' '}
                      <span className="font-mono">
                        {evt.import_id ? evt.import_id : 'Unavailable'}
                      </span>
                    </span>
                  </div>

                  <div>
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        marginBottom: '4px',
                      }}
                    >
                      Raw SSH Log Record
                    </div>
                    {/* Rendered purely as text inside pre, no dangerous HTML */}
                    <pre className="code-block">{evt.raw_line}</pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
