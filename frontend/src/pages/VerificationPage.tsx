import React, { useState, useCallback, useEffect } from 'react';
import { useCamera } from '../hooks/useCamera';
import { CameraPanel } from '../components/CameraPanel';
import { ChallengePanel } from '../components/ChallengePanel';
import { ResultPanel } from '../components/ResultPanel';
import {
  createLivenessSession,
  submitVerificationEvidence,
  ApiError,
} from '../lib/api';
import type {
  ChallengeSessionCreateResponse,
  DecisionResponse,
  BackendSystemStatus,
} from '../lib/types';

interface VerificationPageProps {
  systemStatus: BackendSystemStatus;
}

export const VerificationPage: React.FC<VerificationPageProps> = ({ systemStatus }) => {
  const camera = useCamera();
  const [session, setSession] = useState<ChallengeSessionCreateResponse | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [capturedFrames, setCapturedFrames] = useState<Blob[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastDecision, setLastDecision] = useState<DecisionResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Stop camera when unmounting verification page
  const stopCameraRef = React.useRef(camera.stopCamera);
  useEffect(() => {
    stopCameraRef.current = camera.stopCamera;
  }, [camera.stopCamera]);

  useEffect(() => {
    return () => {
      stopCameraRef.current();
    };
  }, []);

  const handleStartSession = useCallback(async () => {
    setIsLoadingSession(true);
    setErrorMessage(null);
    setLastDecision(null);
    setCapturedFrames([]);

    try {
      const res = await createLivenessSession();
      setSession({
        ...res,
        created_at: Date.now(),
      });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMessage(`Failed to create challenge session: ${err.message}`);
      } else {
        setErrorMessage('Unexpected error while requesting challenge session from backend.');
      }
    } finally {
      setIsLoadingSession(false);
    }
  }, []);

  const handleResetSession = useCallback(() => {
    setSession(null);
    setCapturedFrames([]);
    setErrorMessage(null);
    setLastDecision(null);
  }, []);

  const handleCaptureFrame = useCallback(async () => {
    if (!camera.isActive) return;
    setIsCapturing(true);
    try {
      const frameBlob = await camera.captureFrame();
      if (frameBlob) {
        setCapturedFrames((prev) => [...prev, frameBlob]);
      }
    } catch (err: unknown) {
      console.warn('Frame capture failed:', err);
    } finally {
      setIsCapturing(false);
    }
  }, [camera]);

  const handleSubmitEvidence = useCallback(async () => {
    if (!session) return;
    if (capturedFrames.length === 0) {
      setErrorMessage('No captured frames to submit. Please capture at least one frame from the camera.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setLastDecision(null);

    try {
      const result = await submitVerificationEvidence(
        session.session_id,
        session.server_nonce,
        capturedFrames
      );
      setLastDecision(result);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 404 || err.status === 405 || err.status === 501) {
          setErrorMessage(
            `Inference endpoint (/v1/verifications) is not currently implemented on the backend. Challenge session creation, action sequence generation, and anti-replay nonce tracking are working as designed. Biometric inference requires backend inference route implementation.`
          );
        } else {
          setErrorMessage(`Verification error (HTTP ${err.status}): ${err.message}`);
        }
      } else {
        setErrorMessage(
          err instanceof Error ? err.message : 'Failed to communicate with verification endpoint.'
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [session, capturedFrames]);

  const isBackendOffline = systemStatus.connection !== 'connected';

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
          Live Verification Console
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Interactive challenge-response liveness verification using browser MediaDevices and backend control-plane sessions.
        </p>
      </div>

      {isBackendOffline && (
        <div className="alert alert-error" style={{ marginBottom: '1.5rem' }}>
          <span>
            <strong>Backend Unreachable:</strong> The backend is currently offline. Start the FastAPI server on 127.0.0.1:8000 to enable challenge session generation.
          </span>
        </div>
      )}

      <div className="verification-layout">
        <div>
          <CameraPanel
            videoRef={camera.videoRef}
            isActive={camera.isActive}
            isLoading={camera.isLoading}
            error={camera.error}
            permissionState={camera.permissionState}
            onStartCamera={camera.startCamera}
            onStopCamera={camera.stopCamera}
            onCaptureFrame={camera.isActive && session ? handleCaptureFrame : undefined}
            isCapturing={isCapturing}
            capturedCount={capturedFrames.length}
          />
        </div>

        <div>
          <ChallengePanel
            session={session}
            isLoading={isLoadingSession}
            onNewSession={handleStartSession}
            onResetSession={handleResetSession}
            onSubmitEvidence={handleSubmitEvidence}
            isSubmitting={isSubmitting}
            capturedFramesCount={capturedFrames.length}
          />
        </div>
      </div>

      <ResultPanel
        lastDecision={lastDecision}
        errorMessage={errorMessage}
        isProcessing={isSubmitting}
        onClear={() => {
          setLastDecision(null);
          setErrorMessage(null);
        }}
      />
    </div>
  );
};
