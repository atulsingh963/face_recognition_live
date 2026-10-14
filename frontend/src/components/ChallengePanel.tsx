import React, { useEffect, useState } from 'react';
import type { ChallengeSessionCreateResponse, LivenessAction } from '../lib/types';

interface ChallengePanelProps {
  session: ChallengeSessionCreateResponse | null;
  isLoading: boolean;
  onNewSession: () => void;
  onResetSession: () => void;
  onSubmitEvidence?: () => void;
  isSubmitting?: boolean;
  capturedFramesCount: number;
}

const ACTION_DESCRIPTIONS: Record<LivenessAction, { title: string; hint: string }> = {
  blink: {
    title: 'Blink Eyes',
    hint: 'Blink both eyes naturally within the camera view.',
  },
  turn_left: {
    title: 'Turn Head Left',
    hint: 'Slowly turn your head to your left side and return to center.',
  },
  turn_right: {
    title: 'Turn Head Right',
    hint: 'Slowly turn your head to your right side and return to center.',
  },
  smile: {
    title: 'Smile',
    hint: 'Show a clear smile towards the camera.',
  },
  nod: {
    title: 'Nod Head',
    hint: 'Gently nod your head up and down.',
  },
};

export const ChallengePanel: React.FC<ChallengePanelProps> = ({
  session,
  isLoading,
  onNewSession,
  onResetSession,
  onSubmitEvidence,
  isSubmitting = false,
  capturedFramesCount,
}) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!session) return;

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [session]);

  const createdAt = session?.created_at ?? 0;
  const elapsedSeconds = createdAt > 0 ? (now - createdAt) / 1000 : 0;
  const secondsRemaining = session
    ? Math.max(0, Math.ceil(session.expires_in_seconds - elapsedSeconds))
    : 0;
  const isExpired = session !== null && secondsRemaining === 0;

  return (
    <div className="card">
      <div className="card-title">
        <span>Active Challenge Session</span>
        {session ? (
          <span className={`status-badge ${isExpired ? 'error' : 'live'}`}>
            <span className="status-dot" />
            {isExpired ? 'EXPIRED' : `${secondsRemaining}s REMAINING`}
          </span>
        ) : (
          <span className="status-badge offline">
            <span className="status-dot" />
            NO SESSION
          </span>
        )}
      </div>

      {!session ? (
        <div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            To begin live verification, request a single-use randomized challenge from the backend. The backend will generate action requirements and an anti-replay nonce with a strict time-to-live.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onNewSession}
            disabled={isLoading}
          >
            {isLoading ? 'Creating Session...' : 'Create Challenge Session'}
          </button>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <span>Session ID</span>
              <span className="code-snippet" style={{ fontSize: '0.75rem' }}>{session.session_id}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
              <span>Anti-replay Nonce</span>
              <span className="code-snippet" style={{ fontSize: '0.75rem' }}>{session.server_nonce.slice(0, 16)}...</span>
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              REQUIRED ACTIONS ({session.actions.length} steps):
            </span>
            {session.actions.map((act, index) => {
              const info = ACTION_DESCRIPTIONS[act] || { title: act, hint: 'Perform requested movement' };
              return (
                <div key={`${act}-${index}`} className="challenge-step">
                  <div className="challenge-step-badge">{index + 1}</div>
                  <div>
                    <div className="challenge-action-text">{info.title}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{info.hint}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {isExpired && (
            <div className="alert alert-error">
              <span>This challenge session has expired. You must generate a new session.</span>
            </div>
          )}

          <div className="alert alert-info">
            <span>
              <strong>Security Policy:</strong> Client-side animation or movement completion is NOT verification. Verification occurs strictly on the backend via Presentation Attack Detection (PAD) and feature embedding matching.
            </span>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            {onSubmitEvidence && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={onSubmitEvidence}
                disabled={isExpired || isSubmitting || capturedFramesCount === 0}
              >
                {isSubmitting ? 'Submitting to Backend...' : `Submit Verification Evidence (${capturedFramesCount})`}
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onResetSession}
            >
              Reset Session
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
