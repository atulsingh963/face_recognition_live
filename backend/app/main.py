"""FastAPI application entrypoint with health, sessions, real-time live detection, and verification."""

import io
import time
import uuid
from pathlib import Path
from typing import List
from fastapi import FastAPI, Form, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

from app.config.settings import settings
from app.domain.models import (
    BoundingBox,
    ChallengeSessionCreateResponse,
    DecisionCode,
    DecisionResponse,
    LandmarkPoint,
    LiveFaceDetection,
    LiveFrameAnalysisResponse,
    NormalizedBoundingBox,
    PadOutcome,
)
from app.auth.sessions import challenge_session_manager
from app.domain.detector import detector
from app.liveness.pad_adapter import pad_detector
from app.embeddings.provider import embedding_provider

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
    detector_model: ModelReadinessDetail | None = None
    pad_model: ModelReadinessDetail | None = None
    embedding_model: ModelReadinessDetail | None = None
    providers: list[str] = []


def _resolve_model_path(configured_path: str) -> Path:
    model_path = Path(configured_path)
    if not model_path.is_absolute():
        backend_rel = Path(__file__).resolve().parent.parent / configured_path
        project_rel = Path(__file__).resolve().parent.parent.parent / configured_path
        if backend_rel.exists():
            model_path = backend_rel
        elif project_rel.exists():
            model_path = project_rel
    return model_path


def _inspect_model_readiness(
    configured_path: str, is_approved: bool
) -> tuple[bool, ModelReadinessDetail]:
    model_path = _resolve_model_path(configured_path)
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
        environment=settings.ENVIRONMENT.value,
    )


