import { useState, useRef, useCallback, useEffect } from 'react';

export type CameraPermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported';

interface UseCameraReturn {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  isActive: boolean;
  isLoading: boolean;
  error: string | null;
  permissionState: CameraPermissionState;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  captureFrame: () => Promise<Blob | null>;
}

export function useCamera(): UseCameraReturn {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const hasMediaDevices = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isActive, setIsActive] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(() =>
    hasMediaDevices ? null : 'MediaDevices API is not supported in this browser.'
  );
  const [permissionState, setPermissionState] = useState<CameraPermissionState>(() =>
    hasMediaDevices ? 'prompt' : 'unsupported'
  );

  const playPromiseRef = useRef<Promise<void> | null>(null);
  const startOperationIdRef = useRef<number>(0);

  const stopCamera = useCallback(() => {
    // Invalidate any ongoing start operation
    startOperationIdRef.current += 1;
    playPromiseRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStream(null);
    setIsActive(false);
    setIsLoading(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Camera access is not supported by your browser.');
      setPermissionState('unsupported');
      return;
    }

    const currentOpId = ++startOperationIdRef.current;
    setIsLoading(true);
    setError(null);

    // Clean up any existing stream before starting a new one
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
        audio: false,
      });

      // If a newer start or stop operation occurred while waiting for getUserMedia, discard this stream
      if (currentOpId !== startOperationIdRef.current) {
        mediaStream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = mediaStream;
      setStream(mediaStream);
      setPermissionState('granted');
      setIsActive(true);

      const video = videoRef.current;
      if (video) {
        video.srcObject = mediaStream;

        // Prevent overlapping play calls
        if (playPromiseRef.current) {
          try {
            await playPromiseRef.current;
          } catch {
            // Ignore previous play interruption
          }
        }

        if (currentOpId !== startOperationIdRef.current) {
          return;
        }

        try {
          const promise = video.play();
          playPromiseRef.current = promise;
          await promise;
        } catch (playErr: unknown) {
          // Gracefully ignore AbortError caused by rapid play/pause, cleanup, or source replacement
          if (playErr instanceof DOMException && playErr.name === 'AbortError') {
            return;
          }
          console.warn('Video play error:', playErr);
        } finally {
          if (playPromiseRef.current) {
            playPromiseRef.current = null;
          }
        }
      }
    } catch (err: unknown) {
      if (currentOpId !== startOperationIdRef.current) {
        return;
      }
      stopCamera();
      if (err instanceof DOMException) {
        if (err.name === 'AbortError') {
          // Expected cancellation / interruption; do not surface as failure
          return;
        }
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setPermissionState('denied');
          setError('Camera permission was denied. Please allow camera access in browser settings.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setError('No camera device detected on this system.');
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          setError('Camera is currently in use by another application.');
        } else {
          setError(`Camera error: ${err.message}`);
        }
      } else {
        setError(err instanceof Error ? err.message : 'Unknown camera initialization error');
      }
    } finally {
      if (currentOpId === startOperationIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [stopCamera]);

  const captureFrame = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || !isActive || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Draw the current video frame onto canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (blob) => {
          resolve(blob);
        },
        'image/jpeg',
        0.85
      );
    });
  }, [isActive]);

  // Clean up on component unmount
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      startOperationIdRef.current += 1;
      playPromiseRef.current = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (video) {
        video.srcObject = null;
      }
    };
  }, []);

  return {
    videoRef,
    stream,
    isActive,
    isLoading,
    error,
    permissionState,
    startCamera,
    stopCamera,
    captureFrame,
  };
}
