"""ArcFace ResNet-100 face embedding model provider."""

from pathlib import Path
import numpy as np
from PIL import Image
import onnxruntime as ort

from app.config.settings import settings


class ArcFaceEmbeddingProvider:
    """
    Extracts 512-dimensional facial embedding vectors from face crops using ArcFace ResNet-100 ONNX.
    """

    def __init__(
        self,
        model_path: str | None = None,
        dimension: int | None = None,
    ):
        self.model_path = model_path or settings.EMBEDDING_MODEL_PATH
        self._dim = dimension or settings.EMBEDDING_DIMENSION
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

    @property
    def dimension(self) -> int:
        return self._dim

    def embed(self, face_crop: Image.Image) -> np.ndarray:
        """
        Takes a PIL face crop, normalizes to (112, 112) in range [-1, 1], and returns an L2-normalized 512D vector.
        """
        if not settings.EMBEDDING_MODEL_APPROVED or self._session is None:
            raise PermissionError("Face embedding model is not approved or not loaded.")

        # ArcFace input shape: 112x112
        resized = face_crop.resize((112, 112), Image.Resampling.BILINEAR)
        img_arr = np.array(resized, dtype=np.float32)

        # Normalize (data - 127.5) / 128
        norm_img = (img_arr - 127.5) / 128.0

        # Transpose HWC -> CHW
        blob = np.transpose(norm_img, (2, 0, 1))[np.newaxis, :, :, :]

        outputs = self._session.run(None, {"data": blob})[0]
        raw_vec = outputs[0]

        # L2-normalize
        norm = float(np.linalg.norm(raw_vec))
        if norm > 0:
            return raw_vec / norm
        return raw_vec


embedding_provider = ArcFaceEmbeddingProvider()
