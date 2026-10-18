import io
from PIL import Image
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_live():
    response = client.get("/health/live")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "live"


def test_health_ready_is_fast_and_accurate():
    response = client.get("/health/ready")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert data["ready_for_inference"] is True
    assert data["detector_model"]["loaded"] is True
    assert data["pad_model"]["loaded"] is True
    assert data["embedding_model"]["loaded"] is True


def test_create_liveness_session():
    response = client.post("/v1/liveness-sessions")
    assert response.status_code == 200
    data = response.json()
    assert "session_id" in data
    assert "server_nonce" in data
    assert len(data["actions"]) == 2


def test_live_detection_endpoint():
    # Create test JPEG in-memory
    buf = io.BytesIO()
    img = Image.new("RGB", (320, 240), color=(150, 150, 150))
    img.save(buf, format="JPEG")
    buf.seek(0)

    response = client.post(
        "/v1/live-detection",
        files={"frame": ("frame.jpg", buf, "image/jpeg")},
    )
    assert response.status_code == 200
    data = response.json()
    assert "face_count" in data
    assert "faces" in data
    assert data["model_ready"] is True
    assert data["timestamp_ms"] >= 0


def test_verifications_anti_replay_enforcement():
    # 1. Create a session
    sess_res = client.post("/v1/liveness-sessions")
    sess_data = sess_res.json()
    session_id = sess_data["session_id"]
    server_nonce = sess_data["server_nonce"]

    # 2. Create dummy frame
    buf = io.BytesIO()
    img = Image.new("RGB", (320, 240), color=(200, 200, 200))
    img.save(buf, format="JPEG")
    buf.seek(0)

    # First submission
    res1 = client.post(
        "/v1/verifications",
        data={"session_id": session_id, "server_nonce": server_nonce},
        files=[("frames", ("frame.jpg", buf.getvalue(), "image/jpeg"))],
    )
    assert res1.status_code == 200
    # Even if no face detected in blank image, decision is returned
    assert "decision" in res1.json()

    # Replay submission with same consumed session must be rejected
    res2 = client.post(
        "/v1/verifications",
        data={"session_id": session_id, "server_nonce": server_nonce},
        files=[("frames", ("frame.jpg", buf.getvalue(), "image/jpeg"))],
    )
    assert res2.status_code == 200
    assert res2.json()["decision"] == "SESSION_EXPIRED"
