import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHealth, fetchSummary } from './api';
import type { ImportResponse, Summary } from './types';
import { AlertsSection } from './components/AlertsSection';
import { EventsSection } from './components/EventsSection';
import { ImportSection } from './components/ImportSection';
import { SummaryHeader } from './components/SummaryHeader';

type Tab = 'alerts' | 'events' | 'import';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('alerts');
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);
  const [showTabModal, setShowTabModal] = useState<boolean>(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [discardTrigger, setDiscardTrigger] = useState<number>(0);

  const triggerRef = useRef<HTMLElement | null>(null);
  const keepEditingBtnRef = useRef<HTMLButtonElement | null>(null);
  const discardBtnRef = useRef<HTMLButtonElement | null>(null);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isBackendOnline, setIsBackendOnline] = useState<boolean>(false);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  const loadHealthAndSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);

    try {
      await fetchHealth();
      setIsBackendOnline(true);
      const data = await fetchSummary();
      setSummary(data);
    } catch (err: unknown) {
      setIsBackendOnline(false);
      if (err instanceof Error) {
        setSummaryError(err.message);
      } else {
        setSummaryError('Cannot reach backend service at 127.0.0.1:8000.');
      }
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealthAndSummary();
  }, [loadHealthAndSummary]);

  const handleTabChange = (tab: Tab) => {
    if (tab === activeTab) return;
    if (hasUnsavedChanges) {
      triggerRef.current = (document.activeElement as HTMLElement) || null;
      setPendingTab(tab);
      setShowTabModal(true);
    } else {
      setActiveTab(tab);
    }
  };

  const handleKeepEditing = useCallback(() => {
    setPendingTab(null);
    setShowTabModal(false);
    triggerRef.current?.focus();
  }, []);

  const handleDiscardAndSwitch = () => {
    const targetTab = pendingTab;
    setDiscardTrigger((prev) => prev + 1);
    setHasUnsavedChanges(false);
    setShowTabModal(false);
    if (targetTab) {
      setActiveTab(targetTab);
      setPendingTab(null);
      const newTabBtn = document.getElementById(`tab-${targetTab}`);
      newTabBtn?.focus();
    }
  };

  useEffect(() => {
    if (!showTabModal) return;
    keepEditingBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleKeepEditing();
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
  }, [showTabModal, handleKeepEditing]);

  const handleImportSuccess = (_result: ImportResponse) => {
    loadHealthAndSummary();
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleInvestigationSaved = () => {
    loadHealthAndSummary();
  };

  return (
    <div className="app-container">
      <SummaryHeader
        summary={summary}
        loading={summaryLoading}
        error={summaryError}
        isBackendOnline={isBackendOnline}
        onRefresh={loadHealthAndSummary}
      />

      <nav className="app-nav" aria-label="Main Application Views">
        <button
          id="tab-alerts"
          type="button"
          className={`nav-tab ${activeTab === 'alerts' ? 'active' : ''}`}
          onClick={() => handleTabChange('alerts')}
          aria-selected={activeTab === 'alerts'}
          role="tab"
        >
          <span>Alerts & Triage</span>
          {summary && <span className="nav-badge">{summary.open_alerts} open</span>}
        </button>

        <button
          id="tab-events"
          type="button"
          className={`nav-tab ${activeTab === 'events' ? 'active' : ''}`}
          onClick={() => handleTabChange('events')}
          aria-selected={activeTab === 'events'}
          role="tab"
        >
          <span>All Events</span>
          {summary && <span className="nav-badge">{summary.events}</span>}
        </button>

        <button
          id="tab-import"
          type="button"
          className={`nav-tab ${activeTab === 'import' ? 'active' : ''}`}
          onClick={() => handleTabChange('import')}
          aria-selected={activeTab === 'import'}
          role="tab"
        >
          <span>Ingest Logs</span>
        </button>
      </nav>

      <main className="app-main">
        <div
          role="tabpanel"
          hidden={activeTab !== 'alerts'}
          style={{ display: activeTab === 'alerts' ? 'block' : 'none' }}
        >
          <AlertsSection
            onInvestigationSaved={handleInvestigationSaved}
            refreshTrigger={refreshTrigger}
            onUnsavedChangesChange={setHasUnsavedChanges}
            discardTrigger={discardTrigger}
          />
        </div>

        <div
          role="tabpanel"
          hidden={activeTab !== 'events'}
          style={{ display: activeTab === 'events' ? 'block' : 'none' }}
        >
          <EventsSection refreshTrigger={refreshTrigger} />
        </div>

        <div
          role="tabpanel"
          hidden={activeTab !== 'import'}
          style={{ display: activeTab === 'import' ? 'block' : 'none' }}
        >
          <ImportSection onImportSuccess={handleImportSuccess} />
        </div>
      </main>

      {/* Confirmation Modal for Unsaved Changes on Tab Switch */}
      {showTabModal && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tab-confirm-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleKeepEditing();
            }
          }}
        >
          <div className="modal-content">
            <h3 id="tab-confirm-modal-title" className="modal-title">
              Unsaved Investigation Changes
            </h3>
            <p className="modal-body">
              You have unsaved modifications to the investigation notes, status, or classification.
              Switching tabs will discard these changes.
            </p>
            <div className="modal-actions">
              <button
                ref={keepEditingBtnRef}
                type="button"
                className="btn"
                onClick={handleKeepEditing}
              >
                Keep Editing
              </button>
              <button
                ref={discardBtnRef}
                type="button"
                className="btn btn-primary"
                style={{ backgroundColor: 'var(--danger)', borderColor: 'var(--danger)' }}
                onClick={handleDiscardAndSwitch}
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

export default App;
