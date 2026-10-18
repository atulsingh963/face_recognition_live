import React from 'react';
import type { CameraPermissionState } from '../hooks/useCamera';
import type { LiveFrameAnalysisResponse } from '../lib/types';

interface CameraPanelProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isActive: boolean;
  isLoading: boolean;
  error: string | null;
  permissionState: CameraPermissionState;
  onStartCamera: () => void;
  onStopCamera: () => void;
  onCaptureFrame?: () => void;
  isCapturing?: boolean;
  capturedCount?: number;
  liveAnalysis?: LiveFrameAnalysisResponse | null;
  isDetecting?: boolean;
}

export const CameraPanel: React.FC<CameraPanelProps> = ({
  videoRef,
  isActive,
  isLoading,
  error,
  permissionState,
  onStartCamera,
  onStopCamera,
  onCaptureFrame,
  isCapturing = false,
  capturedCount = 0,
  liveAnalysis = null,
  isDetecting = false,
}) => {
  const faces = liveAnalysis?.faces || [];
  const primaryFace = faces.length > 0 ? faces[0] : null;

  const [aspectRatio, setAspectRatio] = React.useState<string>('4 / 3');

  const handleLoadedMetadata = React.useCallback(() => {
    const video = videoRef.current;
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      setAspectRatio(`${video.videoWidth} / ${video.videoHeight}`);
    }
  }, [videoRef]);

  return (
    <div className="card">
      <div className="card-title">
        <span>Live Camera View</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {isActive && (
            <span
              className={`status-badge ${primaryFace ? 'ready' : 'warning'}`}
              style={{ fontSize: '0.7rem' }}
            >
              <span className="status-dot" />
              {primaryFace
                ? `FACE DETECTED (${(primaryFace.score * 100).toFixed(0)}%)`
                : isDetecting
                ? 'SCANNING...'
                : 'NO FACE'}
            </span>
          )}
          <span className={`status-badge ${isActive ? 'live' : 'offline'}`}>
            <span className="status-dot" />
            {isActive ? 'FEED ACTIVE' : 'CAMERA OFF'}
          </span>
        </div>
      </div>

      <div className="camera-container" style={{ aspectRatio: isActive ? aspectRatio : '4 / 3' }}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          onLoadedMetadata={handleLoadedMetadata}
          className="camera-video"
          style={{ display: isActive ? 'block' : 'none' }}
        />

        {isActive ? (
          <>
            {/* Guide oval centered layer */}
            <div className="face-guide-layer">
              <div
                className={`face-guide-oval ${primaryFace ? 'active' : ''}`}
                style={{
                  borderColor: primaryFace
                    ? primaryFace.pad_outcome === 'REAL'
                      ? 'var(--accent-emerald)'
                      : primaryFace.pad_outcome === 'SPOOF'
                      ? 'var(--accent-rose)'
                      : 'var(--accent-amber)'
                    : undefined,
                }}
              />
            </div>

            {/* Real-time bounding box and landmark overlay layer (mirrored to match video transform) */}
            <div className="camera-overlay">
              {faces.map((f, idx) => {
                const nb = f.norm_bbox;
                // Mirror X coordinate because camera video has transform: scaleX(-1)
                const leftPercent = (1 - (nb.x + nb.width)) * 100;
                const topPercent = nb.y * 100;
                const widthPercent = nb.width * 100;
                const heightPercent = nb.height * 100;

                const isReal = f.pad_outcome === 'REAL';
                const isSpoof = f.pad_outcome === 'SPOOF';
                const boxColor = isReal
                  ? 'rgba(16, 185, 129, 0.9)'
                  : isSpoof
                  ? 'rgba(239, 68, 68, 0.9)'
                  : 'rgba(59, 130, 246, 0.9)';
                const bgColor = isReal
                  ? 'rgba(16, 185, 129, 0.15)'
                  : isSpoof
                  ? 'rgba(239, 68, 68, 0.15)'
                  : 'rgba(59, 130, 246, 0.15)';

                return (
                  <React.Fragment key={`face-${idx}`}>
                    {/* Bounding Box */}
                    <div
                      style={{
                        position: 'absolute',
                        left: `${leftPercent}%`,
                        top: `${topPercent}%`,
                        width: `${widthPercent}%`,
                        height: `${heightPercent}%`,
                        border: `2px solid ${boxColor}`,
                        borderRadius: '8px',
                        backgroundColor: bgColor,
                        boxShadow: `0 0 10px ${boxColor}`,
                        pointerEvents: 'none',
                        transition: 'all 0.08s ease-out',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          top: '-24px',
                          left: '0',
                          backgroundColor: boxColor,
                          color: '#fff',
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          whiteSpace: 'nowrap',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        Face #{idx + 1} • {f.pad_outcome || 'DET'}{' '}
                        {f.pad_score !== null && f.pad_score !== undefined
                          ? `(${(f.pad_score * 100).toFixed(0)}%)`
                          : ''}
                      </div>
                    </div>

                    {/* Landmark points (5 keypoints) */}
                    {(f.norm_landmarks || []).map((lm, lmIdx) => (
                      <div
                        key={`face-${idx}-lm-${lmIdx}`}
                        style={{
                          position: 'absolute',
                          left: `${(1 - lm.x) * 100}%`,
                          top: `${lm.y * 100}%`,
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: boxColor,
                          boxShadow: `0 0 6px ${boxColor}`,
                          transform: 'translate(-50%, -50%)',
                          pointerEvents: 'none',
                        }}
                      />
                    ))}
                  </React.Fragment>
                );
              })}

              {/* Real-time telemetry badge */}
              {primaryFace && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '12px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    backgroundColor: 'rgba(15, 23, 42, 0.85)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '0.75rem',
                    display: 'flex',
                    gap: '1rem',
                    backdropFilter: 'blur(4px)',
                  }}
                >
                  <span>
                    Confidence: <strong>{(primaryFace.score * 100).toFixed(1)}%</strong>
                  </span>
                  <span>
                    PAD Liveness:{' '}
                    <strong
                      style={{
                        color:
                          primaryFace.pad_outcome === 'REAL'
                            ? 'var(--accent-emerald)'
                            : primaryFace.pad_outcome === 'SPOOF'
                            ? 'var(--accent-rose)'
                            : 'var(--accent-amber)',
                      }}
                    >
                      {primaryFace.pad_outcome || 'EVALUATING'}
                    </strong>
                  </span>
                  {liveAnalysis && (
                    <span style={{ color: 'var(--text-muted)' }}>
                      Latency: {liveAnalysis.timestamp_ms.toFixed(0)}ms
                    </span>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="camera-placeholder">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ margin: '0 auto 0.75rem', color: 'var(--text-muted)' }}
            >
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
              <circle cx="12" cy="13" r="3" />
            </svg>
            <p style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>
              Camera is not streaming
            </p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
              Click "Start Camera" below to grant permission and enable the video feed.
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginTop: '1rem' }}>
          <span>{error}</span>
        </div>
      )}

      {permissionState === 'denied' && (
        <div className="alert alert-warning" style={{ marginTop: '0.75rem' }}>
          <span>
            Permission Denied: To use live verification, click the camera lock icon in your browser URL bar and set Camera to "Allow", then retry.
          </span>
        </div>
      )}

      <div
        style={{
          marginTop: '1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div className="camera-controls">
          {!isActive ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onStartCamera}
              disabled={isLoading}
            >
              {isLoading ? 'Starting Camera...' : 'Start Camera'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-danger"
              onClick={onStopCamera}
            >
              Stop Camera
            </button>
          )}

          {isActive && onCaptureFrame && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onCaptureFrame}
              disabled={isCapturing}
            >
              {isCapturing ? 'Capturing...' : `Capture Evidence Frame (${capturedCount})`}
            </button>
          )}
        </div>

        {isActive && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Face positioning: Keep face centered within the oval guide
          </span>
        )}
      </div>
    </div>
  );
};
