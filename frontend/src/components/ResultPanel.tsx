import React from 'react';
import type { DecisionResponse } from '../lib/types';

interface ResultPanelProps {
  lastDecision: DecisionResponse | null;
  errorMessage: string | null;
  isProcessing: boolean;
  onClear: () => void;
}

export const ResultPanel: React.FC<ResultPanelProps> = ({
  lastDecision,
  errorMessage,
  isProcessing,
  onClear,
}) => {
  if (!lastDecision && !errorMessage && !isProcessing) {
    return null;
  }

  const getDecisionBadge = (decision: string) => {
    switch (decision) {
      case 'MATCH':
        return { text: 'IDENTITY MATCHED', variant: 'live' };
      case 'NO_MATCH':
        return { text: 'NO MATCH', variant: 'warning' };
      case 'PAD_REJECTED':
        return { text: 'PRESENTATION ATTACK DETECTED', variant: 'error' };
      case 'QUALITY_REJECTED':
        return { text: 'LOW IMAGE QUALITY', variant: 'warning' };
      case 'SESSION_EXPIRED':
        return { text: 'SESSION EXPIRED', variant: 'error' };
      default:
        return { text: decision, variant: 'error' };
    }
  };

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <div className="card-title">
        <span>Backend Operation Result</span>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
          onClick={onClear}
        >
          Clear
        </button>
      </div>

      {isProcessing && (
        <div className="alert alert-info">
          <span>Processing biometric verification on backend... Please wait.</span>
        </div>
      )}

      {errorMessage && (
        <div className="alert alert-error">
          <div>
            <strong>Backend Notice / Error:</strong>
            <p style={{ marginTop: '0.25rem' }}>{errorMessage}</p>
          </div>
        </div>
      )}

      {lastDecision && (
        <div>
          {(() => {
            const badge = getDecisionBadge(lastDecision.decision);
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <span className={`status-badge ${badge.variant}`}>
                  <span className="status-dot" />
                  {badge.text}
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Request ID: {lastDecision.request_id}
                </span>
              </div>
            );
          })()}

          <p style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>
            {lastDecision.message}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.8rem' }}>
            {lastDecision.matched_person_id && (
              <div style={{ background: 'var(--bg-tertiary)', padding: '0.5rem 0.75rem', borderRadius: '4px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Person ID:</span>{' '}
                <strong>{lastDecision.matched_person_id}</strong>
              </div>
            )}
            {lastDecision.similarity_score !== undefined && lastDecision.similarity_score !== null && (
              <div style={{ background: 'var(--bg-tertiary)', padding: '0.5rem 0.75rem', borderRadius: '4px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Similarity Score:</span>{' '}
                <strong>{(lastDecision.similarity_score * 100).toFixed(1)}%</strong>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
