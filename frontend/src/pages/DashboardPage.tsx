import React from 'react';
import type { BackendSystemStatus } from '../lib/types';
import { StatusCard } from '../components/StatusCard';

interface DashboardPageProps {
  status: BackendSystemStatus;
  onNavigateToVerification: () => void;
  onRefresh: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  status,
  onNavigateToVerification,
  onRefresh,
}) => {
  const isOnline = status.connection === 'connected';
  const isReady = isOnline && status.readiness?.ready_for_inference;

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
          System Overview
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Operational status of the Face Recognition & Challenge-Based Liveness Inference Backend.
        </p>
      </div>

      <div className="card-grid">
        <StatusCard
          title="Backend Connectivity"
          value={isOnline ? 'Online' : status.connection === 'checking' ? 'Connecting...' : 'Disconnected'}
          statusBadge={
            isOnline
              ? { text: '200 OK', variant: 'live' }
              : { text: status.connection === 'checking' ? 'CHECKING' : 'OFFLINE', variant: 'offline' }
          }
          description={
            status.root?.service
              ? `${status.root.service}`
              : isOnline
              ? 'FastAPI core running'
              : 'Could not reach local FastAPI server on 127.0.0.1:8000'
          }
        />

        <StatusCard
          title="Inference Readiness"
          value={isReady ? 'Ready' : 'Not Ready (Gated)'}
          statusBadge={
            isReady
              ? { text: 'READY', variant: 'ready' }
              : { text: 'FAIL-CLOSED', variant: 'not_ready' }
          }
          description={
            isReady
              ? 'All biometric models validated and ready for inference'
              : 'Model weights are unapproved or pending cryptographic clearance'
          }
        />

        <StatusCard
          title="PAD Model (MinFASNet)"
          value={status.readiness?.pad_model_approved ? 'Approved' : 'Unapproved'}
          statusBadge={
            status.readiness?.pad_model_approved
              ? { text: 'APPROVED', variant: 'ready' }
              : { text: 'UNAPPROVED', variant: 'not_ready' }
          }
          description="Presentation Attack Detection gate status (Silent Spoof Rejection)"
        />

        <StatusCard
          title="Embedding Model"
          value={status.readiness?.embedding_model_approved ? 'Approved' : 'Unapproved'}
          statusBadge={
            status.readiness?.embedding_model_approved
              ? { text: 'APPROVED', variant: 'ready' }
              : { text: 'UNAPPROVED', variant: 'not_ready' }
          }
          description="Face feature vector extraction (512-d normalized cosine embeddings)"
        />
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-title">
          <span>Security & Architectural Status</span>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '0.75rem', lineHeight: 1.6 }}>
          This web frontend serves as a local development, diagnostic, and manual verification console. The authoritative production client architecture remains the <strong>Android mobile client</strong> connected to the FastAPI control/inference planes.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onNavigateToVerification}
          >
            Launch Live Verification Console &rarr;
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onRefresh}
          >
            Poll Backend Status
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <span>Environment & Endpoints</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', fontSize: '0.85rem' }}>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Target Host:</span>
            <div style={{ fontFamily: 'var(--font-mono)', marginTop: '0.2rem' }}>http://127.0.0.1:8000</div>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Environment:</span>
            <div style={{ textTransform: 'capitalize', marginTop: '0.2rem' }}>{status.health?.environment || 'Unknown'}</div>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Interactive API Docs:</span>
            <div style={{ marginTop: '0.2rem' }}>
              {status.root?.docs_url ? (
                <a
                  href={`http://127.0.0.1:8000${status.root.docs_url}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}
                >
                  Swagger UI ({status.root.docs_url})
                </a>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>Disabled in non-debug mode</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
