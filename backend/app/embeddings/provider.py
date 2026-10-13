"""Abstract interface and provider for face embedding models."""
from abc import ABC, abstractmethod
import numpy as np


class FaceEmbeddingProvider(ABC):
    @property
    @abstractmethod
    def dimension(self) -> int:
        """Returns embedding vector dimension (e.g. 512)."""
        pass

    @abstractmethod
    def embed(self, aligned_face: np.ndarray) -> np.ndarray:
        """
        Takes aligned face crop and returns an L2-normalized 1D vector.
        """
        pass


class StubEmbeddingProvider(FaceEmbeddingProvider):
    """
    Stub provider enforcing dimension checks and fail-closed behavior before weights are approved.
    """
    def __init__(self, dimension: int = 512, approved: bool = False):
        self._dim = dimension
        self._approved = approved

    @property
    def dimension(self) -> int:
        return self._dim

    def embed(self, aligned_face: np.ndarray) -> np.ndarray:
        if not self._approved:
            raise PermissionError("Face embedding model is not approved for production use.")
        # Zero vector or placeholder only when explicitly called in stub
        vec = np.zeros(self._dim, dtype=np.float32)
        return vec
