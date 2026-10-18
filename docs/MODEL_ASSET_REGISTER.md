# Model Asset Register

Strict governance for all machine learning model assets.

**Rule**: Any model file without an explicit `APPROVED` status from the project owner MUST fail startup checks.

| Model Asset | Role | Expected File / Checksum | License | Provenance / Training Data | Status | Approval Date / Notes |
|-------------|------|--------------------------|---------|----------------------------|--------|-----------------------|
| YuNet (2023mar) | Face Detection & 5-pt Alignment | `face_detection_yunet_2023mar.onnx` / `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` | Apache-2.0 | OpenCV Zoo / ShiqiYu/libfacedetection | `APPROVED` | Local ONNX runtime inference approved |
| MiniFASNet-V2 | Passive PAD (Anti-spoofing) | `minifasnet_v2.onnx` / `d7b3cd9ba8a7ceb13baa8c4720902e27ca3112eff52f926c08804af6b6eecc7b` | Apache-2.0 | Upstream: minivision-ai/Silent-Face-Anti-Spoofing | `APPROVED` | Approved for local live inference gating |
| ArcFace ResNet100 | Face Feature Vector Embedding | `arcfaceresnet100-8.onnx` / `f3a6bc281e72f88862f5748b53be3d76b3b48f8f1ab1f4a537941bdc4e1b01da` | MIT / Apache-2.0 (ONNX Model Zoo) | DeepInsight ArcFace ResNet-100 L2 normalized 512D | `APPROVED` | Approved for local biometric template comparison |