@app.get("/health/ready", response_model=ReadinessResponse)
def health_ready():
    # Real inspection of each model's approval, physical file existence, and local loadability
    detector_ready, detector_detail = _inspect_model_readiness(settings.DETECTOR_MODEL_PATH, True)
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

    ready = detector_ready and pad_ready and embedding_ready
    return ReadinessResponse(
        status="ready" if ready else "not_ready",
        pad_model_approved=settings.PAD_MODEL_APPROVED,
        embedding_model_approved=settings.EMBEDDING_MODEL_APPROVED,
        ready_for_inference=ready,
        detector_model=detector_detail,
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


@app.post("/v1/live-detection", response_model=LiveFrameAnalysisResponse)
async def analyze_live_frame(frame: UploadFile = File(...)):
    """
    Real-time lightweight face detection and passive liveness analysis for camera stream.
    Consumes a single video preview frame, detects bounding boxes and landmarks using YuNet,
    and runs MiniFASNet PAD on the detected face crops to provide live feedback overlays.
    """
    t_start = time.time()
    content = await frame.read()

    if len(content) == 0 or len(content) > settings.MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid frame size ({len(content)} bytes).",
        )

    try:
        pil_img = Image.open(io.BytesIO(content)).convert("RGB")
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not parse image: {e}",
        )

    # 1. Run YuNet detector
    detected_faces = detector.detect(pil_img)
    live_faces: List[LiveFaceDetection] = []

    # 2. For each face, crop and run MiniFASNet PAD
    for face in detected_faces:
        x, y, w, h = face.box
        # Expand crop margin slightly for PAD
        pad_margin = 0.2
        crop_x1 = max(0, int(x - w * pad_margin))
        crop_y1 = max(0, int(y - h * pad_margin))
        crop_x2 = min(pil_img.width, int(x + w * (1 + pad_margin)))
        crop_y2 = min(pil_img.height, int(y + h * (1 + pad_margin)))

        if (crop_x2 - crop_x1) > 10 and (crop_y2 - crop_y1) > 10:
            face_crop = pil_img.crop((crop_x1, crop_y1, crop_x2, crop_y2))
            pad_outcome, pad_score = pad_detector.predict(face_crop)
        else:
            pad_outcome, pad_score = PadOutcome.UNCERTAIN, 0.0

        live_faces.append(
            LiveFaceDetection(
                bbox=BoundingBox(x=x, y=y, width=w, height=h),
                norm_bbox=NormalizedBoundingBox(
                    x=face.norm_box[0],
                    y=face.norm_box[1],
                    width=face.norm_box[2],
                    height=face.norm_box[3],
                ),
                score=face.score,
                pad_outcome=pad_outcome,
                pad_score=pad_score,
                landmarks=[LandmarkPoint(x=lx, y=ly) for lx, ly in face.landmarks],
            )
        )

    duration_ms = (time.time() - t_start) * 1000.0

    return LiveFrameAnalysisResponse(
        face_count=len(live_faces),
        faces=live_faces,
        model_ready=detector.is_loaded and pad_detector.is_loaded,
        timestamp_ms=duration_ms,
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
    - Fail-closed model readiness gating (PAD, detector, and embedding models must be approved and loaded)
    - Face detection, liveness verification, and embedding extraction across evidence frames
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

    # 3. Model readiness gate check (fail-closed)
    detector_ready, det_detail = _inspect_model_readiness(settings.DETECTOR_MODEL_PATH, True)
    pad_ready, pad_detail = _inspect_model_readiness(
        settings.PAD_MODEL_PATH, settings.PAD_MODEL_APPROVED
    )
    embedding_ready, embedding_detail = _inspect_model_readiness(
        settings.EMBEDDING_MODEL_PATH, settings.EMBEDDING_MODEL_APPROVED
    )

    if not detector_ready or not pad_ready or not embedding_ready:
        reasons = []
        if not detector_ready:
            reasons.append(f"Detector: {det_detail.reason}")
        if not pad_ready:
            reasons.append(f"PAD: {pad_detail.reason}")
        if not embedding_ready:
            reasons.append(f"Embedding: {embedding_detail.reason}")
        return DecisionResponse(
            request_id=request_id,
            decision=DecisionCode.ERROR,
            message=f"Biometric inference models not ready (fail-closed policy enforced): {'; '.join(reasons)}",
        )

    # 4. Read and decode evidence frames
    parsed_images: List[Image.Image] = []
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
        try:
            pil_img = Image.open(io.BytesIO(content)).convert("RGB")
            parsed_images.append(pil_img)
        except Exception as e:
            return DecisionResponse(
                request_id=request_id,
                decision=DecisionCode.QUALITY_REJECTED,
                message=f"Frame {idx} could not be decoded: {e}",
            )

    # 5. Process each frame through detector and PAD
    extracted_embeddings = []
    total_faces_detected = 0
    pad_rejections = 0

    for idx, img in enumerate(parsed_images):
        detected = detector.detect(img)
        if not detected:
            continue
        total_faces_detected += len(detected)

        # Focus on primary face
        primary_face = detected[0]
        x, y, w, h = primary_face.box

        pad_margin = 0.2
        cx1 = max(0, int(x - w * pad_margin))
        cy1 = max(0, int(y - h * pad_margin))
        cx2 = min(img.width, int(x + w * (1 + pad_margin)))
        cy2 = min(img.height, int(y + h * (1 + pad_margin)))
        face_crop = img.crop((cx1, cy1, cx2, cy2))

        pad_outcome, pad_score = pad_detector.predict(face_crop)
        if pad_outcome == PadOutcome.SPOOF:
            pad_rejections += 1
            continue

        # Extract embedding
        emb = embedding_provider.embed(face_crop)
        extracted_embeddings.append(emb)

    if total_faces_detected == 0:
        return DecisionResponse(
            request_id=request_id,
            decision=DecisionCode.QUALITY_REJECTED,
            message="No face detected in any of the submitted evidence frames. Please ensure your face is well-lit and clearly centered.",
        )

    if pad_rejections > 0 and len(extracted_embeddings) == 0:
        return DecisionResponse(
            request_id=request_id,
            decision=DecisionCode.PAD_REJECTED,
            message="Presentation attack detected: evidence failed passive liveness (anti-spoofing) validation.",
        )

    # 6. Biometric identity matching
    # In live verification mode without a pre-registered database match:
    return DecisionResponse(
        request_id=request_id,
        decision=DecisionCode.NO_MATCH,
        similarity_score=0.0,
        message=f"Inference complete: {len(extracted_embeddings)} valid liveness frame(s) analyzed. No enrolled biometric identity matched the provided evidence.",
    )
