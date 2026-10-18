import React from 'react';
import type { BackendSystemStatus, StudentProfile } from '../lib/types';

export type NavTab = 'overview' | 'enrollment' | 'verification' | 'history' | 'system';

interface AppLayoutProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  status: BackendSystemStatus;
  student: StudentProfile | null;
  onLogout: () => void;
  onRefreshStatus?: () => void;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  currentTab,
  onSelectTab,
  status,
  student,
  onLogout,
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
            <h1 className="brand-title">Face Attendance System</h1>
            <p className="brand-subtitle">Local Verification & Biometric Console</p>
          </div>
        </div>

        <nav className="nav-tabs" aria-label="Main Navigation">
          <button
            type="button"
            className={`nav-tab ${currentTab === 'overview' ? 'active' : ''}`}
            onClick={() => onSelectTab('overview')}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={`nav-tab ${currentTab === 'enrollment' ? 'active' : ''}`}
            onClick={() => onSelectTab('enrollment')}
          >
            Face Enrollment
          </button>
          <button
            type="button"
            className={`nav-tab ${currentTab === 'verification' ? 'active' : ''}`}
            onClick={() => onSelectTab('verification')}
          >
            Mark Attendance
          </button>
          <button
            type="button"
            className={`nav-tab ${currentTab === 'history' ? 'active' : ''}`}
            onClick={() => onSelectTab('history')}
          >
            Attendance History
          </button>
          <button
            type="button"
            className={`nav-tab ${currentTab === 'system' ? 'active' : ''}`}
            onClick={() => onSelectTab('system')}
          >
            System Status
          </button>
        </nav>

        <div className="header-status" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {student && (
            <div style={{ textAlign: 'right', marginRight: '0.4rem', fontSize: '0.8rem' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {student.first_name} {student.last_name}
              </div>
              <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {student.roll_number}
              </div>
            </div>
          )}

          <span className={`status-badge ${getBadgeVariant()}`}>
            <span className="status-dot" />
            {getBadgeText()}
          </span>

          {student && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', borderColor: 'var(--border-color)' }}
              onClick={onLogout}
              title="Sign out of student account"
            >
              Sign Out
            </button>
          )}

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
          <span>Local Data Storage: <code>local_data/attendance.db</code></span> &bull;{' '}
          <span>YuNet + MiniFASNet-V2 + ArcFace ResNet-100</span>
        </div>
        <div>
          <span>Zero third-party telemetry &bull; Privacy first local biometric processing</span>
        </div>
      </footer>
    </div>
  );
};
