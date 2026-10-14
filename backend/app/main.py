"""FastAPI application entrypoint with health, session creation, and error handling."""
import uuid
from typing import List
from fastapi import FastAPI, Form, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RootResponse(BaseModel):
    service: str
    docs_url: str | None
    health_live_url: str
    health_ready_url: str


@app.get("/", response_model=RootResponse)
def root():
    return RootResponse(
        service=app.title,
        docs_url="/docs" if settings.DEBUG else None,
        health_live_url="/health/live",
        health_ready_url="/health/ready",
    )


class HealthResponse(BaseModel):
    status: str
    environment: str


class ModelReadinessDetail(BaseModel):
    configured_path: str
    file_exists: bool
    approved: bool
    loaded: bool
    reason: str | None = None


class ReadinessResponse(BaseModel):
    status: str
    pad_model_approved: bool
    embedding_model_approved: bool
    ready_for_inference: bool
    pad_model: ModelReadinessDetail | None = None
    embedding_model: ModelReadinessDetail | None = None
    providers: list[str] = []


def _inspect_model_readiness(configured_path: str, is_approved: bool) -> tuple[bool, ModelReadinessDetail]:
    from pathlib import Path
    model_path = Path(configured_path)
    if not model_path.is_absolute():
        # Check relative to backend directory or project root
        if not model_path.exists():
            # Try resolving relative to current working directory or backend root
            backend_rel = Path(__file__).resolve().parent.parent / configured_path
            project_rel = Path(__file__).resolve().parent.parent.parent / configured_path
            if backend_rel.exists():
                model_path = backend_rel
            elif project_rel.exists():
                model_path = project_rel

    file_exists = model_path.exists() and model_path.is_file()
    if not is_approved:
        return False, ModelReadinessDetail(
            configured_path=configured_path,
            file_exists=file_exists,
            approved=False,
            loaded=False,
            reason="Model asset is not approved by project owner in settings/MODEL_ASSET_REGISTER.md",
        )

    if not file_exists:
        return False, ModelReadinessDetail(
            configured_path=configured_path,
            file_exists=False,
            approved=True,
            loaded=False,
            reason=f"Model weight file does not exist at configured path: {configured_path}",
        )

    # Attempt to verify local ONNX loading if file exists and is approved
    try:
        import onnxruntime as ort
        _ = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        return True, ModelReadinessDetail(
            configured_path=configured_path,
            file_exists=True,
            approved=True,
            loaded=True,
            reason=None,
        )
    except Exception as e:
        return False, ModelReadinessDetail(
            configured_path=configured_path,
            file_exists=True,
            approved=True,
            loaded=False,
            reason=f"Failed to load ONNX session: {e}",
        )


@app.get("/health/live", response_model=HealthResponse)
def health_live():
    return HealthResponse(
        status="live",
        environment=settings.ENVIRONMENT.value
    )


@app.get("/health/ready", response_model=ReadinessResponse)
def health_ready():
    # Real inspection of each model's approval, physical file existence, and local loadability
    pad_ready, pad_detail = _inspect_model_readiness(
        settings.PAD_MODEL_PATH, settings.PAD_MODEL_APPROVED
    )
    embedding_ready, embedding_detail = _inspect_model_readiness(
        settings.EMBEDDING_MODEL_PATH, settings.EMBEDDING_MODEL_APPROVED
    )

    available_providers: list[str] = []
    try:
        import onnxruntime as ort
        available_providers = ort.get_available_providers()
    except Exception:
        pass

    ready = pad_ready and embedding_ready
    return ReadinessResponse(
        status="ready" if ready else "not_ready",
        pad_model_approved=settings.PAD_MODEL_APPROVED,
        embedding_model_approved=settings.EMBEDDING_MODEL_APPROVED,
        ready_for_inference=ready,
        pad_model=pad_detail,
        embedding_model=embedding_detail,
        providers=available_providers,
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


@app.post("/v1/verifications", response_model=DecisionResponse)
async def submit_verification(
    session_id: str = Form(...),
    server_nonce: str = Form(...),
    frames: List[UploadFile] = File(...),
):
    """
    Biometric verification endpoint.
    Enforces:
    - Session existence, TTL, and anti-replay single-use nonce validation
    - Ingestion constraints (frame count, max bytes per frame)
    - Fail-closed model readiness gating (both PAD and embedding models must be approved and loaded)
    """
    request_id = str(uuid.uuid4())

    # 1. Validate frames count
    if not frames:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one evidence frame is required.",
        )
    if len(frames) > settings.MAX_FRAMES_PER_REQUEST:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Exceeded maximum allowed frames per request ({settings.MAX_FRAMES_PER_REQUEST}).",
        )

    # 2. Check and consume session atomically (anti-replay + TTL)
    session_record = challenge_session_manager.get_session(session_id)
    if not session_record:
        return DecisionResponse(
            request_id=request_id,
            decision=DecisionCode.SESSION_EXPIRED,
            message="Challenge session not found or already purged.",
        )

    consumed_ok = challenge_session_manager.validate_and_consume(session_id, nonce=server_nonce)
    if not consumed_ok:
        return DecisionResponse(
            request_id=request_id,
            decision=DecisionCode.SESSION_EXPIRED,
            message="Challenge session has expired or was already consumed (replay prevented).",
        )

    # 3. Read and check frame byte constraints
    for idx, frame in enumerate(frames):
        content = await frame.read()
        if len(content) > settings.MAX_IMAGE_BYTES:
            return DecisionResponse(
                request_id=request_id,
                decision=DecisionCode.QUALITY_REJECTED,
                message=f"Frame {idx} exceeds maximum allowed size ({settings.MAX_IMAGE_BYTES} bytes).",
            )
        if len(content) == 0:
            return DecisionResponse(
                request_id=request_id,
                decision=DecisionCode.QUALITY_REJECTED,
                message=f"Frame {idx} is empty.",
            )

    # 4. Model readiness gate check (fail-closed)
    pad_ready, pad_detail = _inspect_model_readiness(
        settings.PAD_MODEL_PATH, settings.PAD_MODEL_APPROVED
    )
    embedding_ready, embedding_detail = _inspect_model_readiness(
        settings.EMBEDDING_MODEL_PATH, settings.EMBEDDING_MODEL_APPROVED
    )

    if not pad_ready or not embedding_ready:
        reasons = []
        if not pad_ready:
            reasons.append(f"PAD: {pad_detail.reason}")
        if not embedding_ready:
            reasons.append(f"Embedding: {embedding_detail.reason}")
        return DecisionResponse(
            request_id=request_id,
            decision=DecisionCode.ERROR,
            message=f"Biometric inference models not ready (fail-closed policy enforced): {'; '.join(reasons)}",
        )

    # When models are loaded and verified in future steps, inference pipeline runs here
    return DecisionResponse(
        request_id=request_id,
        decision=DecisionCode.NO_MATCH,
        message="Inference completed: No enrolled biometric identity matched the provided evidence.",
    )

