import React from 'react';
import type { BackendSystemStatus } from '../lib/types';

export type NavTab = 'overview' | 'verification' | 'system';

interface AppLayoutProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  status: BackendSystemStatus;
  onRefreshStatus?: () => void;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  currentTab,
  onSelectTab,
  status,
  onRefreshStatus,
  children,
}) => {
  const getBadgeVariant = (): 'live' | 'offline' | 'not_ready' => {
    if (status.connection === 'connected') return 'live';
    if (status.connection === 'disconnected' || status.connection === 'error') return 'offline';
    return 'not_ready';
  };

  const getBadgeText = (): string => {
    if (status.connection === 'connected') {
      return status.readiness?.ready_for_inference ? 'READY' : 'ONLINE (MODELS UNLOADED)';
    }
    if (status.connection === 'checking') return 'CHECKING...';
    return 'BACKEND OFFLINE';
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-icon">FR</div>
          <div>
            <h1 className="brand-title">Face Recognition + Liveness</h1>
            <p className="brand-subtitle">Local Verification & Control Console</p>
          </div>
        </div>

        <nav className="nav-tabs" aria-label="Main Navigation">
          <button
            type="button"
            className={`nav-tab ${currentTab === 'overview' ? 'active' : ''}`}
            onClick={() => onSelectTab('overview')}
          >
            Overview
          </button>
          <button
            type="button"
            className={`nav-tab ${currentTab === 'verification' ? 'active' : ''}`}
            onClick={() => onSelectTab('verification')}
          >
            Live Verification
          </button>
          <button
            type="button"
            className={`nav-tab ${currentTab === 'system' ? 'active' : ''}`}
            onClick={() => onSelectTab('system')}
          >
            System Status
          </button>
        </nav>

        <div className="header-status">
          <span className={`status-badge ${getBadgeVariant()}`}>
            <span className="status-dot" />
            {getBadgeText()}
          </span>
          {onRefreshStatus && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
              onClick={onRefreshStatus}
              title="Refresh backend status"
            >
              Refresh
            </button>
          )}
        </div>
      </header>

      <main className="main-content">{children}</main>

      <footer className="app-footer">
        <div>
          <span>Local Development Console</span> &bull;{' '}
          <span>Target Architecture: Android Client + FastAPI Backend</span>
        </div>
        <div>
          <span>Zero third-party telemetry &bull; Privacy first</span>
        </div>
      </footer>
    </div>
  );
};
