"""Domain entities, enums, and schemas for face recognition and liveness."""
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


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
