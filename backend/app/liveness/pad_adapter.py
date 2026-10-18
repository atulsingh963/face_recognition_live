"""Presentation Attack Detection (PAD) using MiniFASNet ONNX model."""

from pathlib import Path
from typing import Tuple
import numpy as np
from PIL import Image
import onnxruntime as ort

from app.config.settings import settings
from app.domain.models import PadOutcome


class MiniFASNetPAD:
    """
    Evaluates face crops for presentation attacks (print, screen replay) using MiniFASNet v2.
    Class 0: Print attack (Spoof)
    Class 1: Live / Real face
    Class 2: Replay attack (Spoof)
    """

    def __init__(
        self,
        model_path: str | None = None,
        score_threshold: float | None = None,
    ):
        self.model_path = model_path or settings.PAD_MODEL_PATH
        self.score_threshold = score_threshold or settings.PAD_SCORE_THRESHOLD
        self._session: ort.InferenceSession | None = None
        self._init_session()

    def _resolve_path(self, configured_path: str) -> Path:
        p = Path(configured_path)
        if not p.is_absolute():
            backend_rel = Path(__file__).resolve().parent.parent.parent / configured_path
            project_rel = Path(__file__).resolve().parent.parent.parent.parent / configured_path
            if backend_rel.exists():
                return backend_rel
            elif project_rel.exists():
                return project_rel
        return p

    def _init_session(self):
        resolved = self._resolve_path(self.model_path)
        if resolved.exists() and resolved.is_file():
            self._session = ort.InferenceSession(
                str(resolved),
                providers=["CPUExecutionProvider"],
            )

    @property
    def is_loaded(self) -> bool:
        return self._session is not None

    def predict(self, face_crop: Image.Image) -> Tuple[PadOutcome, float]:
        """
        Takes a PIL face crop, converts to BGR, normalizes to [0, 1], resizes to (80, 80),
        runs MiniFASNet, applies softmax, and determines liveness.
        Returns: (PadOutcome, live_confidence_score [0..1])
        """
        if not settings.PAD_MODEL_APPROVED or self._session is None:
            return PadOutcome.ERROR, 0.0

        # MiniFASNet v2 input size is 80x80
        resized = face_crop.resize((80, 80), Image.Resampling.BILINEAR)
        img_arr = np.array(resized, dtype=np.float32)

        # Convert RGB to BGR and normalize to [0, 1]
        bgr = img_arr[:, :, ::-1] / 255.0

        # Transpose HWC -> CHW (1, 3, 80, 80)
        blob = np.transpose(bgr, (2, 0, 1))[np.newaxis, :, :, :]

        outputs = self._session.run(None, {"input": blob})[0]
        logits = outputs[0]

        # Softmax over logits
        exp = np.exp(logits - np.max(logits))
        probs = exp / np.sum(exp)

        # In Silent-Face-Anti-Spoofing / MiniFASNet:
        # Index 1 corresponds to genuine/live face; indices 0 and 2 are spoof (print/replay)
        live_score = float(probs[1])

        if live_score >= self.score_threshold:
            outcome = PadOutcome.REAL
        elif live_score < (self.score_threshold * 0.5):
            outcome = PadOutcome.SPOOF
        else:
            outcome = PadOutcome.UNCERTAIN

        return outcome, live_score


pad_detector = MiniFASNetPAD()
