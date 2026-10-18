import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useCamera } from '../hooks/useCamera';
import { CameraPanel } from '../components/CameraPanel';
import { ChallengePanel } from '../components/ChallengePanel';
import { ResultPanel } from '../components/ResultPanel';
import {
  createLivenessSession,
  verifyAttendance,
  analyzeLiveFrame,
  ApiError,
} from '../lib/api';
import type {
  ChallengeSessionCreateResponse,
  DecisionResponse,
  BackendSystemStatus,
  LiveFrameAnalysisResponse,
  StudentProfile,
} from '../lib/types';

interface VerificationPageProps {
  systemStatus: BackendSystemStatus;
  student?: StudentProfile | null;
  onNavigateToEnrollment?: () => void;
}

export const VerificationPage: React.FC<VerificationPageProps> = ({
  systemStatus,
  student,
  onNavigateToEnrollment,
}) => {
  const camera = useCamera();
  const [session, setSession] = useState<ChallengeSessionCreateResponse | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [capturedFrames, setCapturedFrames] = useState<Blob[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastDecision, setLastDecision] = useState<DecisionResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Real-time live detection state
  const [liveAnalysis, setLiveAnalysis] = useState<LiveFrameAnalysisResponse | null>(null);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const isAnalyzingRef = useRef<boolean>(false);

  // Stop camera when unmounting verification page
  const stopCameraRef = useRef(camera.stopCamera);
  useEffect(() => {
    stopCameraRef.current = camera.stopCamera;
  }, [camera.stopCamera]);

  useEffect(() => {
    return () => {
      stopCameraRef.current();
    };
  }, []);

  // Periodic real-time frame inference loop when camera is active
  useEffect(() => {
    if (!camera.isActive || systemStatus.connection !== 'connected') {
      setLiveAnalysis(null);
      setIsDetecting(false);
      return;
    }

    let isSubscribed = true;
    setIsDetecting(true);

    const intervalId = setInterval(async () => {
      if (isAnalyzingRef.current || !isSubscribed) return;

      isAnalyzingRef.current = true;
      try {
        const frameBlob = await camera.captureFrame();
        if (frameBlob && isSubscribed) {
          const analysis = await analyzeLiveFrame(frameBlob);
          if (isSubscribed) {
            setLiveAnalysis(analysis);
          }
        }
      } catch (err: unknown) {
        if (import.meta.env.DEV) {
          console.debug('Live frame analysis tick error:', err);
        }
      } finally {
        isAnalyzingRef.current = false;
      }
    }, 400);

    return () => {
      isSubscribed = false;
      clearInterval(intervalId);
      setIsDetecting(false);
    };
  }, [camera.isActive, camera.captureFrame, systemStatus.connection]);

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
      const result = await verifyAttendance(
        session.session_id,
        session.server_nonce,
        capturedFrames
      );
      setLastDecision(result);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMessage(`Verification error (HTTP ${err.status}): ${err.message}`);
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
          Attendance Verification Console
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          {student
            ? `Marking official attendance for ${student.first_name} ${student.last_name} (${student.roll_number}) with server-controlled liveness challenges.`
            : 'Interactive challenge-response liveness verification and identity matching.'}
        </p>
      </div>

      {isBackendOffline && (
        <div className="alert alert-error" style={{ marginBottom: '1.5rem' }}>
          <span>
            <strong>Backend Unreachable:</strong> The backend is currently offline. Start the FastAPI server on 127.0.0.1:8000 to enable real-time inference and challenge sessions.
          </span>
        </div>
      )}

      {student && !student.is_enrolled && (
        <div className="alert alert-error" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            <strong>Face Enrollment Required:</strong> You must complete biometric face enrollment before attendance can be marked.
          </span>
          {onNavigateToEnrollment && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
              onClick={onNavigateToEnrollment}
            >
              Go to Face Enrollment &rarr;
            </button>
          )}
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
            liveAnalysis={liveAnalysis}
            isDetecting={isDetecting}
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
