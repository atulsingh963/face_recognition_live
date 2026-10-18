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

    @staticmethod
    def align_face(img: Image.Image, landmarks: list[tuple[float, float]]) -> Image.Image:
        """
        Align facial image to standard 112x112 template using Umeyama similarity transform
        based on 5 standard facial landmarks (left eye, right eye, nose tip, left mouth corner, right mouth corner).
        """
        if not landmarks or len(landmarks) != 5:
            return img.resize((112, 112), Image.Resampling.BILINEAR)

        # Reference 5 standard landmarks for ArcFace (112x112)
        dst = np.array(
            [
                [38.2946, 51.6963],  # left eye
                [73.5318, 51.5014],  # right eye
                [56.0252, 71.7366],  # nose tip
                [41.5493, 92.3655],  # left mouth corner
                [70.7299, 92.2041],  # right mouth corner
            ],
            dtype=np.float64,
        )
        src = np.array(landmarks, dtype=np.float64)

        try:
            # Estimate similarity transform src -> dst
            src_mean = src.mean(axis=0)
            dst_mean = dst.mean(axis=0)
            src_demean = src - src_mean
            dst_demean = dst - dst_mean

            A = np.dot(dst_demean.T, src_demean) / src.shape[0]
            d = np.ones(2, dtype=np.float64)
            if np.linalg.det(A) < 0:
                d[1] = -1

            T = np.eye(3, dtype=np.float64)
            U, S, Vt = np.linalg.svd(A)
            rank = np.linalg.matrix_rank(A)
            if rank == 0:
                return img.resize((112, 112), Image.Resampling.BILINEAR)
            elif rank == 1:
                if np.linalg.det(U) * np.linalg.det(Vt) < 0:
                    T[:2, :2] = np.dot(U, np.dot(np.diag([1, -1]), Vt))
                else:
                    T[:2, :2] = np.dot(U, Vt)
            else:
                diag = np.diag(d)
                T[:2, :2] = np.dot(U, np.dot(diag, Vt))

            var_src = np.var(src, axis=0).sum()
            scale = 1.0 / var_src * np.trace(np.dot(np.diag(S), diag))
            T[:2, :2] *= scale
            T[:2, 2] = dst_mean - np.dot(T[:2, :2], src_mean)

            # Invert for PIL transform (dst -> src mapping)
            T_inv = np.linalg.inv(T)
            pil_affine_data = (
                T_inv[0, 0],
                T_inv[0, 1],
                T_inv[0, 2],
                T_inv[1, 0],
                T_inv[1, 1],
                T_inv[1, 2],
            )
            aligned = img.transform(
                (112, 112),
                Image.Transform.AFFINE,
                data=pil_affine_data,
                resample=Image.Resampling.BILINEAR,
            )
            return aligned
        except Exception:
            return img.resize((112, 112), Image.Resampling.BILINEAR)

    def embed(
        self,
        face_img: Image.Image,
        landmarks: list[tuple[float, float]] | None = None,
    ) -> np.ndarray:
        """
        Takes a face image (and optional 5 landmarks), aligns to (112, 112),
        normalizes to [-1, 1], and returns an L2-normalized 512D float32 vector.
        """
        if not settings.EMBEDDING_MODEL_APPROVED or self._session is None:
            raise PermissionError("Face embedding model is not approved or not loaded.")

        if landmarks and len(landmarks) == 5:
            aligned = self.align_face(face_img, landmarks)
        else:
            aligned = face_img.resize((112, 112), Image.Resampling.BILINEAR)

        img_arr = np.array(aligned, dtype=np.float32)

        # Convert RGB to BGR
        bgr = img_arr[:, :, ::-1]

        # Normalize (data - 127.5) / 128
        norm_img = (bgr - 127.5) / 128.0

        # Transpose HWC -> CHW
        blob = np.transpose(norm_img, (2, 0, 1))[np.newaxis, :, :, :]

        outputs = self._session.run(None, {"data": blob})[0]
        raw_vec = outputs[0].astype(np.float32)

        # L2-normalize
        norm = float(np.linalg.norm(raw_vec))
        if norm > 0:
            return raw_vec / norm
        return raw_vec


embedding_provider = ArcFaceEmbeddingProvider()
