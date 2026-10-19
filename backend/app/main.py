"""FastAPI application entrypoint with student registration, login, biometric enrollment, and attendance."""

import io
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional
import numpy as np
from fastapi import FastAPI, Form, File, HTTPException, UploadFile, status, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config.settings import settings
from app.database import (
    init_db,
    get_db,
    Student,
    BiometricTemplate,
    AttendanceRecord,
)
from app.auth.security import (
    hash_password,
    verify_password,
    normalize_roll_number,
    validate_roll_number,
    create_access_token,
    is_rate_limited,
    record_login_failure,
    reset_rate_limit,
    get_current_student,
)
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
    StudentRegisterRequest,
    StudentLoginRequest,
    TokenResponse,
    StudentProfileResponse,
    BiometricEnrollmentResponse,
    AttendanceRecordResponse,
    AttendanceHistoryResponse,
)
from app.auth.sessions import challenge_session_manager
from app.domain.detector import detector
from app.liveness.pad_adapter import pad_detector
from app.embeddings.provider import embedding_provider

# Initialize local SQLite tables on app startup
init_db()

app = FastAPI(
    title="Face Recognition & Liveness Attendance API",
    version="0.2.0",
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,
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
    configured_path: str, is_approved: bool, is_singleton_loaded: bool | None = None
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

    if is_singleton_loaded is not None:
        if is_singleton_loaded:
            return True, ModelReadinessDetail(
                configured_path=configured_path,
                file_exists=True,
                approved=True,
                loaded=True,
                reason=None,
            )
        else:
            return False, ModelReadinessDetail(
                configured_path=configured_path,
                file_exists=True,
                approved=True,
                loaded=False,
                reason="Model session failed to initialize on startup",
            )

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
    detector_ready, detector_detail = _inspect_model_readiness(
        settings.DETECTOR_MODEL_PATH, True, detector.is_loaded
    )
    pad_ready, pad_detail = _inspect_model_readiness(
        settings.PAD_MODEL_PATH, settings.PAD_MODEL_APPROVED, pad_detector.is_loaded
    )
    embedding_ready, embedding_detail = _inspect_model_readiness(
        settings.EMBEDDING_MODEL_PATH,
        settings.EMBEDDING_MODEL_APPROVED,
        embedding_provider.is_loaded,
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


# -------------------------------------------------------------
# Authentication & Student Registration Endpoints
# -------------------------------------------------------------

@app.post("/v1/auth/register", response_model=StudentProfileResponse, status_code=status.HTTP_201_CREATED)
def register_student(req: StudentRegisterRequest, db: Session = Depends(get_db)):
    """Register a new student with roll number and Argon2id hashed password."""
    # 1. Validate inputs
    first_name = req.first_name.strip()
    last_name = req.last_name.strip()
    if not first_name or not last_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="First name and last name are required.",
        )

    if not validate_roll_number(req.roll_number):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Roll number format invalid. Must match regex: {settings.ROLL_NUMBER_REGEX}",
        )

    norm_roll = normalize_roll_number(req.roll_number)

    if len(req.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters long.",
        )

    if req.password != req.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password and confirmation do not match.",
        )

    # 2. Check for duplicate roll number
    existing = db.query(Student).filter(Student.roll_number == norm_roll).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A student with roll number '{norm_roll}' is already registered.",
        )

    # 3. Create student record
    pw_hash = hash_password(req.password)
    student = Student(
        roll_number=norm_roll,
        first_name=first_name,
        last_name=last_name,
        password_hash=pw_hash,
        is_active=True,
        is_enrolled=False,
    )
    db.add(student)
    db.commit()
    db.refresh(student)

    return StudentProfileResponse(
        id=student.id,
        roll_number=student.roll_number,
        first_name=student.first_name,
        last_name=student.last_name,
        is_enrolled=student.is_enrolled,
        is_active=student.is_active,
        created_at=student.created_at.isoformat(),
    )


