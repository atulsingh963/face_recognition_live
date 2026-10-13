"""Tests for health, readiness, and challenge session management."""
from fastapi.testclient import TestClient
from app.main import app
from app.auth.sessions import challenge_session_manager

client = TestClient(app)


def test_root():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "Face Recognition & Liveness API"
    assert data["health_live_url"] == "/health/live"
    assert data["health_ready_url"] == "/health/ready"


def test_health_live():
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json()["status"] == "live"


def test_health_ready_unapproved_by_default():
    # In initial state, unapproved models cause ready_for_inference to be False (Fail-Closed)
    response = client.get("/health/ready")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "not_ready"
    assert data["ready_for_inference"] is False


def test_challenge_session_lifecycle():
    # 1. Create a session
    resp = client.post("/v1/liveness-sessions")
    assert resp.status_code == 200
    data = resp.json()
    assert "session_id" in data
    assert len(data["actions"]) == 2
    assert "server_nonce" in data

    session_id = data["session_id"]
    nonce = data["server_nonce"]

    # 2. Validate and consume (first time succeeds)
    assert challenge_session_manager.validate_and_consume(session_id, nonce) is True

    # 3. Second consume fails (Replay prevention)
    assert challenge_session_manager.validate_and_consume(session_id, nonce) is False
