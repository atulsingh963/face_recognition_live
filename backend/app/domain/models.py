"""Domain entities, enums, and schemas for face recognition and liveness."""

from enum import Enum
from typing import List, Optional
from pydantic import BaseModel


class LivenessAction(str, Enum):
    BLINK = "blink"
    TURN_LEFT = "turn_left"
    TURN_RIGHT = "turn_right"
    SMILE = "smile"
    NOD = "nod"


class DecisionCode(str, Enum):
    MATCH = "MATCH"
    NO_MATCH = "NO_MATCH"
    PAD_REJECTED = "PAD_REJECTED"
    QUALITY_REJECTED = "QUALITY_REJECTED"
    RETRY_REQUIRED = "RETRY_REQUIRED"
    SESSION_EXPIRED = "SESSION_EXPIRED"
    UNAUTHORIZED = "UNAUTHORIZED"
    ERROR = "ERROR"


class PadOutcome(str, Enum):
    REAL = "REAL"
    SPOOF = "SPOOF"
    UNCERTAIN = "UNCERTAIN"
    ERROR = "ERROR"


class ChallengeSessionCreateResponse(BaseModel):
    session_id: str
    actions: List[LivenessAction]
    expires_in_seconds: int
    server_nonce: str


class LivenessSessionStatus(BaseModel):
    session_id: str
    is_valid: bool
    is_consumed: bool
    remaining_seconds: float


class DecisionResponse(BaseModel):
    request_id: str
    decision: DecisionCode
    matched_person_id: Optional[str] = None
    similarity_score: Optional[float] = None
    message: str


class BoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float


class NormalizedBoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float


class LandmarkPoint(BaseModel):
    x: float
    y: float


class LiveFaceDetection(BaseModel):
    bbox: BoundingBox
    norm_bbox: NormalizedBoundingBox
    score: float
    pad_outcome: Optional[PadOutcome] = None
    pad_score: Optional[float] = None
    landmarks: List[LandmarkPoint] = []
    norm_landmarks: List[LandmarkPoint] = []


class LiveFrameAnalysisResponse(BaseModel):
    face_count: int
    faces: List[LiveFaceDetection]
    model_ready: bool
    timestamp_ms: float
