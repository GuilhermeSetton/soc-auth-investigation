import React, { useCallback, useEffect, useState } from 'react';
import { fetchEvents } from '../api';
import type { EventFilterParams, EventItem, Outcome } from '../types';

interface EventsSectionProps {
  refreshTrigger: number;
}

export const EventsSection: React.FC<EventsSectionProps> = ({ refreshTrigger }) => {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [usernameFilter, setUsernameFilter] = useState<string>('');
  const [outcomeFilter, setOutcomeFilter] = useState<Outcome | ''>('');
  const [fromTimeFilter, setFromTimeFilter] = useState<string>('');
  const [toTimeFilter, setToTimeFilter] = useState<string>('');
  const [limit, setLimit] = useState<number>(50);
  const [offset, setOffset] = useState<number>(0);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params: EventFilterParams = {
      limit,
      offset,
    };
    if (sourceFilter.trim()) params.source = sourceFilter.trim();
    if (usernameFilter.trim()) params.username = usernameFilter.trim();
    if (outcomeFilter) params.outcome = outcomeFilter;
    if (fromTimeFilter.trim()) params.from_time = fromTimeFilter.trim();
    if (toTimeFilter.trim()) params.to_time = toTimeFilter.trim();

    try {
      const res = await fetchEvents(params);
      setEvents(res.items);
      setTotal(res.total);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to fetch events.');
      }
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, usernameFilter, outcomeFilter, fromTimeFilter, toTimeFilter, limit, offset]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents, refreshTrigger]);

  const handleResetFilters = () => {
    setSourceFilter('');
    setUsernameFilter('');
    setOutcomeFilter('');
    setFromTimeFilter('');
    setToTimeFilter('');
    setOffset(0);
  };

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <section className="card" aria-labelledby="events-section-title">
      <div className="card-header">
        <h2 id="events-section-title" className="card-title">
          Authentication Events Log{!error && !loading ? ` (${total.toLocaleString()})` : ''}
        </h2>
        {!error && !loading && total > 0 && (
          <div className="pagination-info">
            Page {currentPage} of {totalPages}
          </div>
        )}
      </div>

      <div className="card-body">
        {/* Filters */}
        <div className="filters-bar" role="search" aria-label="Filter events">
          <div className="form-group">
            <label htmlFor="evt-source" className="form-label">
              Source IP (Exact)
            </label>
            <input
              id="evt-source"
              type="text"
              className="form-input font-mono"
              placeholder="e.g. 192.0.2.10"
              value={sourceFilter}
              onChange={(e) => {
                setSourceFilter(e.target.value);
                setOffset(0);
              }}
            />
          </div>

          <div className="form-group">
            <label htmlFor="evt-username" className="form-label">
              Username (Exact)
            </label>
            <input
              id="evt-username"
              type="text"
              className="form-input font-mono"
              placeholder="e.g. root, alice"
              value={usernameFilter}
              onChange={(e) => {
                setUsernameFilter(e.target.value);
                setOffset(0);
              }}
            />
          </div>

          <div className="form-group">
            <label htmlFor="evt-outcome" className="form-label">
              Outcome
            </label>
            <select
              id="evt-outcome"
              className="form-select"
              value={outcomeFilter}
              onChange={(e) => {
                setOutcomeFilter(e.target.value as Outcome | '');
                setOffset(0);
              }}
            >
              <option value="">All Outcomes</option>
              <option value="failure">Failure</option>
              <option value="success">Success</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="evt-from" className="form-label">
              From Time (UTC)
            </label>
            <input
              id="evt-from"
              type="text"
              className="form-input font-mono"
              placeholder="2026-10-01T12:00:00Z"
              value={fromTimeFilter}
              onChange={(e) => {
                setFromTimeFilter(e.target.value);
                setOffset(0);
              }}
            />
          </div>

          <div className="form-group">
            <label htmlFor="evt-to" className="form-label">
              To Time (UTC)
            </label>
            <input
              id="evt-to"
              type="text"
              className="form-input font-mono"
              placeholder="2026-10-01T12:05:00Z"
              value={toTimeFilter}
              onChange={(e) => {
                setToTimeFilter(e.target.value);
                setOffset(0);
              }}
            />
          </div>

          <div className="form-group">
            <label htmlFor="evt-limit" className="form-label">
              Per Page
            </label>
            <select
              id="evt-limit"
              className="form-select"
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setOffset(0);
              }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          <button
            type="button"
            className="btn"
            onClick={handleResetFilters}
            aria-label="Reset event filters"
          >
            Reset Filters
          </button>
        </div>

        {/* Content States */}
        {loading && events.length === 0 ? (
          <div className="state-box" aria-live="polite">
            <div className="spinner" />
            <span>Loading authentication events…</span>
          </div>
        ) : error ? (
          <div className="state-box error" role="alert">
            <strong>Error loading events:</strong>
            <span>{error}</span>
          </div>
        ) : events.length === 0 ? (
          <div className="state-box">
            <span>No events found matching the search criteria.</span>
          </div>
        ) : (
          <>
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '190px' }}>Timestamp (UTC)</th>
                    <th>Source IP</th>
                    <th>Username</th>
                    <th>Outcome</th>
                    <th>Method</th>
                    <th>Host [PID]</th>
                    <th className="col-line">Line #</th>
                    <th>Original Log Entry</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((evt) => (
                    <tr key={evt.id}>
                      <td className="font-mono" style={{ color: 'var(--accent-blue)', whiteSpace: 'nowrap' }}>
                        {evt.timestamp}
                      </td>
                      <td className="font-mono">{evt.source}</td>
                      <td className="font-mono">
                        <strong>{evt.username}</strong>
                      </td>
                      <td>
                        <span className={`badge badge-${evt.outcome}`}>{evt.outcome}</span>
                      </td>
                      <td className="font-mono">{evt.method}</td>
                      <td className="font-mono" style={{ color: 'var(--text-muted)' }}>
                        {evt.host}
                      </td>
                      <td className="font-mono col-line">#{evt.line_number}</td>
                      <td style={{ maxWidth: '450px' }}>
                        {/* Always pure text in pre, never HTML */}
                        <pre
                          className="code-block"
                          style={{ margin: 0, padding: '4px 8px', fontSize: '11px' }}
                        >
                          {evt.raw_line}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Bar */}
            <div className="pagination-bar">
              <span className="pagination-info">
                Showing {offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()}{' '}
                events
              </span>

              <div className="pagination-controls">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={offset === 0 || loading}
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  aria-label="Previous events page"
                >
                  ← Previous
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={offset + limit >= total || loading}
                  onClick={() => setOffset(offset + limit)}
                  aria-label="Next events page"
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
};
