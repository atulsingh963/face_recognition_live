/**
 * Domain types matching backend schemas
 */

export type LivenessAction = 'blink' | 'turn_left' | 'turn_right' | 'smile' | 'nod';

export type DecisionCode =
  | 'MATCH'
  | 'NO_MATCH'
  | 'PAD_REJECTED'
  | 'QUALITY_REJECTED'
  | 'RETRY_REQUIRED'
  | 'SESSION_EXPIRED'
  | 'UNAUTHORIZED'
  | 'ERROR';

export interface RootResponse {
  service: string;
  docs_url: string | null;
  health_live_url: string;
  health_ready_url: string;
}

export interface HealthResponse {
  status: 'live' | string;
  environment: string;
}

export interface ReadinessResponse {
  status: 'ready' | 'not_ready' | string;
  pad_model_approved: boolean;
  embedding_model_approved: boolean;
  ready_for_inference: boolean;
}

export interface ChallengeSessionCreateResponse {
  session_id: string;
  actions: LivenessAction[];
  expires_in_seconds: number;
  server_nonce: string;
  created_at?: number;
}

export interface DecisionResponse {
  request_id: string;
  decision: DecisionCode;
  matched_person_id?: string | null;
  similarity_score?: number | null;
  message: string;
}

export type BackendConnectionState = 'checking' | 'connected' | 'disconnected' | 'error';

export interface BackendSystemStatus {
  connection: BackendConnectionState;
  health: HealthResponse | null;
  readiness: ReadinessResponse | null;
  root: RootResponse | null;
  lastChecked: Date | null;
  errorMessage: string | null;
}
