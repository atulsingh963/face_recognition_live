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
    const isNetworkError =
      err instanceof TypeError ||
      (err instanceof Error &&
        (err.message.toLowerCase().includes('fetch') ||
          err.message.toLowerCase().includes('network') ||
          err.message.toLowerCase().includes('load failed')));
    if (isNetworkError) {
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

// Token management in localStorage
const TOKEN_KEY = 'fr_auth_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): HeadersInit {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Register student account (POST /v1/auth/register)
 */
export async function registerStudent(payload: {
  first_name: string;
  last_name: string;
  roll_number: string;
  password: string;
  confirm_password: string;
}) {
  return request<import('./types').StudentProfile>('/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * Login student account (POST /v1/auth/login)
 */
export async function loginStudent(payload: { roll_number: string; password: string }) {
  const data = await request<import('./types').TokenResponse>('/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (data?.access_token) {
    setStoredToken(data.access_token);
  }
  return data;
}

/**
 * Fetch authenticated student profile (GET /v1/auth/me)
 */
export async function fetchCurrentStudent() {
  return request<import('./types').StudentProfile>('/v1/auth/me', {
    headers: authHeaders(),
  });
}

/**
 * Enroll student biometric template (POST /v1/enrollment)
 */
export async function enrollFaceTemplate(consent: boolean, frames: Blob[]) {
  const formData = new FormData();
  formData.append('consent', String(consent));
  frames.forEach((frame, idx) => {
    formData.append('frames', frame, `enroll_frame_${idx}.jpg`);
  });

  return request<import('./types').BiometricEnrollmentResponse>('/v1/enrollment', {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  }, 15000);
}

/**
 * Delete / revoke enrolled biometric template (DELETE /v1/enrollment)
 */
export async function revokeBiometricTemplate() {
  return request<import('./types').BiometricEnrollmentResponse>('/v1/enrollment', {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

/**
 * Submit attendance verification evidence for authenticated student (POST /v1/attendance/verify)
 */
export async function verifyAttendance(sessionId: string, nonce: string, frames: Blob[]) {
  const formData = new FormData();
  formData.append('session_id', sessionId);
  formData.append('server_nonce', nonce);
  frames.forEach((frame, idx) => {
    formData.append('frames', frame, `att_frame_${idx}.jpg`);
  });

  return request<DecisionResponse>('/v1/attendance/verify', {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  }, 15000);
}

/**
 * Fetch student attendance history (GET /v1/attendance/history)
 */
export async function fetchAttendanceHistory() {
  return request<import('./types').AttendanceHistoryResponse>('/v1/attendance/history', {
    headers: authHeaders(),
  });
}

