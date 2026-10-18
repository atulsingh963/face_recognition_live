"""Pure-NumPy and Pillow implementation of YuNet ONNX face detection."""

from pathlib import Path
from typing import List, Tuple
import numpy as np
from PIL import Image
import onnxruntime as ort

from app.config.settings import settings


class DetectedFace:
    def __init__(
        self,
        box: Tuple[
            float, float, float, float
        ],  # x1, y1, width, height (pixel coords in original image)
        norm_box: Tuple[
            float, float, float, float
        ],  # x1/W, y1/H, width/W, height/H (normalized [0, 1])
        score: float,
        landmarks: List[Tuple[float, float]],
    ):
        self.box = box
        self.norm_box = norm_box
        self.score = score
        self.landmarks = landmarks


class YuNetDetector:
    """
    Inference wrapper for YuNet face detection ONNX model.
    Runs locally on CPUExecutionProvider without requiring heavy external dependencies.
    """

    def __init__(
        self,
        model_path: str | None = None,
        input_size: Tuple[int, int] = (640, 640),
        score_threshold: float = 0.5,
        nms_threshold: float = 0.4,
        top_k: int = 100,
    ):
        self.model_path = model_path or settings.DETECTOR_MODEL_PATH
        self.input_width, self.input_height = input_size
        self.score_threshold = score_threshold
        self.nms_threshold = nms_threshold
        self.top_k = top_k
        self.strides = [8, 16, 32]
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

    def _nms(
        self,
        boxes: np.ndarray,
        scores: np.ndarray,
        score_thresh: float,
        iou_thresh: float,
        top_k: int,
    ) -> List[int]:
        valid = np.where(scores >= score_thresh)[0]
        if len(valid) == 0:
            return []

        b = boxes[valid]
        s = scores[valid]

        x1 = b[:, 0]
        y1 = b[:, 1]
        x2 = b[:, 0] + b[:, 2]
        y2 = b[:, 1] + b[:, 3]
        areas = b[:, 2] * b[:, 3]

        order = s.argsort()[::-1]
        keep = []

        while order.size > 0 and len(keep) < top_k:
            i = order[0]
            keep.append(int(valid[i]))
            if order.size == 1:
                break

            xx1 = np.maximum(x1[i], x1[order[1:]])
            yy1 = np.maximum(y1[i], y1[order[1:]])
            xx2 = np.minimum(x2[i], x2[order[1:]])
            y2 = np.minimum(y2[i], y2[order[1:]])

            w = np.maximum(0.0, xx2 - xx1)
            h = np.maximum(0.0, y2 - yy1)
            inter = w * h
            union = areas[i] + areas[order[1:]] - inter
            ovr = np.where(union > 0, inter / (union + 1e-6), 0.0)

            inds = np.where(ovr <= iou_thresh)[0]
            order = order[inds + 1]

        return keep

    def detect(self, pil_image: Image.Image) -> List[DetectedFace]:
        """
        Detect faces in a PIL RGB Image.
        Returns a list of DetectedFace objects sorted by confidence score.
        """
        if self._session is None:
            return []

        orig_w, orig_h = pil_image.size
        if orig_w == 0 or orig_h == 0:
            return []

        # Resize to YuNet input dimensions (640, 640)
        resized = pil_image.resize((self.input_width, self.input_height), Image.Resampling.BILINEAR)
        img_arr = np.array(resized, dtype=np.float32)

        # Convert RGB to BGR for YuNet
        bgr = img_arr[:, :, ::-1]
        blob = np.transpose(bgr, (2, 0, 1))[np.newaxis, :, :, :]

        outputs = self._session.run(None, {"input": blob})
        # outputs order:
        # 0: cls_8,  1: cls_16,  2: cls_32
        # 3: obj_8,  4: obj_16,  5: obj_32
        # 6: bbox_8, 7: bbox_16, 8: bbox_32
        # 9: kps_8, 10: kps_16, 11: kps_32

        all_boxes = []
        all_scores = []
        all_landmarks = []

        scale_x = orig_w / float(self.input_width)
        scale_y = orig_h / float(self.input_height)

        for i, stride in enumerate(self.strides):
            cols = self.input_width // stride

            cls = outputs[i][0, :, 0]
            obj = outputs[i + 3][0, :, 0]
            bbox = outputs[i + 6][0]
            kps = outputs[i + 9][0]

            cls = np.clip(cls, 0.0, 1.0)
            obj = np.clip(obj, 0.0, 1.0)
            scores = np.sqrt(cls * obj)

            candidates = np.where(scores >= self.score_threshold)[0]
            for idx in candidates:
                r = idx // cols
                c = idx % cols
                score = float(scores[idx])

                cx = (c + bbox[idx, 0]) * stride
                cy = (r + bbox[idx, 1]) * stride
                w = np.exp(bbox[idx, 2]) * stride
                h = np.exp(bbox[idx, 3]) * stride

                x1 = cx - w / 2.0
                y1 = cy - h / 2.0

                # Rescale back to original image space
                orig_x1 = max(0.0, float(x1 * scale_x))
                orig_y1 = max(0.0, float(y1 * scale_y))
                orig_bw = min(float(orig_w - orig_x1), float(w * scale_x))
                orig_bh = min(float(orig_h - orig_y1), float(h * scale_y))

                kps_points = []
                for n in range(5):
                    lx = float((kps[idx, 2 * n] + c) * stride * scale_x)
                    ly = float((kps[idx, 2 * n + 1] + r) * stride * scale_y)
                    kps_points.append((lx, ly))

                all_boxes.append([orig_x1, orig_y1, orig_bw, orig_bh])
                all_scores.append(score)
                all_landmarks.append(kps_points)

        if not all_boxes:
            return []

        boxes_arr = np.array(all_boxes, dtype=np.float32)
        scores_arr = np.array(all_scores, dtype=np.float32)

        keep_indices = self._nms(
            boxes_arr,
            scores_arr,
            score_thresh=self.score_threshold,
            iou_thresh=self.nms_threshold,
            top_k=self.top_k,
        )

        results: List[DetectedFace] = []
        for kid in keep_indices:
            bx = all_boxes[kid]
            sc = all_scores[kid]
            lm = all_landmarks[kid]
            norm_b = (
                bx[0] / orig_w,
                bx[1] / orig_h,
                bx[2] / orig_w,
                bx[3] / orig_h,
            )
            results.append(
                DetectedFace(
                    box=(bx[0], bx[1], bx[2], bx[3]),
                    norm_box=norm_b,
                    score=sc,
                    landmarks=lm,
                )
            )

        return results


# Global singleton instance for detector
detector = YuNetDetector()
