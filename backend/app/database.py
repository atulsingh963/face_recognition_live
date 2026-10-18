"""Local SQLite database models, engine, and session management."""

from datetime import datetime, timezone
from pathlib import Path
from typing import Generator
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker, Session

from app.config.settings import settings


def get_resolved_db_path() -> Path:
    """Ensure the local database directory exists on local disk."""
    p = Path(settings.LOCAL_DATA_DIR)
    if not p.is_absolute():
        # Prefer project root directory
        project_root = Path(__file__).resolve().parent.parent.parent
        p = project_root / settings.LOCAL_DATA_DIR
    p.mkdir(parents=True, exist_ok=True)
    return p / "attendance.db"


db_file_path = get_resolved_db_path()
sqlite_url = f"sqlite:///{db_file_path.as_posix()}"

engine = create_engine(
    sqlite_url,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Student(Base):
    """Student account entity."""

    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    roll_number = Column(String(50), unique=True, index=True, nullable=False)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    password_hash = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_enrolled = Column(Boolean, default=False, nullable=False)
    created_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    biometric_template = relationship(
        "BiometricTemplate",
        back_populates="student",
        uselist=False,
        cascade="all, delete-orphan",
    )
    attendance_records = relationship(
        "AttendanceRecord", back_populates="student", cascade="all, delete-orphan"
    )


class BiometricTemplate(Base):
    """
    Protected biometric template storage.
    Raw enrollment video/images are discarded by default.
    Only normalized, protected embedding bytes (512 float32 = 2048 bytes) and quality metrics are stored.
    """

    __tablename__ = "biometric_templates"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(
        Integer,
        ForeignKey("students.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    embedding = Column(LargeBinary, nullable=False)  # 512 x float32 in bytes
    dimension = Column(Integer, default=512, nullable=False)
    consent_given = Column(Boolean, default=True, nullable=False)
    consent_timestamp = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )
    sample_quality_score = Column(Float, nullable=False, default=1.0)
    enrolled_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    student = relationship("Student", back_populates="biometric_template")


class AttendanceRecord(Base):
    """Attendance log entity with audit trail."""

    __tablename__ = "attendance_records"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(
        Integer,
        ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    timestamp = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True
    )
    similarity_score = Column(Float, nullable=False)
    liveness_score = Column(Float, nullable=False)
    session_id = Column(String(100), nullable=True)
    device_info = Column(String(255), nullable=True)
    status = Column(String(50), default="PRESENT", nullable=False)

    student = relationship("Student", back_populates="attendance_records")

    __table_args__ = (
        Index("ix_student_attendance_time", "student_id", "timestamp"),
    )


def init_db():
    """Create tables if they don't exist."""
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    """FastAPI database dependency."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
