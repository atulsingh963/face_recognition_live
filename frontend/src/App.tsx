import { useState, useEffect, useCallback } from 'react';
import { AppLayout, type NavTab } from './components/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { VerificationPage } from './pages/VerificationPage';
import { SystemStatusPage } from './pages/SystemStatusPage';
import { fetchHealthLive, fetchHealthReady, fetchRoot } from './lib/api';
import type { BackendSystemStatus } from './lib/types';

export function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('overview');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
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

  // Poll status on initial load and periodically (every 15 seconds)
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

  return (
    <AppLayout
      currentTab={currentTab}
      onSelectTab={setCurrentTab}
      status={systemStatus}
      onRefreshStatus={checkBackendStatus}
    >
      {currentTab === 'overview' && (
        <DashboardPage
          status={systemStatus}
          onNavigateToVerification={() => setCurrentTab('verification')}
          onRefresh={checkBackendStatus}
        />
      )}

      {currentTab === 'verification' && (
        <VerificationPage systemStatus={systemStatus} />
      )}

      {currentTab === 'system' && (
        <SystemStatusPage
          status={systemStatus}
          onRefresh={checkBackendStatus}
          isRefreshing={isRefreshing}
        />
      )}
    </AppLayout>
  );
}

export default App;