@app.post("/v1/auth/login", response_model=TokenResponse)
def login_student(req: StudentLoginRequest, request: Request, db: Session = Depends(get_db)):
    """Authenticate student using roll number and password, with rate limiting."""
    norm_roll = normalize_roll_number(req.roll_number)
    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"{client_ip}:{norm_roll}"

    if is_rate_limited(rate_key, max_attempts=10, window_seconds=60):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts. Please wait 60 seconds before trying again.",
        )

    student = db.query(Student).filter(Student.roll_number == norm_roll, Student.is_active == True).first()
    if not student or not verify_password(req.password, student.password_hash):
        record_login_failure(rate_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid roll number or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Reset rate limit counter on successful authentication
    reset_rate_limit(rate_key)

    token = create_access_token(
        data={"sub": student.roll_number, "student_id": student.id},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in_minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES,
        roll_number=student.roll_number,
        first_name=student.first_name,
        last_name=student.last_name,
        is_enrolled=student.is_enrolled,
    )


@app.get("/v1/auth/me", response_model=StudentProfileResponse)
def get_my_profile(current_student: Student = Depends(get_current_student)):
    """Get profile information for the authenticated student."""
    return StudentProfileResponse(
        id=current_student.id,
        roll_number=current_student.roll_number,
        first_name=current_student.first_name,
        last_name=current_student.last_name,
        is_enrolled=current_student.is_enrolled,
        is_active=current_student.is_active,
        created_at=current_student.created_at.isoformat(),
    )


# -------------------------------------------------------------
# Biometric Enrollment Endpoints
# -------------------------------------------------------------

@app.post("/v1/enrollment", response_model=BiometricEnrollmentResponse)
async def enroll_student_face(
    consent: bool = Form(...),
    frames: List[UploadFile] = File(...),
    current_student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    Enroll a student's face:
    1. Verify informed consent.
    2. Check fail-closed model readiness.
    3. Run YuNet detector, MiniFASNet PAD, and ArcFace 5-point alignment on evidence frames.
    4. Compute high-quality average embedding.
    5. Save protected template to local SQLite database; mark student enrolled.
    Raw frames are discarded from memory immediately.
    """
    if not consent:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Informed biometric consent must be explicitly granted prior to enrollment.",
        )

    if not frames:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one face frame is required for enrollment.",
        )

    if len(frames) > settings.MAX_FRAMES_PER_REQUEST:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Exceeded maximum allowed frames ({settings.MAX_FRAMES_PER_REQUEST}).",
        )

    # Fail-closed model readiness check
    if not (detector.is_loaded and pad_detector.is_loaded and embedding_provider.is_loaded):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Biometric models are not loaded or unapproved (fail-closed).",
        )

    valid_embeddings: list[np.ndarray] = []
    pad_scores: list[float] = []

    for idx, frame in enumerate(frames):
        content = await frame.read()
        if len(content) == 0 or len(content) > settings.MAX_IMAGE_BYTES:
            continue

        try:
            pil_img = Image.open(io.BytesIO(content)).convert("RGB")
        except Exception:
            continue

        # Detect face
        faces = detector.detect(pil_img)
        if not faces:
            continue

        primary = faces[0]
        x, y, w, h = primary.box

        # PAD crop
        pad_scale = 1.8
        cx = x + w / 2.0
        cy = y + h / 2.0
        cw = w * pad_scale
        ch = h * pad_scale
        cx1 = max(0, int(cx - cw / 2.0))
        cy1 = max(0, int(cy - ch / 2.0))
        cx2 = min(pil_img.width, int(cx + cw / 2.0))
        cy2 = min(pil_img.height, int(cy + ch / 2.0))
        pad_crop = pil_img.crop((cx1, cy1, cx2, cy2))

        pad_outcome, pad_score = pad_detector.predict(pad_crop)
        if pad_outcome == PadOutcome.SPOOF:
            continue

        # Extract aligned embedding
        emb = embedding_provider.embed(pil_img, primary.landmarks)
        valid_embeddings.append(emb)
        pad_scores.append(pad_score)

    if not valid_embeddings:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enrollment failed: No genuine, high-quality face samples detected in the submitted camera frames. Please ensure good lighting and look directly into the camera.",
        )

    # Compute mean normalized embedding
    mean_emb = np.mean(valid_embeddings, axis=0)
    mean_emb_norm = mean_emb / float(np.linalg.norm(mean_emb))
    emb_bytes = mean_emb_norm.astype(np.float32).tobytes()
    avg_quality = float(np.mean(pad_scores))

    # Save or update template
    existing_template = (
        db.query(BiometricTemplate).filter(BiometricTemplate.student_id == current_student.id).first()
    )
    if existing_template:
        existing_template.embedding = emb_bytes
        existing_template.sample_quality_score = avg_quality
        existing_template.consent_given = True
        existing_template.consent_timestamp = datetime.now(timezone.utc)
        existing_template.enrolled_at = datetime.now(timezone.utc)
    else:
        new_template = BiometricTemplate(
            student_id=current_student.id,
            embedding=emb_bytes,
            dimension=settings.EMBEDDING_DIMENSION,
            consent_given=True,
            consent_timestamp=datetime.now(timezone.utc),
            sample_quality_score=avg_quality,
        )
        db.add(new_template)

    current_student.is_enrolled = True
    db.commit()

    return BiometricEnrollmentResponse(
        success=True,
        message=f"Biometric template successfully enrolled using {len(valid_embeddings)} verified live frame(s).",
        is_enrolled=True,
        sample_quality_score=avg_quality,
    )


@app.delete("/v1/enrollment", response_model=BiometricEnrollmentResponse)
def revoke_biometric_template(
    current_student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """Biometric revocation & privacy control: Delete student template and mark un-enrolled."""
    template = (
        db.query(BiometricTemplate).filter(BiometricTemplate.student_id == current_student.id).first()
    )
    if template:
        db.delete(template)

    current_student.is_enrolled = False
    db.commit()

    return BiometricEnrollmentResponse(
        success=True,
        message="Biometric template has been completely deleted from local storage.",
        is_enrolled=False,
        sample_quality_score=0.0,
    )


# -------------------------------------------------------------
# Liveness Challenge & Real-time Live Frame Analysis
# -------------------------------------------------------------

@app.post("/v1/liveness-sessions", response_model=ChallengeSessionCreateResponse)
def create_liveness_session():
    """Control-plane endpoint: Creates a short-lived single-use liveness challenge session."""
    record = challenge_session_manager.create_session()
    return ChallengeSessionCreateResponse(
        session_id=record.session_id,
        actions=record.actions,
        expires_in_seconds=settings.CHALLENGE_SESSION_EXPIRE_SECONDS,
        server_nonce=record.server_nonce,
    )


@app.post("/v1/live-detection", response_model=LiveFrameAnalysisResponse)
async def analyze_live_frame(frame: UploadFile = File(...)):
    """Real-time lightweight face detection and passive PAD on camera stream."""
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

    detected_faces = detector.detect(pil_img)
    live_faces: List[LiveFaceDetection] = []

    for face in detected_faces:
        x, y, w, h = face.box
        pad_scale = 1.8
        cx = x + w / 2.0
        cy = y + h / 2.0
        cw = w * pad_scale
        ch = h * pad_scale
        crop_x1 = max(0, int(cx - cw / 2.0))
        crop_y1 = max(0, int(cy - ch / 2.0))
        crop_x2 = min(pil_img.width, int(cx + cw / 2.0))
        crop_y2 = min(pil_img.height, int(cy + ch / 2.0))

        if (crop_x2 - crop_x1) > 10 and (crop_y2 - crop_y1) > 10:
            face_crop = pil_img.crop((crop_x1, crop_y1, crop_x2, crop_y2))
            pad_outcome, pad_score = pad_detector.predict(face_crop)
        else:
            pad_outcome, pad_score = PadOutcome.UNCERTAIN, 0.0

        norm_lm = [
            LandmarkPoint(
                x=float(lx / pil_img.width),
                y=float(ly / pil_img.height),
            )
            for lx, ly in face.landmarks
        ]

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
                norm_landmarks=norm_lm,
            )
        )

    duration_ms = (time.time() - t_start) * 1000.0

    return LiveFrameAnalysisResponse(
        face_count=len(live_faces),
        faces=live_faces,
        model_ready=detector.is_loaded and pad_detector.is_loaded,
        timestamp_ms=duration_ms,
    )


# -------------------------------------------------------------
# Attendance Verification & Audit History Endpoints
# -------------------------------------------------------------

@app.post("/v1/attendance/verify", response_model=DecisionResponse)
async def verify_attendance(
    session_id: str = Form(...),
    server_nonce: str = Form(...),
    frames: List[UploadFile] = File(...),
    current_student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    Verify attendance for the authenticated student:
    1. Check if student is enrolled with template.
    2. Check duplicate attendance rate limit within configurable window (e.g. 60 mins).
    3. Validate and consume single-use challenge session (anti-replay + TTL).
    4. Run real detector, PAD, and ArcFace models.
    5. Compare cosine similarity against student's enrolled template.
    6. Record attendance transactionally if similarity >= MATCH_SIMILARITY_THRESHOLD.
    """
    request_id = str(uuid.uuid4())

    # 1. Check enrollment
    template = (
        db.query(BiometricTemplate).filter(BiometricTemplate.student_id == current_student.id).first()
    )
    if not template or not current_student.is_enrolled:
        return DecisionResponse(
            request_id=request_id,
            decision=DecisionCode.UNAUTHORIZED,
            message="Student face is not enrolled. Please complete face enrollment before marking attendance.",
        )

    # 2. Duplicate attendance prevention within window
    now_utc = datetime.now(timezone.utc)
    cutoff_time = now_utc - timedelta(minutes=settings.ATTENDANCE_WINDOW_MINUTES)
    recent_attendance = (
        db.query(AttendanceRecord)
        .filter(
            AttendanceRecord.student_id == current_student.id,
            AttendanceRecord.timestamp >= cutoff_time,
            AttendanceRecord.status == "PRESENT",
        )
        .order_by(AttendanceRecord.timestamp.desc())
        .first()
    )
    if recent_attendance:
        rec_time = recent_attendance.timestamp
        if rec_time.tzinfo is None:
            rec_time = rec_time.replace(tzinfo=timezone.utc)
        mins_ago = max(0, int((now_utc - rec_time).total_seconds() / 60))
        return DecisionResponse(
            request_id=request_id,
            decision=DecisionCode.RETRY_REQUIRED,
            similarity_score=recent_attendance.similarity_score,
            message=f"Attendance already marked {mins_ago} minute(s) ago. Minimum attendance interval is {settings.ATTENDANCE_WINDOW_MINUTES} minutes.",
        )

    # 3. Frames validation
    if not frames:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one evidence frame is required.",
        )
    if len(frames) > settings.MAX_FRAMES_PER_REQUEST:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Exceeded maximum allowed frames ({settings.MAX_FRAMES_PER_REQUEST}).",
        )

    # 4. Anti-replay and session TTL validation
    consumed_ok = challenge_session_manager.validate_and_consume(session_id, nonce=server_nonce)
    if not consumed_ok:
        return DecisionResponse(
            request_id=request_id,
            decision=DecisionCode.SESSION_EXPIRED,
            message="Challenge session has expired or was already consumed (replay prevented).",
        )

    # 5. Fail-closed model readiness check
    if not (detector.is_loaded and pad_detector.is_loaded and embedding_provider.is_loaded):
        return DecisionResponse(
            request_id=request_id,
            decision=DecisionCode.ERROR,
            message="Biometric models not loaded (fail-closed policy enforced).",
        )

    # 6. Read and decode evidence frames
    parsed_images: List[Image.Image] = []
    for idx, frame in enumerate(frames):
        content = await frame.read()
        if len(content) == 0 or len(content) > settings.MAX_IMAGE_BYTES:
            continue
        try:
            pil_img = Image.open(io.BytesIO(content)).convert("RGB")
            parsed_images.append(pil_img)
        except Exception:
            continue

    if not parsed_images:
        return DecisionResponse(
            request_id=request_id,
            decision=DecisionCode.QUALITY_REJECTED,
            message="Could not read or parse any submitted evidence frames.",
        )

    # 7. Detection, PAD, and ArcFace extraction
    extracted_embeddings: list[np.ndarray] = []
    pad_scores: list[float] = []
    total_faces = 0
    pad_spoof_count = 0

    for img in parsed_images:
        faces = detector.detect(img)
        if not faces:
            continue
        total_faces += len(faces)
        primary = faces[0]
        x, y, w, h = primary.box

        pad_scale = 1.8
        cx = x + w / 2.0
        cy = y + h / 2.0
        cw = w * pad_scale
        ch = h * pad_scale
        cx1 = max(0, int(cx - cw / 2.0))
        cy1 = max(0, int(cy - ch / 2.0))
        cx2 = min(img.width, int(cx + cw / 2.0))
        cy2 = min(img.height, int(cy + ch / 2.0))
        pad_crop = img.crop((cx1, cy1, cx2, cy2))

        pad_outcome, pad_score = pad_detector.predict(pad_crop)
        if pad_outcome == PadOutcome.SPOOF:
            pad_spoof_count += 1
            continue

        emb = embedding_provider.embed(img, primary.landmarks)
        extracted_embeddings.append(emb)
        pad_scores.append(pad_score)

    if total_faces == 0:
        return DecisionResponse(
            request_id=request_id,
            decision=DecisionCode.QUALITY_REJECTED,
            message="No face detected in any of the submitted evidence frames.",
        )

    if pad_spoof_count > 0 and len(extracted_embeddings) == 0:
        return DecisionResponse(
            request_id=request_id,
            decision=DecisionCode.PAD_REJECTED,
            message="Presentation attack detected: evidence failed passive liveness validation.",
        )

    # 8. Compare embeddings against enrolled template
    stored_template_vec = np.frombuffer(template.embedding, dtype=np.float32)
    stored_template_vec = stored_template_vec / float(np.linalg.norm(stored_template_vec))

    # Calculate maximum similarity across evidence frames
    max_similarity = -1.0
    for emb in extracted_embeddings:
        sim = float(np.dot(emb, stored_template_vec))
        if sim > max_similarity:
            max_similarity = sim

    if max_similarity < settings.MATCH_SIMILARITY_THRESHOLD:
        return DecisionResponse(
            request_id=request_id,
            decision=DecisionCode.NO_MATCH,
            matched_person_id=None,
            similarity_score=round(max_similarity, 4),
            message=f"Face mismatch: similarity score ({max_similarity:.2f}) is below threshold ({settings.MATCH_SIMILARITY_THRESHOLD:.2f}).",
        )

    # 9. Attendance Transactional Persistence
    avg_liveness = float(np.mean(pad_scores)) if pad_scores else 1.0
    attendance = AttendanceRecord(
        student_id=current_student.id,
        timestamp=datetime.now(timezone.utc),
        similarity_score=round(max_similarity, 4),
        liveness_score=round(avg_liveness, 4),
        session_id=session_id,
        device_info="Web Camera Client",
        status="PRESENT",
    )
    db.add(attendance)
    db.commit()

    return DecisionResponse(
        request_id=request_id,
        decision=DecisionCode.MATCH,
        matched_person_id=current_student.roll_number,
        similarity_score=round(max_similarity, 4),
        message=f"Attendance successfully verified and recorded for {current_student.first_name} {current_student.last_name} ({current_student.roll_number}).",
    )


