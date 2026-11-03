import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAlerts } from '../api';
import type {
  AlertFilterParams,
  AlertItem,
  AlertStatus,
  RuleId,
} from '../types';
import { AlertDetail } from './AlertDetail';

interface AlertsSectionProps {
  onInvestigationSaved: () => void;
  refreshTrigger: number;
  onUnsavedChangesChange?: (isDirty: boolean) => void;
  discardTrigger?: number;
}

export const AlertsSection: React.FC<AlertsSectionProps> = ({
  onInvestigationSaved,
  refreshTrigger,
  onUnsavedChangesChange,
  discardTrigger,
}) => {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [totalAlerts, setTotalAlerts] = useState<number>(0);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [ruleIdFilter, setRuleIdFilter] = useState<RuleId | ''>('');
  const [statusFilter, setStatusFilter] = useState<AlertStatus | ''>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [fromTimeFilter, setFromTimeFilter] = useState<string>('');
  const [toTimeFilter, setToTimeFilter] = useState<string>('');
  const [limit, setLimit] = useState<number>(50);
  const [offset, setOffset] = useState<number>(0);

  // Unsaved changes guard
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [pendingAlertId, setPendingAlertId] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);

  const triggerRef = useRef<HTMLElement | null>(null);
  const keepEditingBtnRef = useRef<HTMLButtonElement | null>(null);
  const discardBtnRef = useRef<HTMLButtonElement | null>(null);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params: AlertFilterParams = {
      limit,
      offset,
    };
    if (ruleIdFilter) params.rule_id = ruleIdFilter;
    if (statusFilter) params.status = statusFilter;
    if (sourceFilter.trim()) params.source = sourceFilter.trim();
    if (fromTimeFilter.trim()) params.from_time = fromTimeFilter.trim();
    if (toTimeFilter.trim()) params.to_time = toTimeFilter.trim();

    try {
      const res = await fetchAlerts(params);
      setAlerts(res.items);
      setTotalAlerts(res.total);
      // Automatically select first alert if none is selected
      if (!selectedAlertId && res.items.length > 0) {
        setSelectedAlertId(res.items[0].id);
      } else if (res.items.length > 0 && !res.items.some((a) => a.id === selectedAlertId)) {
        // Current selected alert not in page
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to fetch alerts.');
      }
    } finally {
      setLoading(false);
    }
  }, [ruleIdFilter, statusFilter, sourceFilter, fromTimeFilter, toTimeFilter, limit, offset, selectedAlertId]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts, refreshTrigger]);

  const handleSelectAlert = (alertId: string) => {
    if (alertId === selectedAlertId) return;

    if (hasUnsavedChanges) {
      triggerRef.current = (document.activeElement as HTMLElement) || null;
      setPendingAlertId(alertId);
      setShowConfirmModal(true);
    } else {
      setSelectedAlertId(alertId);
    }
  };

  const handleConfirmDiscard = () => {
    const targetId = pendingAlertId;
    setHasUnsavedChanges(false);
    onUnsavedChangesChange?.(false);
    setShowConfirmModal(false);
    if (targetId) {
      setSelectedAlertId(targetId);
      setPendingAlertId(null);
      const itemBtn = document.getElementById(`alert-item-${targetId}`);
      itemBtn?.focus();
    }
  };

  const handleCancelDiscard = useCallback(() => {
    setPendingAlertId(null);
    setShowConfirmModal(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!showConfirmModal) return;
    keepEditingBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleCancelDiscard();
        return;
      }

      if (e.key === 'Tab') {
        const first = keepEditingBtnRef.current;
        const last = discardBtnRef.current;
        if (!first || !last) return;

        if (e.shiftKey) {
          if (
            document.activeElement === first ||
            (document.activeElement !== first && document.activeElement !== last)
          ) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (
            document.activeElement === last ||
            (document.activeElement !== first && document.activeElement !== last)
          ) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showConfirmModal, handleCancelDiscard]);

  const handleResetFilters = () => {
    setRuleIdFilter('');
    setStatusFilter('');
    setSourceFilter('');
    setFromTimeFilter('');
    setToTimeFilter('');
    setOffset(0);
  };

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(totalAlerts / limit));

  return (
    <div>
      {/* Triage Disclaimer Banner */}
      <div className="triage-disclaimer-banner" role="note">
        <div>
          <strong>Triage Signal Notice:</strong> Rule detections indicate suspicious behavioral patterns
          requiring analyst investigation. An alert does not confirm intrusion or system compromise.
        </div>
      </div>

      {/* Filters Bar */}
      <div className="filters-bar" role="search" aria-label="Filter alerts">
        <div className="form-group">
          <label htmlFor="filter-rule" className="form-label">
            Detection Rule
          </label>
          <select
            id="filter-rule"
            className="form-select"
            value={ruleIdFilter}
            onChange={(e) => {
              setRuleIdFilter(e.target.value as RuleId | '');
              setOffset(0);
            }}
          >
            <option value="">All Rules</option>
            <option value="repeated_failures">repeated_failures</option>
            <option value="multiple_users">multiple_users</option>
            <option value="success_after_failures">success_after_failures</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="filter-status" className="form-label">
            Status
          </label>
          <select
            id="filter-status"
            className="form-select"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as AlertStatus | '');
              setOffset(0);
            }}
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="closed">Closed</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="filter-source" className="form-label">
            Source IP (Exact)
          </label>
          <input
            id="filter-source"
            type="text"
            className="form-input"
            placeholder="e.g. 192.0.2.10"
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value);
              setOffset(0);
            }}
          />
        </div>

        <div className="form-group">
          <label htmlFor="filter-from-time" className="form-label">
            From Time (UTC)
          </label>
          <input
            id="filter-from-time"
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
          <label htmlFor="filter-to-time" className="form-label">
            To Time (UTC)
          </label>
          <input
            id="filter-to-time"
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
          <label htmlFor="filter-limit" className="form-label">
            Page Size
          </label>
          <select
            id="filter-limit"
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
          aria-label="Reset all filters"
        >
          Reset Filters
        </button>
      </div>

      {/* Main Two-Column View */}
      <div className="investigation-grid">
        {/* Left Column: Alert List */}
        <section className="card" aria-label="Detected Alerts List">
          <div className="card-header">
            <h2 className="card-title">
              Alerts ({totalAlerts})
            </h2>
            <div className="pagination-info">
              Page {currentPage} / {totalPages}
            </div>
          </div>

          <div className="card-body" style={{ padding: '8px' }}>
            {loading && alerts.length === 0 ? (
              <div className="state-box" aria-live="polite">
                <div className="spinner" />
                <span>Loading alerts…</span>
              </div>
            ) : error ? (
              <div className="state-box error" role="alert">
                <strong>Error loading alerts</strong>
                <span>{error}</span>
              </div>
            ) : alerts.length === 0 ? (
              <div className="state-box">
                <span>No alerts matching the selected filters.</span>
              </div>
            ) : (
              <div className="alert-list" role="listbox" aria-label="Alerts">
                {alerts.map((al) => {
                  const isSelected = al.id === selectedAlertId;
                  return (
                    <button
                      key={al.id}
                      id={`alert-item-${al.id}`}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`alert-item-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleSelectAlert(al.id)}
                    >
                      <div className="alert-item-header">
                        <span className="alert-item-title">{al.title}</span>
                        <span className={`badge badge-${al.status}`}>{al.status}</span>
                      </div>

                      <div className="alert-item-meta">
                        <span>
                          IP: <strong>{al.source}</strong>
                        </span>
                        <span>
                          Events: <strong>{al.event_count}</strong>
                        </span>
                      </div>

                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          marginTop: '4px',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {al.timestamp}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Pagination Controls */}
            {totalAlerts > limit && (
              <div className="pagination-bar" style={{ padding: '12px 8px 4px' }}>
                <span className="pagination-info">
                  Showing {offset + 1}–{Math.min(offset + limit, totalAlerts)} of {totalAlerts}
                </span>

                <div className="pagination-controls">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={offset === 0 || loading}
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                    aria-label="Previous page of alerts"
                  >
                    ← Prev
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={offset + limit >= totalAlerts || loading}
                    onClick={() => setOffset(offset + limit)}
                    aria-label="Next page of alerts"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right Column: Selected Alert Investigation & Evidence */}
        <div aria-live="polite">
          {selectedAlertId ? (
            <AlertDetail
              key={selectedAlertId}
              alertId={selectedAlertId}
              onInvestigationSaved={() => {
                onInvestigationSaved();
                loadAlerts();
              }}
              onUnsavedStatusChange={(dirty) => {
                setHasUnsavedChanges(dirty);
                onUnsavedChangesChange?.(dirty);
              }}
              discardTrigger={discardTrigger}
            />
          ) : (
            <div className="card">
              <div className="state-box">
                <span>Select an alert from the list to view evidence and triage notes.</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal for Unsaved Changes */}
      {showConfirmModal && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleCancelDiscard();
            }
          }}
        >
          <div className="modal-content">
            <h3 id="confirm-modal-title" className="modal-title">
              Unsaved Investigation Changes
            </h3>
            <p className="modal-body">
              You have made modifications to the status, classification, or notes of the current
              alert that have not been saved. Switching to another alert will discard these changes.
            </p>
            <div className="modal-actions">
              <button
                ref={keepEditingBtnRef}
                type="button"
                className="btn"
                onClick={handleCancelDiscard}
              >
                Keep Editing
              </button>
              <button
                ref={discardBtnRef}
                type="button"
                className="btn btn-primary"
                style={{ backgroundColor: 'var(--danger)', borderColor: 'var(--danger)' }}
                onClick={handleConfirmDiscard}
              >
                Discard & Switch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
