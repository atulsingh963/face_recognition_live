"""Abstract interface and stub provider for Presentation Attack Detection (PAD)."""
from abc import ABC, abstractmethod
import numpy as np
from app.domain.models import PadOutcome


class PresentationAttackDetector(ABC):
    @abstractmethod
    def predict(self, face_image: np.ndarray) -> tuple[PadOutcome, float]:
        """
        Evaluate face crop for presentation attack.
        Returns: (PadOutcome, confidence_score)
        """
        pass


class StubPresentationAttackDetector(PresentationAttackDetector):
    """
    Stub detector when weights are not yet approved/loaded.
    Fails closed or returns UNCERTAIN in development.
    """
    def __init__(self, approved: bool = False):
        self.approved = approved

    def predict(self, face_image: np.ndarray) -> tuple[PadOutcome, float]:
        if not self.approved:
            # Enforce gate: unapproved models fail closed
            return (PadOutcome.ERROR, 0.0)
        return (PadOutcome.UNCERTAIN, 0.5)