@app.get("/v1/attendance/history", response_model=AttendanceHistoryResponse)
def get_attendance_history(
    current_student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """Retrieve attendance history for the authenticated student."""
    records = (
        db.query(AttendanceRecord)
        .filter(AttendanceRecord.student_id == current_student.id)
        .order_by(AttendanceRecord.timestamp.desc())
        .limit(50)
        .all()
    )

    items = [
        AttendanceRecordResponse(
            id=r.id,
            timestamp=r.timestamp.isoformat(),
            status=r.status,
            similarity_score=r.similarity_score,
            liveness_score=r.liveness_score,
            device_info=r.device_info,
        )
        for r in records
    ]

    return AttendanceHistoryResponse(
        total_records=len(items),
        records=items,
    )


# Backward-compatible endpoint for manual verification testing
@app.post("/v1/verifications", response_model=DecisionResponse)
async def submit_verification(
    session_id: str = Form(...),
    server_nonce: str = Form(...),
    frames: List[UploadFile] = File(...),
):
    """Fallback verification endpoint for anonymous testing."""
    request_id = str(uuid.uuid4())
    consumed_ok = challenge_session_manager.validate_and_consume(session_id, nonce=server_nonce)
    if not consumed_ok:
        return DecisionResponse(
            request_id=request_id,
            decision=DecisionCode.SESSION_EXPIRED,
            message="Challenge session has expired or was already consumed.",
        )

    return DecisionResponse(
        request_id=request_id,
        decision=DecisionCode.NO_MATCH,
        similarity_score=0.0,
        message="Live verification requires authenticated student session via /v1/attendance/verify.",
    )
