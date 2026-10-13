# Model Asset Register

Strict governance for all machine learning model assets.

**Rule**: Any model file without an explicit `APPROVED` status from the project owner MUST fail startup checks.

| Model Asset | Role | Expected File / Checksum | License | Provenance / Training Data | Status | Approval Date / Notes |
|-------------|------|--------------------------|---------|----------------------------|--------|-----------------------|
| MiniFASNet (Silent-Face-Anti-Spoofing) | Passive PAD (Anti-spoofing) | `minifasnet.onnx` / TBD | Apache-2.0 (Code) / Asset license pending review | Upstream: minivision-ai/Silent-Face-Anti-Spoofing | `RESTRICTED` | Pending benchmark on target device captures |
| SFace (OpenCV Zoo) | Face Embedding Extractor | `face_recognition_sface_*.onnx` / TBD | Apache-2.0 candidate / Check open issue #313 | OpenCV Zoo | `RESTRICTED` | Candidate under evaluation; pending license clearance |
| InsightFace Pretrained | Face Embedding Extractor | `buffalo_l` / TBD | Non-commercial research only | DeepInsight | `BLOCKED` | Non-commercial restriction prohibits commercial/production deployment without separate license |
