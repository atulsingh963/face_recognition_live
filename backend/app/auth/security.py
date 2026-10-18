"""Security, password hashing (Argon2id), JWT session token generation and verification."""

import re
import time
from datetime import datetime, timedelta, timezone
from typing import Optional
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config.settings import settings
from app.database import get_db, Student

# RFC 9106 recommended Argon2id parameters
_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,  # 64 MiB
    parallelism=4,
    hash_len=32,
    salt_len=16,
)

ALGORITHM = "HS256"
security_bearer = HTTPBearer(auto_error=False)

# In-memory IP/Roll rate limiter for login attempts (10 attempts per minute)
_login_attempts: dict[str, list[float]] = {}


def hash_password(password: str) -> str:
    """Hash a plaintext password using Argon2id."""
    return _hasher.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against an Argon2id hash."""
    try:
        return _hasher.verify(hashed_password, plain_password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def normalize_roll_number(roll_number: str) -> str:
    """Normalize roll number by trimming and converting to uppercase."""
    return roll_number.strip().upper()


def validate_roll_number(roll_number: str) -> bool:
    """Check roll number format against configured regex."""
    norm = normalize_roll_number(roll_number)
    return bool(re.match(settings.ROLL_NUMBER_REGEX, norm))


def is_rate_limited(key: str, max_attempts: int = 10, window_seconds: int = 60) -> bool:
    """Check whether a client has exceeded rate limits."""
    now = time.time()
    attempts = _login_attempts.get(key, [])
    valid_attempts = [t for t in attempts if now - t < window_seconds]
    _login_attempts[key] = valid_attempts
    return len(valid_attempts) >= max_attempts


def record_login_failure(key: str) -> None:
    """Record an unauthenticated failed login attempt."""
    now = time.time()
    attempts = _login_attempts.get(key, [])
    attempts.append(now)
    _login_attempts[key] = attempts


def reset_rate_limit(key: str) -> None:
    """Clear failed attempts for a key upon successful authentication."""
    _login_attempts.pop(key, None)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Generate a signed JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)


class TokenData(BaseModel):
    roll_number: str
    student_id: int


def get_current_student(
    auth: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
    db: Session = Depends(get_db),
) -> Student:
    """FastAPI dependency to extract and authenticate current student from Bearer JWT."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials or session expired.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not auth or not auth.credentials:
        raise credentials_exception

    try:
        payload = jwt.decode(auth.credentials, settings.SECRET_KEY, algorithms=[ALGORITHM])
        roll_number: str = payload.get("sub")
        student_id: int = payload.get("student_id")
        if roll_number is None or student_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    student = db.query(Student).filter(Student.id == student_id, Student.is_active == True).first()
    if student is None:
        raise credentials_exception

    return student
