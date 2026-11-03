import React from 'react';
import type { Summary } from '../types';

interface SummaryHeaderProps {
  summary: Summary | null;
  loading: boolean;
  error: string | null;
  isBackendOnline: boolean;
  onRefresh: () => void;
}

export const SummaryHeader: React.FC<SummaryHeaderProps> = ({
  summary,
  loading,
  error,
  isBackendOnline,
  onRefresh,
}) => {
  return (
    <header className="app-header" role="banner">
      <div className="header-top">
        <div className="brand-section">
          <span className="brand-badge" aria-label="Blue Team Platform">
            SOC Blue Team
          </span>
          <div>
            <h1 className="brand-title">SOC Auth Investigation</h1>
            <p className="brand-subtitle">
              Linux & SSH Authentication Security Operations & Triage
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="header-status" role="status" aria-live="polite">
            <span
              className={`status-dot ${isBackendOnline ? 'online' : 'offline'}`}
              aria-hidden="true"
            />
            <span>
              API: {isBackendOnline ? 'Connected (127.0.0.1:8000)' : 'Disconnected'}
            </span>
          </div>

          <button
            type="button"
            className="btn btn-sm"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh global summary"
          >
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      <section className="metrics-panel" aria-label="Global System Metrics">
        <div className="metrics-header">
          <span className="metrics-caption">
            Global Metrics (System-wide, unaffected by view filters)
          </span>
          {error && (
            <span style={{ color: 'var(--danger)', fontSize: '11px' }}>
              Failed to load metrics: {error}
            </span>
          )}
        </div>

        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-label">Total Events</div>
            <div className="metric-value">
              {summary ? summary.events.toLocaleString() : '—'}
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-label">Total Alerts</div>
            <div className="metric-value">
              {summary ? summary.alerts.toLocaleString() : '—'}
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-label">Open Alerts</div>
            <div className="metric-value alerts-open">
              {summary ? summary.open_alerts.toLocaleString() : '—'}
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-label">Failed Logins</div>
            <div className="metric-value failed">
              {summary ? summary.failed_authentications.toLocaleString() : '—'}
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-label">Successful Logins</div>
            <div className="metric-value success">
              {summary ? summary.successful_authentications.toLocaleString() : '—'}
            </div>
          </div>
        </div>
      </section>
    </header>
  );
};
