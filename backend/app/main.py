"""FastAPI application entrypoint with health, session creation, and error handling."""
import uuid
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel

from app.config.settings import settings
from app.domain.models import (
    ChallengeSessionCreateResponse,
    DecisionCode,
    DecisionResponse,
)
from app.auth.sessions import challenge_session_manager

app = FastAPI(
    title="Face Recognition & Liveness API",
    version="0.1.0",
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url=None,
)


class HealthResponse(BaseModel):
    status: str
    environment: str


class ReadinessResponse(BaseModel):
    status: str
    pad_model_approved: bool
    embedding_model_approved: bool
    ready_for_inference: bool


@app.get("/health/live", response_model=HealthResponse)
def health_live():
    return HealthResponse(
        status="live",
        environment=settings.ENVIRONMENT.value
    )


@app.get("/health/ready", response_model=ReadinessResponse)
def health_ready():
    # Fail readiness if model assets have not cleared the approval gate
    ready = settings.PAD_MODEL_APPROVED and settings.EMBEDDING_MODEL_APPROVED
    return ReadinessResponse(
        status="ready" if ready else "not_ready",
        pad_model_approved=settings.PAD_MODEL_APPROVED,
        embedding_model_approved=settings.EMBEDDING_MODEL_APPROVED,
        ready_for_inference=ready,
    )


@app.post("/v1/liveness-sessions", response_model=ChallengeSessionCreateResponse)
def create_liveness_session():
    """
    Control-plane endpoint: Creates a short-lived single-use liveness challenge session.
    No biometric image is transferred here.
    """
    record = challenge_session_manager.create_session()
    return ChallengeSessionCreateResponse(
        session_id=record.session_id,
        actions=record.actions,
        expires_in_seconds=settings.CHALLENGE_SESSION_EXPIRE_SECONDS,
        server_nonce=record.server_nonce,
    )
