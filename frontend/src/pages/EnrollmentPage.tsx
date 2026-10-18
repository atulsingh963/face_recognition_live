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

const REQUIRED_FRAMES_COUNT = 3;
const COOLDOWN_BETWEEN_CAPTURES_MS = 600;

export const EnrollmentPage: React.FC<EnrollmentPageProps> = ({
  student,
  systemStatus,
  onEnrollmentComplete,
}) => {
  const camera = useCamera();
  const [consentGiven, setConsentGiven] = useState(false);
  const [capturedFrames, setCapturedFrames] = useState<Blob[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [liveAnalysis, setLiveAnalysis] = useState<LiveFrameAnalysisResponse | null>(null);
  const [guidanceTip, setGuidanceTip] = useState<string>('Grant consent to start face enrollment.');
  const [isQualityGood, setIsQualityGood] = useState(false);

  const isAnalyzingRef = useRef(false);
  const isCapturingRef = useRef(false);
  const lastCaptureTimeRef = useRef<number>(0);
  const autoSubmittedRef = useRef<boolean>(false);
  const capturedFramesRef = useRef<Blob[]>([]);
  capturedFramesRef.current = capturedFrames;

  // Track start camera function reference
  const startCameraRef = useRef(camera.startCamera);
  useEffect(() => {
    startCameraRef.current = camera.startCamera;
  }, [camera.startCamera]);

  // Clean camera shutdown on unmount
  const stopCameraRef = useRef(camera.stopCamera);
  useEffect(() => {
    stopCameraRef.current = camera.stopCamera;
  }, [camera.stopCamera]);

  useEffect(() => {
    return () => {
      stopCameraRef.current();
    };
  }, []);

  // 1. Auto-start camera once consent is granted (or if user granted permission earlier)
  useEffect(() => {
    if (
      consentGiven &&
      !camera.isActive &&
      !camera.isLoading &&
      camera.permissionState !== 'denied'
    ) {
      void startCameraRef.current();
    }
  }, [consentGiven, camera.isActive, camera.isLoading, camera.permissionState]);

  // Real-time live frame detection loop
  useEffect(() => {
    if (!camera.isActive || systemStatus.connection !== 'connected') {
      setLiveAnalysis(null);
      setIsQualityGood(false);
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
          if (isSubscribed) {
            setLiveAnalysis(res);
          }
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

  // Evaluate face quality & auto-capture evidence frames
  useEffect(() => {
    if (!camera.isActive) {
      if (!consentGiven) {
        setGuidanceTip('Review and check Informed Biometric Consent to start camera.');
      } else if (camera.permissionState === 'denied') {
        setGuidanceTip('Camera permission denied. Please allow camera in browser URL bar.');
      } else if (camera.isLoading) {
        setGuidanceTip('Requesting camera access...');
      } else {
        setGuidanceTip('Camera stopped. Click Start Camera to resume.');
      }
      setIsQualityGood(false);
      return;
    }

    if (isSubmitting || autoSubmittedRef.current) {
      setGuidanceTip('Enrolling facial template with backend models...');
      return;
    }

    if (capturedFrames.length >= REQUIRED_FRAMES_COUNT) {
      setGuidanceTip(`Captured ${REQUIRED_FRAMES_COUNT}/${REQUIRED_FRAMES_COUNT} frames! Submitting enrollment...`);
      return;
    }

    if (!liveAnalysis) {
      setGuidanceTip('Analyzing camera feed for your face...');
      setIsQualityGood(false);
      return;
    }

    const faces = liveAnalysis.faces || [];
    if (faces.length === 0) {
      setGuidanceTip('No face detected. Position your face in front of the camera.');
      setIsQualityGood(false);
      return;
    }

    if (faces.length > 1) {
      setGuidanceTip('Multiple faces detected. Please ensure only you are in frame.');
      setIsQualityGood(false);
      return;
    }

    const face = faces[0];
    const { norm_bbox, score, pad_outcome, pad_score } = face;

    // Quality criteria:
    // 1. Detection confidence
    if (score < 0.70) {
      setGuidanceTip('Face detection confidence low. Please look straight at the camera.');
      setIsQualityGood(false);
      return;
    }

    // 2. Anti-spoofing / liveness
    if (pad_outcome === 'SPOOF') {
      setGuidanceTip('Liveness check flagged spoofing or poor lighting. Keep natural face visible.');
      setIsQualityGood(false);
      return;
    }
    if (pad_score !== null && pad_score !== undefined && pad_score < 0.50) {
      setGuidanceTip('Improving liveness confidence. Ensure bright, even lighting.');
      setIsQualityGood(false);
      return;
    }

    // 3. Face size
    if (norm_bbox.width < 0.22 || norm_bbox.height < 0.22) {
      setGuidanceTip('Move a bit closer to the camera.');
      setIsQualityGood(false);
      return;
    }
    if (norm_bbox.width > 0.85 || norm_bbox.height > 0.85) {
      setGuidanceTip('Move slightly back from the camera.');
      setIsQualityGood(false);
      return;
    }

    // 4. Centering within the guide
    const centerX = norm_bbox.x + norm_bbox.width / 2;
    const centerY = norm_bbox.y + norm_bbox.height / 2;
    if (centerX < 0.28 || centerX > 0.72 || centerY < 0.22 || centerY > 0.78) {
      setGuidanceTip('Center your face inside the oval guide.');
      setIsQualityGood(false);
      return;
    }

    // Face is centered and genuine!
    setIsQualityGood(true);
    setGuidanceTip(
      `Face aligned and verified! Hold still (${capturedFrames.length}/${REQUIRED_FRAMES_COUNT} frames captured)`
    );

    // Auto-capture frame if enabled and cooldown elapsed
    const now = Date.now();
    if (
      autoCaptureEnabled &&
      capturedFrames.length < REQUIRED_FRAMES_COUNT &&
      !isCapturingRef.current &&
      now - lastCaptureTimeRef.current >= COOLDOWN_BETWEEN_CAPTURES_MS
    ) {
      lastCaptureTimeRef.current = now;
      isCapturingRef.current = true;
      void (async () => {
        try {
          const frameBlob = await camera.captureFrame();
          if (frameBlob) {
            setCapturedFrames((prev) => {
              if (prev.length < REQUIRED_FRAMES_COUNT) {
                return [...prev, frameBlob];
              }
              return prev;
            });
          }
        } catch (err) {
          console.debug('Auto-capture frame error:', err);
        } finally {
          isCapturingRef.current = false;
        }
      })();
    }
  }, [
    camera,
    consentGiven,
    isSubmitting,
    capturedFrames.length,
    liveAnalysis,
    autoCaptureEnabled,
  ]);

  // Submit enrollment implementation
  const submitEnrollment = useCallback(
    async (framesToSubmit: Blob[]) => {
      if (!consentGiven) {
        setErrorMessage('You must review and accept the biometric consent terms before enrolling.');
        return;
      }
      if (framesToSubmit.length === 0) {
        setErrorMessage('Please capture at least 1 high-quality frame from the camera.');
        return;
      }

      setIsSubmitting(true);
      setErrorMessage(null);
      setStatusMessage(null);

      try {
        const res = await enrollFaceTemplate(consentGiven, framesToSubmit);
        setStatusMessage(res.message);
        setCapturedFrames([]);
        stopCameraRef.current();
        onEnrollmentComplete();
      } catch (err: unknown) {
        autoSubmittedRef.current = false;
        if (err instanceof ApiError) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage('Failed to enroll biometric template.');
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [consentGiven, onEnrollmentComplete]
  );

  // 3. Auto-submit once REQUIRED_FRAMES_COUNT is reached
  useEffect(() => {
    if (
      capturedFrames.length >= REQUIRED_FRAMES_COUNT &&
      !isSubmitting &&
      !autoSubmittedRef.current &&
      consentGiven
    ) {
      autoSubmittedRef.current = true;
      void submitEnrollment(capturedFrames);
    }
  }, [capturedFrames, isSubmitting, consentGiven, submitEnrollment]);

  // Manual capture fallback
  const handleCaptureFrame = useCallback(async () => {
    if (!camera.isActive) return;
    const frame = await camera.captureFrame();
    if (frame) {
      setCapturedFrames((prev) => [...prev, frame]);
    }
  }, [camera]);

  const handleManualEnroll = async () => {
    autoSubmittedRef.current = true;
    await submitEnrollment(capturedFramesRef.current);
  };

  const handleResetFrames = () => {
    autoSubmittedRef.current = false;
    setCapturedFrames([]);
    setErrorMessage(null);
    setStatusMessage(null);
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
        <div className="alert alert-error" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{errorMessage}</span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleResetFrames}
            style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', marginLeft: '1rem' }}
          >
            Retry Capture
          </button>
        </div>
      )}

      {statusMessage && (
        <div className="alert alert-ready" style={{ marginBottom: '1rem' }}>
          {statusMessage}
        </div>
      )}

      {/* Real-time Guidance Banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          marginBottom: '1rem',
          backgroundColor: isQualityGood ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.12)',
          border: `1px solid ${isQualityGood ? 'rgba(16, 185, 129, 0.35)' : 'rgba(59, 130, 246, 0.3)'}`,
          transition: 'all 0.2s ease',
        }}
      >
        <span
          className="status-dot"
          style={{
            backgroundColor: isQualityGood ? 'var(--accent-emerald)' : 'var(--accent-blue)',
            boxShadow: `0 0 8px ${isQualityGood ? 'var(--accent-emerald)' : 'var(--accent-blue)'}`,
          }}
        />
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)' }}>
            {guidanceTip}
          </span>
          {camera.isActive && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Progress:
              </span>
              <div
                style={{
                  display: 'flex',
                  gap: '4px',
                }}
              >
                {Array.from({ length: REQUIRED_FRAMES_COUNT }).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      width: '20px',
                      height: '8px',
                      borderRadius: '4px',
                      backgroundColor:
                        i < capturedFrames.length
                          ? 'var(--accent-emerald)'
                          : 'var(--border-subtle)',
                      transition: 'background-color 0.2s ease',
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

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
            isCapturing={isSubmitting}
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
                ? 'Your biometric template is stored securely in your local database. Check consent to auto-start the camera and re-enroll to refresh your template.'
                : 'Grant consent below. The camera will automatically start, detect your face, capture high-quality evidence frames, and submit your enrollment without manual clicks.'}
            </p>

            <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem', border: '1px solid var(--border-color)' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={consentGiven}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setConsentGiven(checked);
                    if (checked && !camera.isActive) {
                      void camera.startCamera();
                    }
                  }}
                  style={{ marginTop: '0.2rem' }}
                />
                <span>
                  <strong>Informed Biometric Consent:</strong> I agree to have my facial features extracted as a 512-dimensional numerical embedding vector stored strictly in my local database (`local_data/attendance.db`). Raw images/videos will not be kept.
                </span>
              </label>
            </div>

            {/* Auto-capture toggle switch */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', background: 'var(--bg-tertiary)', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.8rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Automatic Frame Capture:</span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={autoCaptureEnabled}
                  onChange={(e) => setAutoCaptureEnabled(e.target.checked)}
                />
                <span style={{ color: autoCaptureEnabled ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                  {autoCaptureEnabled ? 'Enabled (Automatic)' : 'Manual Mode'}
                </span>
              </label>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                type="button"
                disabled={isSubmitting || !consentGiven || capturedFrames.length === 0}
                className="btn btn-primary"
                onClick={handleManualEnroll}
                style={{ padding: '0.65rem' }}
              >
                {isSubmitting
                  ? 'Processing Models & Enrolling...'
                  : student.is_enrolled
                  ? `Re-enroll with ${capturedFrames.length} Captured Frame(s)`
                  : `Submit Enrollment (${capturedFrames.length}/${REQUIRED_FRAMES_COUNT} Frame(s))`}
              </button>

              {capturedFrames.length > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleResetFrames}
                  style={{ padding: '0.4rem', fontSize: '0.8rem' }}
                >
                  Clear Captured Frames ({capturedFrames.length})
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
              <li>Camera automatically starts once consent is checked.</li>
              <li>Position face inside the oval guide and look directly into the camera.</li>
              <li>3 evidence frames will automatically capture once genuine liveness is verified.</li>
              <li>Enrollment submits automatically with zero clicks required.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

