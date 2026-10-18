"""Backend configuration and settings management."""

from enum import Enum
from pydantic_settings import BaseSettings, SettingsConfigDict


class EnvironmentType(str, Enum):
    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Server
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    DEBUG: bool = False
    ENVIRONMENT: EnvironmentType = EnvironmentType.DEVELOPMENT
    CORS_ORIGINS: list[str] = [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "https://ride-volvo-hughes-desirable.trycloudflare.com",
        "https://islamic-coordinator-configured-eagles.trycloudflare.com",
    ]

    # Auth & Tokens
    SECRET_KEY: str = "insecure_dev_key_must_be_changed_in_env_file"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    CHALLENGE_SESSION_EXPIRE_SECONDS: int = 60

    # Models & Approvals
    PAD_MODEL_PATH: str = "models/pad/minifasnet_v2.onnx"
    PAD_MODEL_APPROVED: bool = True
    PAD_SCORE_THRESHOLD: float = 0.90

    EMBEDDING_MODEL_PATH: str = "models/embedding/arcfaceresnet100-8.onnx"
    EMBEDDING_MODEL_APPROVED: bool = True
    EMBEDDING_DIMENSION: int = 512
    MATCH_SIMILARITY_THRESHOLD: float = 0.65

    DETECTOR_MODEL_PATH: str = "models/detector/face_detection_yunet_2023mar.onnx"

    # Storage & Privacy
    LOCAL_DATA_DIR: str = "local_data"
    DATABASE_URL: str = "sqlite:///./local_data/attendance.db"

    # Attendance Policy
    ATTENDANCE_WINDOW_MINUTES: int = 60  # Minimum minutes between duplicate attendance records for same student
    ROLL_NUMBER_REGEX: str = r"^[A-Za-z0-9_-]{5,20}$"

    # Ingestion constraints
    MAX_IMAGE_BYTES: int = 524288  # 512 KB max raw upload per frame
    MAX_FRAMES_PER_REQUEST: int = 5
    MAX_IMAGE_DIMENSION: int = 1920


settings = Settings()
