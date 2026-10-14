import React from 'react';
import type { CameraPermissionState } from '../hooks/useCamera';

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
}) => {
  return (
    <div className="card">
      <div className="card-title">
        <span>Live Camera View</span>
        <span className={`status-badge ${isActive ? 'live' : 'offline'}`}>
          <span className="status-dot" />
          {isActive ? 'FEED ACTIVE' : 'CAMERA OFF'}
        </span>
      </div>

      <div className="camera-container">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="camera-video"
          style={{ display: isActive ? 'block' : 'none' }}
        />

        {isActive ? (
          <div className="camera-overlay">
            <div className={`face-guide-oval ${isActive ? 'active' : ''}`} />
          </div>
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
            <p style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>Camera is not streaming</p>
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

      <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
