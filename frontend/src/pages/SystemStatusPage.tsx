import React from 'react';
import type { BackendSystemStatus } from '../lib/types';
import { StatusCard } from '../components/StatusCard';
import { API_BASE_URL } from '../lib/api';

interface SystemStatusPageProps {
  status: BackendSystemStatus;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const SystemStatusPage: React.FC<SystemStatusPageProps> = ({
  status,
  onRefresh,
  isRefreshing,
}) => {
  const isOnline = status.connection === 'connected';

  const endpoints = [
    {
      method: 'GET',
      path: '/',
      description: 'Service metadata and URL discovery',
      status: isOnline ? 'Available' : 'Unreachable',
      code: status.root ? '200 OK' : 'Unavailable',
    },
    {
      method: 'GET',
      path: '/health/live',
      description: 'Liveness probe (process up & listening)',
      status: status.health?.status === 'live' ? 'Passing' : 'Failing',
      code: status.health?.status === 'live' ? '200 OK' : 'Unavailable',
    },
    {
      method: 'GET',
      path: '/health/ready',
      description: 'Readiness probe (model approval & gate checks)',
      status: status.readiness?.ready_for_inference ? 'Ready for Inference' : 'Fail-Closed (Models Unapproved)',
      code: status.readiness ? '200 OK' : 'Unavailable',
    },
    {
      method: 'POST',
      path: '/v1/liveness-sessions',
      description: 'Create randomized challenge session & replay-protection nonce',
      status: isOnline ? 'Available' : 'Unreachable',
      code: isOnline ? 'Ready' : 'Unavailable',
    },
    {
      method: 'POST',
      path: '/v1/verifications',
      description: 'Evidence submission, PAD analysis, and face embedding matching',
      status: 'Pending Implementation',
      code: 'Not Registered',
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            System Status & Diagnostics
          </h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Real-time telemetry, model readiness gates, and API endpoint verification.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'Checking Endpoints...' : 'Re-check Endpoints'}
        </button>
      </div>

      <div className="card-grid">
        <StatusCard
          title="Server Target"
          value={API_BASE_URL}
          description="Configured via VITE_API_BASE_URL environment variable"
        />
        <StatusCard
          title="Last Inspection"
          value={status.lastChecked ? status.lastChecked.toLocaleTimeString() : 'Never'}
          description={status.errorMessage ? `Error: ${status.errorMessage}` : 'Endpoint polling successful'}
        />
        <StatusCard
          title="Inference Policy"
          value="Fail-Closed"
          description="Inference is strictly blocked unless both PAD and Embedding models pass approval"
        />
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-title">
          <span>Backend Endpoint Catalog</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '0.6rem 0.75rem' }}>Method</th>
                <th style={{ padding: '0.6rem 0.75rem' }}>Endpoint</th>
                <th style={{ padding: '0.6rem 0.75rem' }}>Purpose</th>
                <th style={{ padding: '0.6rem 0.75rem' }}>Current Status</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((ep) => (
                <tr key={`${ep.method}-${ep.path}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '0.6rem 0.75rem' }}>
                    <span
                      style={{
                        padding: '0.2rem 0.4rem',
                        borderRadius: '3px',
                        fontWeight: 600,
                        fontSize: '0.75rem',
                        backgroundColor: ep.method === 'GET' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                        color: ep.method === 'GET' ? 'var(--accent-blue)' : 'var(--accent-emerald)',
                      }}
                    >
                      {ep.method}
                    </span>
                  </td>
                  <td style={{ padding: '0.6rem 0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                    {ep.path}
                  </td>
                  <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-secondary)' }}>
                    {ep.description}
                  </td>
                  <td style={{ padding: '0.6rem 0.75rem' }}>
                    <span
                      style={{
                        color:
                          ep.status === 'Available' || ep.status === 'Passing' || ep.status === 'Ready for Inference'
                            ? 'var(--accent-emerald)'
                            : ep.status.includes('Fail-Closed')
                            ? 'var(--accent-amber)'
                            : ep.status.includes('Pending')
                            ? 'var(--text-muted)'
                            : 'var(--accent-rose)',
                      }}
                    >
                      {ep.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <span>Security & Governance Audit</span>
        </div>
        <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6, fontSize: '0.85rem' }}>
          <p style={{ marginBottom: '0.5rem' }}>
            &bull; <strong>Replay Protection:</strong> Challenge sessions issue a 128-bit server nonce with single-use consumption semantics. Replayed tokens fail validation.
          </p>
          <p style={{ marginBottom: '0.5rem' }}>
            &bull; <strong>Biometric Privacy:</strong> Facial frames are ingested only across authenticated sessions and never persisted to browser cache, localStorage, or third-party cloud services.
          </p>
          <p>
            &bull; <strong>Approval Gating:</strong> Before actual weights are cleared in production, stub providers enforce fail-closed zero inference to prevent unvalidated biometric decisions.
          </p>
        </div>
      </div>
    </div>
  );
};
