import { useState, useEffect, useCallback } from 'react';
import { AppLayout, type NavTab } from './components/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { VerificationPage } from './pages/VerificationPage';
import { EnrollmentPage } from './pages/EnrollmentPage';
import { AttendanceHistoryPage } from './pages/AttendanceHistoryPage';
import { SystemStatusPage } from './pages/SystemStatusPage';
import { AuthPage } from './pages/AuthPage';
import {
  fetchHealthLive,
  fetchHealthReady,
  fetchRoot,
  fetchCurrentStudent,
  clearStoredToken,
  getStoredToken,
} from './lib/api';
import type { BackendSystemStatus, StudentProfile } from './lib/types';

export function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('overview');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [currentStudent, setCurrentStudent] = useState<StudentProfile | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);

  const [systemStatus, setSystemStatus] = useState<BackendSystemStatus>({
    connection: 'checking',
    health: null,
    readiness: null,
    root: null,
    lastChecked: null,
    errorMessage: null,
  });

  const checkBackendStatus = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [rootData, healthData, readyData] = await Promise.all([
        fetchRoot().catch(() => null),
        fetchHealthLive(),
        fetchHealthReady(),
      ]);

      setSystemStatus({
        connection: 'connected',
        health: healthData,
        readiness: readyData,
        root: rootData,
        lastChecked: new Date(),
        errorMessage: null,
      });
    } catch (err: unknown) {
      setSystemStatus((prev) => ({
        ...prev,
        connection: 'disconnected',
        health: null,
        readiness: null,
        lastChecked: new Date(),
        errorMessage: err instanceof Error ? err.message : 'Backend unreachable',
      }));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const refreshStudentProfile = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setCurrentStudent(null);
      setIsCheckingAuth(false);
      return;
    }

    try {
      const profile = await fetchCurrentStudent();
      setCurrentStudent(profile);
    } catch {
      clearStoredToken();
      setCurrentStudent(null);
    } finally {
      setIsCheckingAuth(false);
    }
  }, []);

  const handleLogout = useCallback(() => {
    clearStoredToken();
    setCurrentStudent(null);
    setCurrentTab('overview');
  }, []);

  // Poll system status on initial load and periodically (every 15 seconds)
  useEffect(() => {
    let isMounted = true;
    const runCheck = async () => {
      if (isMounted) {
        await checkBackendStatus();
      }
    };
    void runCheck();

    const interval = setInterval(() => {
      void runCheck();
    }, 15000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [checkBackendStatus]);

  // Check auth session on startup
  useEffect(() => {
    void refreshStudentProfile();
  }, [refreshStudentProfile]);

  return (
    <AppLayout
      currentTab={currentTab}
      onSelectTab={setCurrentTab}
      status={systemStatus}
      student={currentStudent}
      onLogout={handleLogout}
      onRefreshStatus={checkBackendStatus}
    >
      {isCheckingAuth ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <div className="status-dot live" style={{ display: 'inline-block', margin: '0 auto' }} />
          <p style={{ marginTop: '0.5rem', color: 'var(--text-secondary)' }}>Checking local authentication session...</p>
        </div>
      ) : !currentStudent ? (
        <AuthPage
          onAuthSuccess={(profile) => {
            setCurrentStudent(profile);
            void refreshStudentProfile();
          }}
        />
      ) : (
        <>
          {currentTab === 'overview' && (
            <DashboardPage
              status={systemStatus}
              student={currentStudent}
              onNavigateToVerification={() => setCurrentTab('verification')}
              onNavigateToEnrollment={() => setCurrentTab('enrollment')}
              onRefresh={checkBackendStatus}
            />
          )}

          {currentTab === 'enrollment' && (
            <EnrollmentPage
              student={currentStudent}
              systemStatus={systemStatus}
              onEnrollmentComplete={() => {
                void refreshStudentProfile();
                setCurrentTab('overview');
              }}
            />
          )}

          {currentTab === 'verification' && (
            <VerificationPage
              systemStatus={systemStatus}
              student={currentStudent}
              onNavigateToEnrollment={() => setCurrentTab('enrollment')}
            />
          )}

          {currentTab === 'history' && (
            <AttendanceHistoryPage student={currentStudent} />
          )}

          {currentTab === 'system' && (
            <SystemStatusPage
              status={systemStatus}
              onRefresh={checkBackendStatus}
              isRefreshing={isRefreshing}
            />
          )}
        </>
      )}
    </AppLayout>
  );
}

export default App;
