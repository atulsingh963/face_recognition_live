import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useCamera } from '../hooks/useCamera';
import { CameraPanel } from '../components/CameraPanel';
import {
  enrollFaceTemplate,
  revokeBiometricTemplate,
  analyzeLiveFrame,
  ApiError,
} from '../lib/api';
import type {
  StudentProfile,
  BackendSystemStatus,
  LiveFrameAnalysisResponse,
} from '../lib/types';

interface EnrollmentPageProps {
  student: StudentProfile;
  systemStatus: BackendSystemStatus;
  onEnrollmentComplete: () => void;
}

export const EnrollmentPage: React.FC<EnrollmentPageProps> = ({
  student,
  systemStatus,
  onEnrollmentComplete,
}) => {
  const camera = useCamera();
  const [consentGiven, setConsentGiven] = useState(false);
  const [capturedFrames, setCapturedFrames] = useState<Blob[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [liveAnalysis, setLiveAnalysis] = useState<LiveFrameAnalysisResponse | null>(null);
  const isAnalyzingRef = useRef(false);

  // Stop camera on unmount
  const stopCameraRef = useRef(camera.stopCamera);
  useEffect(() => {
    stopCameraRef.current = camera.stopCamera;
  }, [camera.stopCamera]);

  useEffect(() => {
    return () => {
      stopCameraRef.current();
    };
  }, []);

  // Real-time live frame detection loop
  useEffect(() => {
    if (!camera.isActive || systemStatus.connection !== 'connected') {
      setLiveAnalysis(null);
      return;
    }

    let isSubscribed = true;
    const interval = setInterval(async () => {
      if (isAnalyzingRef.current || !isSubscribed) return;
      isAnalyzingRef.current = true;
      try {
        const frame = await camera.captureFrame();
        if (frame && isSubscribed) {
          const res = await analyzeLiveFrame(frame);
          if (isSubscribed) setLiveAnalysis(res);
        }
      } catch {
        // Ignore live stream frame drop
      } finally {
        isAnalyzingRef.current = false;
      }
    }, 450);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [camera.isActive, camera.captureFrame, systemStatus.connection]);

  const handleCaptureFrame = useCallback(async () => {
    if (!camera.isActive) return;
    const frame = await camera.captureFrame();
    if (frame) {
      setCapturedFrames((prev) => [...prev, frame]);
    }
  }, [camera]);

  const handleEnroll = async () => {
    if (!consentGiven) {
      setErrorMessage('You must review and accept the biometric consent terms before enrolling.');
      return;
    }
    if (capturedFrames.length === 0) {
      setErrorMessage('Please capture at least 1 high-quality frame from the camera.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const res = await enrollFaceTemplate(consentGiven, capturedFrames);
      setStatusMessage(res.message);
      setCapturedFrames([]);
      onEnrollmentComplete();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Failed to enroll biometric template.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async () => {
    if (!confirm('Are you sure you want to permanently delete your enrolled biometric template?')) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const res = await revokeBiometricTemplate();
      setStatusMessage(res.message);
      onEnrollmentComplete();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Failed to revoke template.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Biometric Face Enrollment
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Capture and register your facial biometric template for {student.first_name} {student.last_name} ({student.roll_number}).
        </p>
      </div>

      {errorMessage && (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          {errorMessage}
        </div>
      )}

      {statusMessage && (
        <div className="alert alert-ready" style={{ marginBottom: '1rem' }}>
          {statusMessage}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) 380px', gap: '1.5rem', alignItems: 'start' }}>
        <div>
          <CameraPanel
            videoRef={camera.videoRef}
            isActive={camera.isActive}
            isLoading={camera.isLoading}
            error={camera.error}
            permissionState={camera.permissionState}
            onStartCamera={camera.startCamera}
            onStopCamera={camera.stopCamera}
            onCaptureFrame={camera.isActive ? handleCaptureFrame : undefined}
            isCapturing={false}
            capturedCount={capturedFrames.length}
            liveAnalysis={liveAnalysis}
            isDetecting={camera.isActive}
          />
        </div>

        <div>
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="card-title">
              <span>Enrollment Status</span>
              <span className={`status-badge ${student.is_enrolled ? 'ready' : 'not_ready'}`}>
                {student.is_enrolled ? 'ENROLLED' : 'NOT ENROLLED'}
              </span>
            </div>

            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              {student.is_enrolled
                ? 'Your biometric template is stored securely in your local database. You can re-enroll at any time to refresh your template, or revoke it below.'
                : 'Complete the steps below to enroll: grant consent, activate camera, capture 1-3 clear front-facing frames, and submit.'}
            </p>

            <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem', border: '1px solid var(--border-color)' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                  style={{ marginTop: '0.2rem' }}
                />
                <span>
                  <strong>Informed Biometric Consent:</strong> I agree to have my facial features extracted as a 512-dimensional numerical embedding vector stored strictly in my local database (`local_data/attendance.db`). Raw images/videos will not be kept.
                </span>
              </label>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                type="button"
                disabled={isSubmitting || !consentGiven || capturedFrames.length === 0}
                className="btn btn-primary"
                onClick={handleEnroll}
                style={{ padding: '0.65rem' }}
              >
                {isSubmitting
                  ? 'Processing Models...'
                  : student.is_enrolled
                  ? `Re-enroll with ${capturedFrames.length} Captured Frame(s)`
                  : `Submit Enrollment (${capturedFrames.length} Frame(s))`}
              </button>

              {capturedFrames.length > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCapturedFrames([])}
                  style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                >
                  Clear Captured Frames
                </button>
              )}

              {student.is_enrolled && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  className="btn btn-secondary"
                  onClick={handleRevoke}
                  style={{ color: '#ef4444', borderColor: '#ef4444', marginTop: '0.5rem' }}
                >
                  Revoke & Delete Biometric Template
                </button>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-title">
              <span>Enrollment Quality Guidelines</span>
            </div>
            <ul style={{ paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <li>Position your face centered in the camera frame.</li>
              <li>Ensure good front-facing lighting with minimal glare.</li>
              <li>Maintain a neutral expression without accessories obscuring eyes.</li>
              <li>MiniFASNet evaluates passive liveness to reject screen and paper attacks.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
