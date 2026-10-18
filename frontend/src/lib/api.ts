import type {
  RootResponse,
  HealthResponse,
  ReadinessResponse,
  ChallengeSessionCreateResponse,
  DecisionResponse,
  LiveFrameAnalysisResponse,
} from './types';

export class ApiError extends Error {
  public status: number;
  public details?: unknown;

  constructor(message: string, status: number = 0, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

function getBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_BASE_URL;
  const rawUrl = typeof envUrl === 'string' && envUrl.trim().length > 0 ? envUrl.trim() : 'http://127.0.0.1:8000';
  return rawUrl.replace(/\/+$/, '');
}

export const API_BASE_URL = getBaseUrl();

async function request<T>(endpoint: string, options: RequestInit = {}, timeoutMs = 6000): Promise<T> {
  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });

    clearTimeout(timer);

    if (!response.ok) {
      let errorBody: unknown = null;
      let errorText = '';
      try {
        errorBody = await response.json();
        if (typeof errorBody === 'object' && errorBody !== null && 'detail' in errorBody) {
          errorText = String((errorBody as { detail: unknown }).detail);
        }
      } catch {
        errorText = await response.text().catch(() => '');
      }

      const msg = errorText || `HTTP ${response.status}: ${response.statusText}`;
      throw new ApiError(msg, response.status, errorBody);
    }

    const data: T = await response.json();
    return data;
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof ApiError) {
      throw err;
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(`Request timeout after ${timeoutMs}ms: ${url}`, 408);
    }
    if (err instanceof TypeError && err.message.toLowerCase().includes('failed to fetch')) {
      throw new ApiError(
        `Unable to connect to backend at ${API_BASE_URL}. Ensure FastAPI is running on ${API_BASE_URL} and CORS is enabled.`,
        0
      );
    }
    throw new ApiError(err instanceof Error ? err.message : 'Unknown network error', 0);
  }
}

/**
 * Fetch root service discovery metadata
 */
export async function fetchRoot(): Promise<RootResponse> {
  return request<RootResponse>('/');
}

/**
 * Fetch live health status (GET /health/live)
 */
export async function fetchHealthLive(): Promise<HealthResponse> {
  return request<HealthResponse>('/health/live');
}

/**
 * Fetch model readiness status (GET /health/ready)
 */
export async function fetchHealthReady(): Promise<ReadinessResponse> {
  return request<ReadinessResponse>('/health/ready');
}

/**
 * Request creation of a new challenge-based liveness session (POST /v1/liveness-sessions)
 */
export async function createLivenessSession(): Promise<ChallengeSessionCreateResponse> {
  return request<ChallengeSessionCreateResponse>('/v1/liveness-sessions', {
    method: 'POST',
  });
}

/**
 * Attempt to submit verification evidence to the backend.
 * Checks for a real verification endpoint and reports honestly if not yet implemented.
 */
export async function submitVerificationEvidence(
  sessionId: string,
  nonce: string,
  frames: Blob[]
): Promise<DecisionResponse> {
  const formData = new FormData();
  formData.append('session_id', sessionId);
  formData.append('server_nonce', nonce);
  frames.forEach((frame, idx) => {
    formData.append('frames', frame, `frame_${idx}.jpg`);
  });

  return request<DecisionResponse>('/v1/verifications', {
    method: 'POST',
    body: formData,
  });
}

/**
 * Send a live preview frame from the camera to the backend for real-time YuNet detection & MiniFASNet PAD.
 */
export async function analyzeLiveFrame(frame: Blob): Promise<LiveFrameAnalysisResponse> {
  const formData = new FormData();
  formData.append('frame', frame, 'live_preview.jpg');

  return request<LiveFrameAnalysisResponse>('/v1/live-detection', {
    method: 'POST',
    body: formData,
  }, 3000);
}
