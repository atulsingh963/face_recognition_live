import numpy as np
from PIL import Image
from app.domain.detector import YuNetDetector
from app.liveness.pad_adapter import MiniFASNetPAD
from app.embeddings.provider import ArcFaceEmbeddingProvider


def test_nms_no_index_error_on_multiple_candidates():
    """Verify NMS does not mutate/overwrite coordinates across iterations."""
    detector = YuNetDetector()
    boxes = np.array(
        [
            [10.0, 10.0, 50.0, 50.0],
            [12.0, 12.0, 48.0, 48.0],
            [100.0, 100.0, 50.0, 50.0],
            [200.0, 200.0, 50.0, 50.0],
            [300.0, 300.0, 50.0, 50.0],
        ],
        dtype=np.float32,
    )
    scores = np.array([0.95, 0.90, 0.85, 0.80, 0.75], dtype=np.float32)

    kept = detector._nms(boxes, scores, score_thresh=0.5, iou_thresh=0.4, top_k=10)
    # Box 1 is suppressed by Box 0; Boxes 0, 2, 3, 4 are preserved
    assert kept == [0, 2, 3, 4]


def test_nms_empty_or_subthreshold():
    detector = YuNetDetector()
    boxes = np.array([[10.0, 10.0, 50.0, 50.0]], dtype=np.float32)
    scores = np.array([0.2], dtype=np.float32)
    assert detector._nms(boxes, scores, score_thresh=0.5, iou_thresh=0.4, top_k=10) == []


def test_yunet_detector_session_and_inference():
    detector = YuNetDetector()
    assert detector.is_loaded

    # Run on a solid color test image
    img = Image.new("RGB", (640, 480), color=(128, 128, 128))
    faces = detector.detect(img)
    assert isinstance(faces, list)


def test_minifasnet_pad_channel_order_and_normalization():
    pad = MiniFASNetPAD()
    assert pad.is_loaded

    img = Image.new("RGB", (80, 80), color=(180, 150, 120))
    outcome, score = pad.predict(img)
    assert 0.0 <= score <= 1.0
    assert outcome.value in ["REAL", "SPOOF", "UNCERTAIN", "ERROR"]


def test_arcface_embedding_normalization():
    embedder = ArcFaceEmbeddingProvider()
    assert embedder.is_loaded
    assert embedder.dimension == 512

    img = Image.new("RGB", (112, 112), color=(140, 120, 100))
    vec = embedder.embed(img)
    assert vec.shape == (512,)
    norm = np.linalg.norm(vec)
    assert np.isclose(norm, 1.0, atol=1e-3)
