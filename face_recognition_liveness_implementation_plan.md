# Face Recognition + Liveness System — End-to-End Implementation Plan

**Document type:** Engineering specification, implementation roadmap, security checklist, and repository working agreement  
**Architecture source:** User-provided *Face Recognition + Liveness System Architecture* diagram  
**Research checked:** 14 October 2026  
**Cost constraint:** Use free-to-access tools and libraries; do not introduce a paid face API or paid cloud dependency  
**Data constraint:** Do not generate synthetic identities, sample faces, demo users, seed records, or biometric test data. The project owner will supply any real, consented enrollment/validation data.

---

## 1. Project goal

Build an Android client and Python inference backend that perform face-quality checks, challenge-based liveness screening, passive presentation-attack detection (PAD), face embedding extraction, vector matching, and an access decision.

The solution must follow the diagram's principal flow:

1. Android captures camera frames locally.
2. Local face detection, face mesh/landmarks, quality screening, and randomized liveness challenge run on-device.
3. A failed local check is discarded locally. **No face image or frame from a failed attempt is uploaded for inference.**
4. After a successful local challenge, the Android client sends a compact, encrypted-in-transit face payload to the backend.
5. FastAPI validates the request and passes the image to the passive anti-spoofing model.
6. A spoof or invalid payload is rejected before identity matching.
7. A passed PAD check goes through the licensed face-embedding model.
8. The normalized embedding is searched against the FAISS index.
9. A threshold/policy decision is returned to the client.

The system also needs an **enrollment and revocation flow**, which is not shown in the original diagram but is required for recognition to work. Enrollment must only use real people/data supplied and authorized by the project owner or the individuals concerned.

### Non-goals for the first release

- No face scraping, online face lookup, third-party recognition API, or covert identification.
- No generated people, synthetic face images, fake enrollment accounts, or pre-populated identity database.
- No raw camera stream upload while the user is performing a failed local challenge.
- No promise that a single RGB image or one anti-spoofing model defeats every print, screen replay, mask, deepfake, or camera injection attack.
- No production release until the exact embedding and PAD model files, licenses, provenance, and measured error rates have been reviewed.

---

## 2. Non-negotiable repository and coding rules

These rules apply to every developer, coding agent, or future implementation prompt used for this project.

### 2.1 Never repeatedly overwrite existing code

1. **Inspect before editing.** Read the existing file, its callers, related interfaces, tests, and current Git diff before changing it.
2. **Patch the smallest possible surface.** Add a function, class, module, or focused diff rather than regenerating an entire file. Preserve working code, public interfaces, comments, formatting, and existing conventions unless a change is required.
3. **No blind full-file rewrites.** Do not replace a whole file, scaffold, module, or directory just because it is faster to generate new code. A rewrite is allowed only when technically necessary, the impact is explained, and the project owner approves it first.
4. **No repeated implementation resets.** Do not recreate the project or rewrite previous stages to make a new stage fit. Extend the architecture through narrow interfaces and backward-compatible migrations.
5. **Preserve all user changes.** Before starting, inspect `git status` and `git diff`. Never overwrite uncommitted user work. If a file already contains changes, retain them and make a minimal patch.
6. **No destructive Git commands.** Do not run `git reset --hard`, `git clean -fd`, `git checkout -- <file>`, force-push, or equivalent destructive operations unless the owner explicitly approves the exact operation after seeing what would be lost.
7. **No secrets or biometric data in commits.** Never commit access tokens, passwords, signing keys, `.env` files, raw facial images, embeddings from real people, logs containing biometric payloads, production database files, or user-specific configuration.
8. **Do not hide regressions.** If a change breaks an earlier phase, fix the regression before moving forward. Do not bypass checks, remove tests, silence exceptions, or weaken security to get a green build.

### 2.2 Commit each small, coherent step

Use Git from the first day. Commit after every small, independently reviewable change—not only at the end of a phase.

For each step:

1. Check `git status` and inspect the current diff.
2. Make one small change with one clear purpose.
3. Run the narrowest relevant check (formatting, type check, build, or focused test). For data-dependent checks, use only owner-supplied consenting data.
4. Inspect `git diff` and confirm that unrelated files were not changed.
5. Commit the step with a descriptive message.
6. Record the commit hash and the result in the project changelog or implementation checklist.

Suggested commit-message pattern:

- `docs: record architecture decisions`
- `android: add camera permission and preview`
- `android: close analyzer frames safely`
- `android: add local face quality checks`
- `android: add challenge state machine`
- `api: add request schemas and limits`
- `security: validate one-time liveness sessions`
- `backend: add PAD model adapter`
- `backend: add embedding adapter interface`
- `search: add FAISS index persistence`
- `privacy: add enrollment revocation flow`
- `docs: record manual validation results`

Do not combine unrelated UI, model, database, and deployment changes in one large commit. If a task is too large to review, split it into smaller commits.

### 2.3 No generated test data

- Do not create seed scripts, fixture factories, fake person records, sample users, synthetic face images, artificial enrollment galleries, mock face crops, generated biometric vectors, or default identity records.
- Do not download random faces from the internet or use public face datasets automatically.
- Do not include camera captures, enrollment photos, biometric samples, or embeddings in the repository.
- Any integration/end-to-end face validation must use data supplied by the project owner and collected with valid permission. Keep this data outside Git.
- Tests that do not need biometric records may check schemas, state transitions, error handling, authentication, and serialization without creating identities or face samples.
- If a test cannot run until owner-supplied data is available, mark it **BLOCKED — owner data required**; do not fabricate data to unblock it.

### 2.4 Required change report

After every implementation step, report: files changed, why each changed, checks run and their actual results, known gaps, commit hash, and the next smallest step. Never claim a build, benchmark, license, or test passed unless it was actually checked.

---

## 3. System architecture and data flow

### 3.1 Component map

| Diagram stage | Component | Main responsibility | Failure behavior |
|---|---|---|---|
| 1 | Android CameraX frame capture | Camera preview and bounded image analysis | Release frame resources; do not queue an unbounded backlog |
| 2 | ML Kit and/or MediaPipe face mesh | Detect face, estimate landmarks, measure framing/quality, guide randomized actions | Discard the attempt locally if face/quality/challenge requirements fail |
| 3 | Drop frame | Enforce the fail-closed local path | No image/frame upload and no backend inference call for the failed attempt |
| 4 | Secure transport | Send only a successful attempt's limited evidence | Reject expired session, invalid auth, oversized payload, or transport failure |
| 5 | FastAPI asynchronous ingestion | Authenticate and validate request, enforce limits, decode safely | Reject before expensive inference |
| 6 | MiniFASNet PAD | Estimate whether submitted face evidence resembles a presentation attack | Deny/stop pipeline if spoof score or quality policy fails |
| 7 | Access denied | Record a minimal security event | Never include face pixels, embeddings, secrets, or raw tokens in logs |
| 8 | Face embedding engine | Turn an aligned face crop into a model-specific vector | Stop on model error, invalid vector, or model-version mismatch |
| 9 | FAISS vector search | Search enrolled vectors and score similarity | Unknown if no candidate passes the calibrated decision threshold |
| 10 | Access decision | Apply threshold, account state, and policy; return only necessary result | Fail closed on any unresolved error |

### 3.2 Important architecture refinements

The diagram is the baseline, but these engineering clarifications are required to avoid false security assumptions:

1. **Face detection is not face recognition.** ML Kit detects facial features and geometry; MediaPipe Face Landmarker provides landmarks/blendshapes. The identity embedding model is a separate component.
2. **A client-side “passed” Boolean is not trustworthy by itself.** A modified client can lie. The server must validate a short-lived, one-time session and independently run server-side PAD. For a stronger challenge-response, it should also verify selected challenge evidence from multiple ordered frames.
3. **One static crop cannot prove that the user completed a challenge over time.** Recommended hardened design: retain a small number of selected keyframes from the challenge, each targeted at no more than 15 KB only if image quality remains sufficient. If the payload is restricted to one image total, describe active liveness as a client-side filter and do not claim server-verified challenge liveness.
4. **A 15 KB crop is a target, not a security requirement.** Very aggressive compression or downscaling can erase PAD cues and reduce identity accuracy. Benchmark image size, face pixel count, PAD error rates, and recognition error rates using owner-supplied consented data before enforcing the cap. Prefer rejecting a poor-quality capture to silently degrading it.
5. **A passive anti-spoof model does not guarantee spoof-proofing.** Treat PAD as a risk-reduction layer, combine it with challenge-response and replay controls, and document its measured limitations. NIST evaluations show that PAD performance varies and no tested software method detected every attack type.
6. **InsightFace source licensing and pretrained-model licensing differ.** Do not bundle a pretrained model based only on the repository's code license; see [Section 5](#5-free-tooling-models-and-license-gates).

### 3.3 Recommended request sequence

1. Authenticate the account/device using the chosen backend authentication flow.
2. Request a short-lived liveness session **before starting the camera challenge**. The backend stores the session, nonce, required challenge sequence, expiration, and one-time-use status. This is control metadata, not a camera upload.
3. Start CameraX and run local face detection, face quality checks, and the requested actions.
4. On a local failure, drop the frame(s), close image resources, clear temporary buffers, show a retry message, and do not open the inference connection or transmit face imagery.
5. On local success, select the required keyframes, crop/align them, and encode within the experimentally validated payload budget.
6. Open the secure transport and send the session identifier/token, ordered frame metadata, and binary image payloads. Never use a reusable app-wide secret embedded in the APK as authentication.
7. The backend validates session expiry, single-use status, challenge correspondence, authentication, image count/size/type, and request limits.
8. The PAD stage evaluates the submitted evidence. If it fails, stop before embedding/search.
9. The embedding adapter processes the best eligible frame only after PAD passes.
10. Normalize the vector and query FAISS. Apply the calibrated threshold and account-state checks.
11. Return `MATCH`, `NO_MATCH`, `PAD_REJECTED`, `QUALITY_REJECTED`, or `RETRY_REQUIRED` with a request ID and minimal details. Use the actual person ID only where the authenticated caller is authorized to receive it.
12. Mark the challenge session consumed, erase temporary frame buffers, and write a minimal audit event.

---

## 4. Free and self-hostable technology choices

No paid recognition API or paid inference platform is required. Run the API locally for development and on hardware/server infrastructure you control for deployment. Hosting-provider free tiers and quotas can change; do not make the design depend on a provider remaining free.

### 4.1 Android client

| Need | Preferred tool | Why | Notes |
|---|---|---|---|
| Language/UI | Kotlin + Android SDK | Native Android application and lifecycle integration | Pin Gradle, Android Gradle Plugin, Kotlin, and SDK versions once the repo's existing versions are audited |
| Camera capture | [CameraX](https://developer.android.com/media/camera/camerax/analyze) | Lifecycle-aware capture and image analysis | Use `STRATEGY_KEEP_ONLY_LATEST` for live analysis and always close each `ImageProxy` |
| Face box/quality signals | [ML Kit Face Detection](https://developers.google.com/ml-kit/vision/face-detection/android) | Convenient on-device detector, bounding box, angles and optional contours | Detection is not identity recognition; review [ML Kit terms/privacy](https://developers.google.com/ml-kit/terms). It may contact Google services for model/compatibility updates, so verify behavior against any strict network policy |
| Face mesh/action tracking | [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/android) | Dense landmarks, blendshapes, video/live-stream mode | Pin the package and model asset; check the exact model asset terms. For fully predictable offline runtime, package approved assets rather than relying on dynamic downloads |
| Network | A maintained Android HTTP/WebSocket client such as OkHttp | WSS transport from the app after local success | Use the platform certificate trust chain; never disable TLS verification |

You do not necessarily need both ML Kit and MediaPipe for every task. Use ML Kit for fast detection and MediaPipe for mesh/challenge signals if both demonstrably add value. If two detectors add latency or conflict on device, simplify based on measured results rather than retaining duplicate work without a reason.

### 4.2 Python inference backend

| Need | Preferred tool | License/source notes |
|---|---|---|
| API and async request handling | [FastAPI](https://github.com/fastapi/fastapi) | MIT-licensed application framework |
| Image decode/resize/align | OpenCV or Pillow, selected after dependency/license review | Process in memory; validate content and decoded dimensions before model inference |
| ONNX inference | [ONNX Runtime](https://github.com/microsoft/onnxruntime) | MIT-licensed runtime; model-file terms are separate from runtime terms |
| Passive anti-spoofing | [MiniFASNet / Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing) candidate | Repository declares Apache-2.0. Pin exact upstream revision and model files; verify the particular weight file and any included assets independently |
| Embedding search | [FAISS](https://github.com/facebookresearch/faiss) | MIT-licensed vector search library |
| Metadata database | SQLite for a single-process prototype; PostgreSQL for a multi-user deployment | Store identities/consent/status separately from the FAISS index; never use a face image as a database key |
| API/TLS hosting | Local/self-hosted reverse proxy or TLS-enabled server | Do not expose development HTTP endpoints publicly; apply current FastAPI/TLS deployment guidance |
| Configuration | Environment variables plus a local ignored `.env` for development | Commit only `.env.example` with key names and empty values; never store secrets in Android source or Git |

### 4.3 No-cost does not automatically mean unrestricted use

A package can be free of charge while a pretrained weight, dataset, app, or deployment method has additional terms. Keep an inventory containing the exact download URL, upstream revision, SHA-256 hash, license text, model-card link, and intended use for **every** model asset.

---

## 5. Free tooling, models, and license gates

### 5.1 InsightFace embedding model — mandatory decision gate

The architecture names **InsightFace** and a **512-dimensional vector**. The InsightFace project states that its code is MIT-licensed, but the pretrained model packs distributed with the project are for non-commercial research use unless separate licensing is obtained. This means:

- Do not assume `pip install insightface` grants commercial rights to its downloaded model pack.
- Do not automatically download model weights at application startup.
- Do not package an InsightFace pretrained model in a public or commercial release until the exact model license permits the intended use.
- If this is a non-commercial learning prototype, the project owner must still read and follow the exact model terms, save the license record, and keep its use within the allowed scope.
- For a commercial or publicly deployed system, either obtain an appropriate license or select an alternative model/weights whose usage and redistribution rights have been verified. “Open source code” alone is not sufficient evidence.

**Implementation requirement:** create a `FaceEmbeddingProvider` interface and keep model loading isolated behind it. Do not hardcode the full system around one provider's tensor shape. Although the target architecture mentions 512-D embeddings, make dimensionality a model configuration validated at startup. If the approved alternative does not output 512 dimensions, update the architecture record, index metadata, and tests in one reviewed migration.

### 5.2 Possible model candidate for review — OpenCV Zoo SFace

OpenCV Zoo's [SFace model directory](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) says the files in that directory are Apache-2.0 licensed. However, a public issue opened in July 2026 asks for clarification about the exact pretrained ONNX file's training-data provenance and commercial-use implications; the issue was still open when checked for this plan.

Therefore, treat SFace as a **candidate to investigate**, not an automatically cleared commercial model. Save the exact model revision/hash and obtain a clear license/provenance decision before distributing it or relying on it for a commercial access system. Use the adapter interface so the app does not need a rewrite when the licensed model is finalized.

### 5.3 MiniFASNet anti-spoof model gate

The [Silent-Face-Anti-Spoofing repository](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing) identifies its code repository as Apache-2.0. Before selecting weights:

1. Pin the upstream commit/release.
2. Record the exact model filename, SHA-256 checksum, model input format, required crop/resize strategy, and license file.
3. Verify that the license covers the selected model asset and intended use; do not infer this only from a third-party ONNX conversion's license.
4. Keep model provenance in `docs/MODEL_ASSET_REGISTER.md`.
5. Do not commit downloaded weights blindly. Large model binaries should be managed intentionally and must not contain or be mixed with identity data.
6. Benchmark the chosen weights with camera captures from the actual target device and intended lighting. The upstream project itself warns that performance may vary across cameras and conditions.

### 5.4 License and dependency register

Maintain `docs/THIRD_PARTY_NOTICES.md` and `docs/MODEL_ASSET_REGISTER.md` with:

- Package/model name and role.
- Version or immutable upstream commit.
- Exact source URL and date retrieved.
- License identifier and a copy/link to the applicable license.
- Model-file SHA-256 checksum where applicable.
- Training-data/model-card provenance when available.
- Whether commercial usage, modification, redistribution, and offline use are permitted or still unresolved.
- Required attribution/notices.
- Decision owner and approval status: `APPROVED`, `RESTRICTED`, or `BLOCKED`.

A model with `BLOCKED` status must not be bundled or used for public/commercial deployment. The application should fail at startup with an actionable configuration/licensing message rather than silently downloading another model.

---

## 6. Repository layout

Audit the existing repository before adopting this layout. If folders already exist, preserve them and map the plan to the current structure; do not reorganize the project merely to match this example.

```text
face-recognition-liveness/
├── android/
│   └── app/src/main/
│       ├── java/.../camera/          # CameraX provider, analyzer, lifecycle code
│       ├── java/.../face/            # detector, mesh, quality, crop/alignment
│       ├── java/.../liveness/        # challenge state machine and evidence capture
│       ├── java/.../network/         # session client, WSS client, DTOs
│       ├── java/.../ui/              # permission, capture, status and retry screens
│       └── assets/                   # only approved model assets, with provenance
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI application wiring
│   │   ├── api/                     # routes, WebSocket handler, request contracts
│   │   ├── auth/                    # authentication and session validation
│   │   ├── config/                   # typed settings and startup checks
│   │   ├── domain/                   # result enums, policies, domain services
│   │   ├── imaging/                  # bounded decode, crop, normalization
│   │   ├── liveness/                 # challenge verification and PAD adapter
│   │   ├── embeddings/               # model provider interface and licensed adapter
│   │   ├── search/                   # FAISS service, ID mapping, persistence
│   │   ├── storage/                  # database repositories and migrations
│   │   └── observability/             # privacy-safe logs and metrics
│   ├── migrations/
│   ├── models/                       # ignored model files or controlled artifact mounts
│   ├── requirements.in / lock file   # choose one reproducible dependency workflow
│   └── pyproject.toml
├── docs/
│   ├── ARCHITECTURE.md
│   ├── ADR/                          # architecture decision records
│   ├── MODEL_ASSET_REGISTER.md
│   ├── THIRD_PARTY_NOTICES.md
│   ├── SECURITY_AND_PRIVACY.md
│   ├── API_CONTRACT.md
│   ├── MANUAL_VALIDATION.md
│   └── CHANGELOG_IMPLEMENTATION.md
├── .gitignore
├── .env.example                      # keys only, no actual secrets
└── README.md
```

**Do not create placeholder biometric files to populate this layout.** Empty directories need not be committed; add a directory when the corresponding real component is implemented.

---

## 7. Android implementation details

### 7.1 Camera lifecycle

- Request `CAMERA` permission only when the user starts a capture flow; provide a clear denied-permission state.
- Bind camera use cases to the Activity/Fragment lifecycle. Release/unbind on stop or cancellation.
- Use `ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST` for real-time analysis to avoid processing a backlog of stale frames.
- Choose a single-threaded executor or bounded coroutine pipeline for analysis. Avoid running all ML work on the UI thread.
- Ensure every `ImageProxy` is closed exactly once, including exception/error/cancellation paths. Use a `try/finally` or equivalent lifecycle-safe completion handler.
- Do not retain the full stream in memory. Maintain only the small number of frames needed by the active challenge.
- Keep camera preview responsive if inference is slower than the incoming frame rate.

### 7.2 Frame and face-quality gate

Before launching a challenge or creating an upload:

- Check that the detector sees exactly one eligible face unless the product requirements explicitly define a different policy.
- Check minimum face-box size, position, pose range, blur/quality, and occlusion using measurable signals available from the selected APIs.
- Reject frames with no face, multiple faces, a clipped face, or insufficient pixels.
- Apply rotation, front-camera mirroring, and image-coordinate transforms consistently. Verify that face-box coordinates and crop coordinates use the same image orientation.
- Do not use the original, larger frame as an accidental fallback when the crop fails. Return a clear retry reason.
- Keep quality thresholds configurable and versioned; do not tune them using made-up images.

### 7.3 Randomized liveness state machine

Use a finite-state machine, not a collection of unrelated booleans. An example sequence of states is:

`IDLE → SESSION_READY → FACE_ACQUIRED → CHALLENGE_RUNNING → LOCAL_PASS → UPLOAD_PENDING → RESULT_RECEIVED`

Terminal/recovery states include `LOCAL_FAIL`, `CANCELLED`, `SESSION_EXPIRED`, `NETWORK_ERROR`, and `RETRY_REQUIRED`.

Requirements:

- Obtain a short-lived challenge plan from the backend before capture, or use a documented cryptographically sound challenge scheme with server-verifiable one-time state. Do not choose an unauthenticated random action locally and treat that alone as secure liveness proof.
- Use MediaPipe landmarks/blendshapes or validated geometric signals to track actions such as blink or head yaw. Do not rely on one landmark score alone.
- Apply deadlines, action order, minimum/maximum action duration, and a limited retry policy.
- Store only the small amount of temporal evidence needed. Clear the buffer immediately on failure/cancellation.
- Treat the on-device result as a first gate, not the final source of trust. The backend must independently validate the session and run PAD.
- If a strong server-side active challenge is required, retain a few ordered keyframes (and their session-relative timestamps/sequence numbers) so the server can verify the challenge. Do not claim server verification when the backend receives only one static crop.
- A challenge failure must take the local drop path: show a retry message, discard frames, close resources, and send no facial payload to inference.

### 7.4 Crop and encoding

- Crop around the detected face with the padding expected by the embedding/PAD preprocessing pipeline.
- Align using the chosen model's required landmarks; do not assume all models use the same crop geometry.
- Avoid upscaling a low-resolution face as a substitute for real detail.
- Use JPEG or WebP only after confirming the backend decoder and selected models behave correctly with it.
- Make the face-image maximum configurable and enforce it on both client and server. The initial **15 KB per crop** value is a benchmark goal, not a universal target.
- Do not Base64-encode binary images unnecessarily; it increases payload size. Prefer binary WebSocket messages or a documented binary HTTP request format.
- Clear bitmap/byte buffers when the request finishes. Do not write face crops to gallery/storage/cache unless a specific, consented requirement is approved.

### 7.5 Android UI states

The app must make the current state understandable without exposing unnecessary biometric details:

- Camera permission required.
- Position face in guide.
- One face required.
- Improve lighting / move closer / hold still.
- Perform the requested challenge.
- Liveness check failed; retry.
- Verifying securely.
- Access granted.
- Access denied / person not matched.
- Network temporarily unavailable.
- Session expired; start again.

Do not present a local “passed” animation as proof that the backend granted access.

---

## 8. Backend implementation details

### 8.1 Configuration and startup validation

- Use typed configuration and environment variables for secrets, model paths, threshold versions, payload sizes, timeouts, and database settings.
- Fail fast on missing/invalid model files, unapproved model license status, wrong vector dimension, unavailable database/index, missing signing keys, and unsupported model configuration.
- Do not download weights at runtime. Model assets must be provisioned deliberately and recorded in the asset register.
- Disable verbose/debug exception responses in deployment mode.
- Ensure the API binds to loopback in development by default. A public deployment must have proper TLS termination and firewall rules.

### 8.2 Secure ingestion

The diagram uses secure gRPC/WebSocket transport. Because FastAPI supports WebSockets directly, **WSS is the planned first data-plane transport**; use gRPC only if the project deliberately adds and operates a separate gRPC service. Do not implement REST streaming, WSS, and gRPC simultaneously without a clear requirement.

Recommended split:

- HTTPS control-plane endpoints for authentication, enrollment administration, challenge-session creation, revocation, and health/readiness checks.
- WSS inference connection opened **only after the Android local check passes**. Send a small JSON start message, then ordered binary image messages with explicit frame indexes, then an end-of-evidence message. Response is a single structured result with a request ID.
- The challenge-session creation call happens before camera capture and contains no image. If the local challenge fails, do not open WSS or send a face frame.

If a simple single request/response API is later selected instead, make a documented architecture decision to use HTTPS POST and update the diagram/doc/API contract coherently. Do not leave two competing protocols half-implemented.

### 8.3 Validate everything before model inference

The server must check:

- Authentication and caller authorization.
- Session exists, belongs to the caller, has not expired, and has not been consumed.
- Challenge/session nonce matches server-side state and cannot be replayed.
- Expected frame count, ordering, timestamp/sequence constraints, and overall payload limit.
- Image media type, actual decoded format, width/height, number of pixels, and successful decoder completion. Do not trust the file extension or MIME header alone.
- Request timeout, rate limits, concurrency limits, and maximum memory consumption.
- A decoded image actually contains the expected number of faces and meets model input requirements.
- Model adapters return finite values with the configured shape; reject NaN/Inf and malformed vectors.

Decode untrusted images in bounded memory. Re-encode to a known internal format if needed. Do not write a client-supplied filename to disk or pass arbitrary paths to a decoder.

### 8.4 Passive anti-spoof stage

- Define a stable adapter such as `PresentationAttackDetector.predict(image) -> structured result`.
- Record model name/version, input transform, score interpretation, thresholds, and approved-use status.
- Implement `REAL`, `SPOOF`, `UNCERTAIN`, and `ERROR` outcomes. Only a high-confidence `REAL` that satisfies the policy proceeds to identity matching. Treat `UNCERTAIN` and `ERROR` as not verified, with an appropriate retry or denial response.
- Apply the model's exact preprocessing: expected crop size, color order, normalization, and batch shape. Do not assume all MiniFASNet exports use identical layouts.
- If the challenge sends multiple keyframes, evaluate them according to an explicit policy. For example, all required frames must pass PAD; do not accept because just one of several frames is scored as real.
- Do not hardcode thresholds copied from a tutorial or a different model conversion. Calibrate against owner-supplied validation material and version the result.
- Log only the decision category, model version, request/session ID, and safe metrics needed for debugging. Never log raw frames or embeddings.

### 8.5 Embedding engine

- Define `FaceEmbeddingProvider.embed(aligned_face) -> vector` and keep preprocessing/model-loading inside the provider.
- Validate the exact weights' license and hash before loading in production.
- Set CPU inference first for reproducibility; add an acceleration provider only after its availability and behavior are measured on the target host.
- Check output dimension against the active model configuration, convert to the selected numeric type, reject non-finite values, and L2-normalize before cosine search if the selected model expects normalized embeddings.
- Store model name, version/hash, preprocessing version, vector dimension, and index generation in metadata.
- Never compare templates generated by different model versions without an explicit migration/revalidation plan. A model upgrade generally requires re-embedding enrolled users from owner-authorized enrollment material.

### 8.6 FAISS vector index

- Begin with an exact inner-product index for normalized vectors, such as `IndexFlatIP`, when the gallery is small enough. This is easier to validate than approximate search.
- For cosine similarity, normalize both database and query vectors consistently, then use the selected inner-product/search approach. Verify the metric and normalization with the chosen model.
- Keep stable integer FAISS keys mapped to opaque person UUIDs in the database. Do not rely on row positions as persistent identity IDs.
- Persist the FAISS index and its mapping metadata safely and atomically. A partially written index must not replace a known-good index.
- Keep a rebuild procedure from the authoritative template records. Test index/model version consistency on startup.
- Evaluate IVF/HNSW or other approximate indexes only after a benchmark proves exact search is insufficient.
- Enforce identity revocation on both metadata and vector index. A revoked identity must not still be matchable because a stale vector remains in FAISS.

### 8.7 Matching decision

The identity decision must include at least:

1. PAD passes.
2. Embedding is valid and matches the active model version.
3. A nearest candidate exists.
4. Similarity meets a threshold calibrated for this model, preprocessing, device, and intended gallery size.
5. The candidate account is active and authorized for this purpose.
6. No validation/session/security check failed.

Do not interpret the nearest result as a match automatically. If the highest similarity is below threshold, return `NO_MATCH`. If confidence is ambiguous or image quality is insufficient, require retry or a non-biometric fallback rather than lowering the threshold merely to improve the user experience.

### 8.8 Decision response

Return a structured response containing:

- `request_id`.
- A finite result code (`MATCH`, `NO_MATCH`, `PAD_REJECTED`, `QUALITY_REJECTED`, `RETRY_REQUIRED`, `SESSION_EXPIRED`, or `ERROR`).
- `matched_person_id` only on an authorized match.
- A short user-safe message.
- Model/version identifiers for protected diagnostic logs, not necessarily all public client responses.

Never expose the entire nearest-neighbor gallery, other people’s IDs, raw embeddings, internal secrets, stack traces, model paths, or thresholds that would enable easy bypass. The client must not treat timeouts, parse errors, or an empty response as success.

---

## 9. Enrollment, metadata, and revocation

Enrollment is essential for a recognition system, even though the original diagram shows only inference.

### 9.1 Enrollment flow

1. Authenticate an authorized user/administrator and show a clear purpose/privacy notice.
2. Obtain and record the required consent/authorization before collecting or processing face data.
3. Capture enrollment material from the actual person using the approved app flow. Do not use scraped or synthesized images.
4. Run face quality checks and any required PAD checks.
5. Generate an embedding with the same approved model/preprocessing version used for recognition.
6. Store the identity metadata and an opaque vector mapping. Prefer retaining embeddings rather than raw enrollment photos when the product does not need the original images.
7. Discard the image buffer after successful processing unless retaining it is a specifically justified, consented requirement.
8. Record the model and preprocessing version so future migrations can be planned safely.

The project must not create or populate this enrollment database automatically. The owner will perform real enrollment and decide the appropriate number/quality of images.

### 9.2 Suggested metadata fields

Use a relational metadata store for authoritative identity state. A minimal schema may include:

- `person`: opaque `person_id`, display label if required, active/revoked status, created timestamp, last updated timestamp.
- `consent_record`: purpose, notice/version, consent state, timestamp, withdrawal timestamp where applicable, and the record's access controls.
- `face_template`: template ID, `person_id`, FAISS integer key, embedding model/version, preprocessing version, vector dimension, created timestamp.
- `challenge_session`: session ID, account/device binding, server nonce or token digest, challenge plan/version, expiry, consumed flag, and safe timestamps.
- `recognition_event`: request ID, outcome category, reason category, model/index version, latency, and timestamp. No image, raw embedding, token, or unnecessary personal data.

Keep schema migrations versioned and reversible where practical. Do not insert placeholder rows.

### 9.3 Revocation and deletion

Implement an authenticated route/command to deactivate a person and remove all associated templates from searchable state. Deletion must cover:

- Database records and mappings.
- FAISS vector removal or a safe rebuild that excludes the revoked templates.
- Cached embeddings and any temporary files.
- Backups/retention lifecycle according to the documented policy.
- Any enrollment image copies if the system retains them at all.

The API must verify that the caller has permission to revoke that exact person. Avoid object-level authorization flaws based on client-provided IDs.

---

## 10. API and protocol contract

Freeze and document the contract before integrating Android and backend. Keep protocol types in one source of truth where feasible, and change them through reviewed, backward-compatible steps.

### 10.1 Control-plane endpoints

| Endpoint | Purpose | Important rules |
|---|---|---|
| `POST /v1/auth/...` | Authenticate or obtain an access token | Use a maintained flow; never embed a reusable server secret in the APK |
| `POST /v1/liveness-sessions` | Create a short-lived, one-time challenge | Store expected challenge server-side; return expiry and opaque session reference; no image is uploaded here |
| `POST /v1/enrollments` | Enroll an authorized real person | Require authorization/consent; use the approved model; do not seed data |
| `DELETE /v1/enrollments/{person_id}` | Revoke/delete enrollment | Enforce object-level authorization and remove searchable templates |
| `GET /health/live` | Process liveness check | Must not expose secrets or model details |
| `GET /health/ready` | Readiness (models/index/database loaded and approved) | Return not-ready if a required model is missing or license gate is blocked |

### 10.2 Inference WSS flow

Use one documented WebSocket contract. A suggested message order is:

1. Client opens `wss://<host>/v1/recognize` with a short-lived access token using the chosen secure authentication mechanism.
2. Client sends a start metadata message with the challenge/session reference and expected frame count.
3. Client sends per-frame metadata messages followed by binary crop payloads. Each crop has a sequential index; the server applies per-frame and total request limits.
4. Client sends an explicit end-of-evidence message.
5. Server validates everything, runs the pipeline, marks the session consumed, and returns one result message.
6. Client closes the connection, clears temporary payload memory, and updates the UI from the returned result.

Do not put an access token in a URL query string. Do not accept an unlimited stream of frames. Require timeouts and a clear state machine on both sides. Reject unexpected message types/order and close malformed or unauthorized connections.

### 10.3 Error semantics

Document and handle at least:

- Invalid/missing authentication.
- Expired/reused session.
- Challenge evidence mismatch.
- Invalid image payload or unsupported format.
- Frame count/size/rate limit exceeded.
- Face quality rejected.
- PAD rejected/uncertain.
- Model unavailable or incompatible.
- No candidate above threshold.
- Identity revoked/disabled.
- Database/index inconsistency.
- Timeout/transient transport failure.

All unknown errors must fail closed. The Android app may offer retry or fallback, but it may not interpret an unknown state as an access grant.

---

## 11. Database, index, and data retention

- Use SQLite for a single-process prototype where its constraints fit; choose PostgreSQL when concurrent access, operational separation, or multi-instance deployment requires it. Do not introduce a paid managed database requirement.
- Treat face crops and embeddings as high-risk personal data even if raw photographs are not stored.
- Do not log image bytes, base64 content, biometric embeddings, passwords, authorization headers, tokens, or challenge secrets.
- Delete request-local images as soon as inference finishes; avoid persistent temporary paths. Where disk buffering is unavoidable, use a private directory, restrictive permissions, short cleanup schedule, and no predictable filenames.
- Protect database files, backups, FAISS index files, and mapping files using operating-system access controls and encrypted storage appropriate to the deployment.
- Define backup retention, deletion handling, and recovery/rebuild steps before production use.
- Keep only the minimum data necessary for the stated purpose. Add a retention policy to `docs/SECURITY_AND_PRIVACY.md`.
- Do not send diagnostics to a third-party analytics service that receives identity or biometric information.

---

## 12. Security and privacy controls

### 12.1 Required security controls

- TLS for every remote connection; WSS must terminate with valid TLS. Do not disable certificate validation in release builds.
- Short-lived access credentials and short-lived, one-time liveness sessions; expire them and reject reuse.
- Server-side authorization on every enrollment, deletion, and identity-specific request.
- Rate limits and concurrency/timeout limits on all inference endpoints.
- Strict maximum frame count, image size, decoded dimensions, and request duration.
- Secure secret management on the server. No production secret in the APK, source code, sample config, Git history, or client logs.
- Validate and re-encode untrusted images before model use; handle parser failures safely.
- Generic externally visible rejection messages where detailed reason codes might aid abuse; keep detailed reason categories in restricted logs.
- Privacy-safe structured logging with request IDs and latency metrics but no biometric payloads.
- Dependency/model inventory, pinned versions, vulnerability checks, and upgrade review.
- Protected access to database/index files and encrypted backups where supported.
- Production `DEBUG` disabled and no raw exception/stack trace returned to clients.
- Fail closed if PAD, embedding, database, index, session, or authorization checks error.

### 12.2 Threats to address

| Threat | Required mitigation |
|---|---|
| Printed photo or screen replay | Local challenge + server-side PAD; validate with real, consented validation captures |
| Prerecorded video replay | One-time server challenge, short TTL, ordered/time-bound evidence, replay-session tracking, multi-frame/server verification |
| Modified client skips liveness | Treat client state as untrusted; backend checks its own session, evidence, and PAD |
| Reused captured request | One-time nonce/session, expiry, server-side consumed marker and idempotency rules |
| Fake/oversized image or decoder attack | Type/content validation, safe decode, pixel/frame/byte limits, timeouts |
| Brute-force/threshold probing | Authentication, rate limiting, minimal output, audit signals, lockout/cooldown policy appropriate to the use case |
| Cross-account access to an identity | Object-level authorization and caller-to-person relationship checks |
| Model/index mismatch | Persist model/index version metadata and check at startup |
| Deleted identity still matches | Revoke vectors and metadata together; rebuild/verify the index when necessary |
| Leaked face image/vector in logs or Git | Redaction, retention controls, `.gitignore`, secret scanning, no biometric fixtures |

### 12.3 Privacy and Indian legal review

Before deployment, provide a plain-language notice describing the purpose, data categories, retention, recipients, rights/contact route, and available alternative where practical. Obtain valid authorization/consent as applicable to the intended use and support withdrawal/revocation.

The [Digital Personal Data Protection Act, 2023](https://www.indiacode.nic.in/bitstream/123456789/22037/1/a2023-22.pdf) and the [Digital Personal Data Protection Rules, 2025](https://upload.indiacode.nic.in/showfile?actid=AC_CEN_45_0_00003_2023-22_1763464807080&filename=dpdprules2025.pdf&type=hindirule) have phased commencement provisions. Check the provisions and rules in force on the actual launch date and obtain qualified legal advice for the intended context. This document is an engineering plan, not legal advice. Treat facial images and face embeddings as high-risk personal data regardless of the final legal classification.

Do not deploy this system for covert monitoring or unconsented identification. For access control, provide an alternative process for people who cannot complete a challenge or whose face cannot be matched reliably.

---

## 13. Thresholds, calibration, and measurement

No universal matching or PAD threshold can safely be copied into this project.

### 13.1 Recognition threshold

- Calibrate the match threshold for the exact model weights, preprocessing, embedding dimension, normalization, camera conditions, and intended gallery size.
- Choose and document a target false-accept and false-reject trade-off appropriate to the use case; for access decisions, false acceptance is a security failure while false rejection also has operational/accessibility costs.
- Use only owner-provided, legally obtained validation material. Do not automatically download or create a dataset.
- Keep calibration artifacts, data descriptions, approval, and threshold version in a private/non-biometric-safe validation record; do not commit the facial samples.
- Recalibrate after any model, camera pipeline, crop, compression, embedding, or search-index change.

### 13.2 PAD/liveness measurement

Measure performance across the actual devices and operating conditions: normal camera captures, printed images, replay displays, changes in brightness, motion, blur, occlusion, varied poses, and other relevant attack categories when safely and lawfully available. Distinguish inability to measure from a successful result; do not claim “spoof-proof.”

Report at least:

- PAD false acceptance / attack acceptance and false rejection / bona fide rejection.
- Recognition false match and false non-match rates at the selected threshold.
- End-to-end success/failure rate and retry frequency.
- Median and p95 end-to-end latency.
- Median/p95 inference times for PAD, embedding, and search.
- Encoded frame size distribution and percentage that meet the 15 KB target without unacceptable accuracy degradation.
- CPU and peak memory utilization on the target backend and relevant Android devices.

A small convenience demo cannot establish production-grade biometric performance. Document the validation sample size, known gaps, and conditions tested.

---

## 14. Performance and reliability targets

Treat the following as initial engineering objectives, not guarantees. Adjust only after benchmarks on actual target devices and owner-provided data.

- Client analysis uses a bounded queue and latest-frame strategy; never permit unbounded frame buildup.
- Keep heavy ML work off the Android UI thread.
- Use model inference on CPU first for reproducibility, then compare supported acceleration providers only if useful.
- Load approved model sessions once at backend startup, not for every request.
- Reuse inference sessions safely; bound concurrent inference to avoid memory exhaustion.
- Use exact FAISS search first if gallery size allows; optimize index type only after profiling proves search is a bottleneck.
- Compress/resize crops only within the image-quality envelope validated for PAD and recognition.
- Measure full latency from button/start action to final decision; report p50/p95 rather than only best-case timing.
- Set request, model inference, WebSocket, and database timeouts explicitly.
- Define process readiness separately from liveness: a running process with an unapproved/missing model or stale index is not ready to accept recognition requests.

---

## 15. Step-by-step implementation roadmap

Each numbered item should be split further if it touches multiple concerns. Commit after every small coherent step. Do not mark a phase complete because code was generated; require build/check results.

### Phase 0 — Audit and establish the baseline

1. Inspect the repository tree, Android project configuration, Python version, dependency files, Git status, and current tests/build results.
2. Do not replace existing setup or update every dependency to latest automatically.
3. Create the architecture/decision record, third-party license register, model asset register, privacy/security document, and change protocol.
4. Add `.gitignore` entries for secrets, virtual environments, build artifacts, model binaries if managed separately, database files, logs, and all biometric material.
5. Commit each file/config change separately.

**Exit criterion:** baseline is documented; no uncommitted owner changes are lost; no identity/test data exists in the repository.

### Phase 1 — Android camera foundation

1. Verify camera permission and lifecycle flow.
2. Add CameraX preview without ML processing.
3. Add an `ImageAnalysis` analyzer with `STRATEGY_KEEP_ONLY_LATEST`.
4. Guarantee that every frame is closed on success, error, and cancellation.
5. Add a bounded analysis executor and visible camera state handling.
6. Build and run on a physical device; inspect memory/preview behavior.

**Exit criterion:** stable preview and analysis lifecycle; no unbounded queue; every code change committed.

### Phase 2 — Local face detection and quality

1. Add the selected detector with the approved dependency/version.
2. Define a stable result object for face box, landmarks/pose, quality flags, and timestamp.
3. Implement one-face, size, position, blur/quality, and clipping checks.
4. Confirm front-camera mirror/rotation/crop-coordinate correctness.
5. Add UI retry states without adding sample images or demo faces.

**Exit criterion:** quality rejection and acceptance paths work on owner-provided consented captures; no upload code exists on this branch yet.

### Phase 3 — MediaPipe mesh and liveness state machine

1. Pin MediaPipe library and model asset versions; record license/provenance.
2. Implement the state machine and challenge model as an isolated module.
3. Add the challenge-session DTO and expiration handling.
4. Use face mesh/blendshape/pose evidence to determine local action progression.
5. Implement timeout, retry, cancel, and secure buffer cleanup.
6. Verify that failure returns locally to retry and never submits a face payload.

**Exit criterion:** deterministic state transitions; session/challenge state cannot be reused; failed attempts stay local for inference purposes.

### Phase 4 — Payload extraction and budget

1. Implement crop/alignment based on model input expectations, without loading an unapproved model.
2. Choose the target image format and encoder.
3. Enforce configurable per-crop and total-payload limits on the client.
4. Measure actual encoded sizes and visual/feature quality using only owner-provided captures.
5. Document when the 15 KB target cannot be met safely and require a deliberate decision instead of over-compressing silently.

**Exit criterion:** payload code is independently reviewed and buffer cleanup is verified.

### Phase 5 — Backend skeleton and API contract

1. Create the FastAPI app, typed settings, health/readiness endpoints, and structured error responses.
2. Add request schema/version definitions and payload limits.
3. Add authentication/authorization middleware or dependencies.
4. Add server-side one-time challenge-session storage and verification.
5. Configure local development only; no public unauthenticated endpoint.
6. Add API contract documentation before Android integration.

**Exit criterion:** backend starts, reports accurate readiness, validates schemas/auth/session state, and contains no model/test identities.

### Phase 6 — Secure transport

1. Implement HTTPS control-plane calls for session creation/management.
2. Implement the WSS inference protocol with explicit message order and bounded binary frame uploads.
3. Connect Android only after the local liveness gate passes.
4. Add message validation, timeouts, authentication, one-time use, replay rejection, and rate limits.
5. Verify that failed local attempts produce no inference WebSocket connection and no face payload transmission.
6. Do not implement a second transport as a shortcut; document any switch as an architecture decision.

**Exit criterion:** wire protocol is versioned and Android/backend behavior agrees on success and every failure mode.

### Phase 7 — MiniFASNet integration

1. Review and approve the exact upstream model asset/license; store revision and SHA-256 in the model asset register.
2. Implement a `PresentationAttackDetector` interface.
3. Implement safe decode, model-specific preprocessing, inference, and structured outcomes.
4. Reject invalid, uncertain, and spoof outcomes before the embedding stage.
5. Add startup checks so an absent or unapproved model blocks readiness.
6. Benchmark with owner-provided camera material and record limitations honestly.

**Exit criterion:** server never runs recognition after a PAD failure; no raw images in logs/storage.

### Phase 8 — Embedding engine and license approval

1. Implement `FaceEmbeddingProvider` and a model metadata/configuration contract.
2. Research exact model/weights license and provenance. For InsightFace pretrained models, respect the non-commercial research restriction unless the selected model is separately licensed for intended use.
3. Choose and approve a model with suitable dimensionality, preprocessing, and rights for the project's real use.
4. Record exact weight hash, model version, dimension, normalization, and preprocessing.
5. Implement inference, finite-vector validation, and normalization.
6. Add model adapter checks without creating fake embeddings or identity templates.

**Exit criterion:** model license is `APPROVED` for the intended use, model startup validation is enforced, and output dimension is verified.

### Phase 9 — Database and enrollment

1. Add schema migrations and repositories for identity status, consent record, template mapping, challenge sessions, and privacy-safe audit events.
2. Implement an authorized enrollment flow using only owner-supplied real data.
3. Store metadata/vector mapping; avoid raw image retention by default.
4. Implement revocation/deletion and permission checks.
5. Add atomic persistence/recovery of FAISS index and mapping.
6. Never seed or automatically create a person/template row.

**Exit criterion:** real enrollment works only when explicitly initiated; revocation removes the record from live search; database starts empty unless the owner enrolls people.

### Phase 10 — FAISS search and final decisions

1. Implement the index service and stable FAISS-ID-to-person-ID mapping.
2. Start with an exact index and documented metric.
3. Normalize query/index vectors consistently if using cosine similarity through inner product.
4. Apply the calibrated threshold and account active/revoked checks.
5. Return only the minimum authorized result fields.
6. Verify index consistency and safe rebuild behavior on startup/restart.

**Exit criterion:** unknown/low-similarity/error conditions fail closed; only approved active identities can return `MATCH`.

### Phase 11 — Security hardening and privacy review

1. Audit authentication, authorization, object-level access, challenge replay, request limits, error messages, TLS, and secret storage.
2. Confirm logs never contain image bytes, embeddings, credentials, or request bodies.
3. Verify retention, consent, withdrawal, revocation, backup, and recovery procedures.
4. Run dependency and model license inventory checks.
5. Use threat-model review for printed photo, screen replay, recorded challenge, client tampering, and oversized payloads.
6. Document a non-biometric fallback and incident response steps.

**Exit criterion:** security/privacy checklist signed off by the project owner; no unresolved critical risks presented as solved.

### Phase 12 — Owner-led validation and performance tuning

1. Owner supplies consented enrollment and validation material, kept outside Git.
2. Record data provenance/consent and validation conditions without publishing the images.
3. Measure PAD/recognition error rates and p50/p95 latency.
4. Select thresholds and payload limits based on those measurements.
5. Test target Android devices, lighting, camera orientations, and expected network quality.
6. Repeat relevant validation after any model/crop/compression change.

**Exit criterion:** a reviewed results report exists with actual numbers, limitations, sample sizes, and clear go/no-go conditions. No data is invented to fill missing metrics.

### Phase 13 — Packaging and release readiness

1. Pin dependency versions and generate reproducible lock files.
2. Verify license/notice inclusion for app packages and backend container/release artifacts.
3. Keep model files and secrets out of source control unless explicitly approved and appropriately licensed.
4. Configure production TLS, firewall, process supervision, backup, retention, monitoring, and alerting.
5. Verify release builds have no debug mode, test accounts, demo enrollment buttons, hardcoded secrets, or hidden sample content.
6. Publish user-facing privacy notice, consent/withdrawal instructions, limitations, and fallback process.
7. Record the release commit/tag and the exact model/index versions deployed.

**Exit criterion:** all critical checklist items pass; no claim of production readiness while model licensing, validation, or security approval is unresolved.

---

## 16. Validation checklist (no synthetic biometric data)

Mark each item `NOT STARTED`, `PASS`, `FAIL`, or `BLOCKED — owner data required`; attach a commit/hash and evidence where appropriate.

### Android

- [ ] Camera permission denial and grant states handled.
- [ ] Camera is bound/unbound with lifecycle correctly.
- [ ] `ImageProxy` always closes, including exceptions and cancellations.
- [ ] Analysis is bounded and does not build a stale-frame backlog.
- [ ] No face, multiple faces, poor pose, low resolution, and challenge failure all take the local retry/drop path.
- [ ] No inference image/payload is sent on local failure.
- [ ] Crop orientation, mirroring, alignment, and encoded format are consistent.
- [ ] Temporary image buffers are cleared after cancellation/success/failure.
- [ ] The UI reports the server decision rather than treating local liveness as a grant.

### Backend

- [ ] Startup refuses missing/unapproved model files and incompatible dimensions.
- [ ] API rejects unauthorized access and expired/reused sessions.
- [ ] Request-size, frame-count, dimension, timeout, and concurrency limits are enforced.
- [ ] Bad media headers and malformed image bytes are handled safely.
- [ ] PAD rejection prevents embedding and search.
- [ ] Invalid/non-finite embedding output fails closed.
- [ ] FAISS metric, normalization, mapping, persistence, and reload behavior are documented.
- [ ] Threshold decisions are based on approved owner validation, not tutorial defaults.
- [ ] Identity deletion removes it from searchable state.
- [ ] Logs, errors, metrics, and backups contain no unintended biometric payloads.

### Security/privacy/licensing

- [ ] TLS and certificate validation are enabled.
- [ ] Secrets are not in the APK, Git, logs, or public configs.
- [ ] Every third-party library and model asset has a version/hash and license record.
- [ ] InsightFace model restrictions or any replacement model terms have been resolved for the intended use.
- [ ] PAD model asset license/provenance has been reviewed.
- [ ] Consent/authorization, notice, retention, revocation, and fallback are documented.
- [ ] Threat review includes photo, screen replay, prerecorded video, and modified-client paths.
- [ ] Owner-provided validation results and limitations are recorded; no synthetic identities or face fixtures were introduced.

---

## 17. Release go/no-go criteria

**Do not release** if any of the following is true:

- The embedding or PAD weights are unlicensed/unapproved for the intended deployment.
- The model, preprocessing, vector dimension, or index version is not pinned.
- The server trusts only a client-provided `liveness_passed=true` flag.
- An expired or already-consumed challenge can be replayed.
- Failed local liveness attempts upload face images for inference.
- Unknown errors, timeouts, missing models, or database/index errors can result in access granted.
- Similarity thresholds have not been evaluated with owner-provided consented validation data.
- No revocation/deletion path exists, or deleted identities remain in live search.
- Secrets, raw faces, embeddings, or user-supplied test data are present in Git/logs.
- The implementation requires a paid API despite the project's no-cost tooling constraint.
- Production privacy notice, user authorization, or required legal review is unresolved.

---

## 18. Research references and source links

Links below are the primary documentation/repositories reviewed for this plan. Re-check versions and licenses when actually implementing because branches, packages, model assets, and applicable law can change.

### Android and on-device vision

1. [Android CameraX Image Analysis](https://developer.android.com/media/camera/camerax/analyze) — frame analysis and `STRATEGY_KEEP_ONLY_LATEST` behavior.
2. [Google ML Kit Face Detection for Android](https://developers.google.com/ml-kit/vision/face-detection/android) — detector setup and image/face resolution guidance.
3. [ML Kit Terms and Privacy](https://developers.google.com/ml-kit/terms) — on-device processing and possible service contacts for updates/compatibility.
4. [MediaPipe Face Landmarker for Android](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/android) — live-stream landmarks and blendshapes.
5. [MediaPipe source repository](https://github.com/google-ai-edge/mediapipe) — source and license information; verify any downloaded model bundle separately.

### Backend, transport, vector search

6. [FastAPI source and license](https://github.com/fastapi/fastapi) — MIT.
7. [FastAPI HTTPS deployment](https://fastapi.tiangolo.com/deployment/https/) — TLS/deployment guidance.
8. [ONNX Runtime source and license](https://github.com/microsoft/onnxruntime) — MIT runtime license; the model assets remain separately licensed.
9. [FAISS source and license](https://github.com/facebookresearch/faiss) — MIT vector search library.
10. [gRPC authentication guidance](https://grpc.io/docs/guides/auth/) — transport authentication concepts if the project later selects gRPC.
11. [OWASP API Security Top 10 (2023)](https://owasp.org/API-Security/editions/2023/en/0x11-t10) — access-control, authentication, and resource-consumption risks.

### Face models, anti-spoofing, and evaluation

12. [InsightFace main repository](https://github.com/deepinsight/insightface) — distinguishes MIT-licensed code from pretrained model terms; its current notices state that open-source pretrained models are for non-commercial research unless licensed otherwise.
13. [InsightFace model zoo license notes](https://github.com/deepinsight/insightface/blob/master/python-package/docs/model_zoo.md) — review before using a pretrained model.
14. [OpenCV Zoo SFace model directory](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) — candidate embedding model; inspect the exact assets and open licensing/provenance questions before deployment.
15. [OpenCV Zoo SFace license/provenance issue opened July 2026](https://github.com/opencv/opencv_zoo/issues/313) — public request for clarification about training-data provenance and use of the exact pretrained weights; review its current status before making a deployment decision.
16. [MiniVision Silent-Face-Anti-Spoofing repository](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing) — MiniFASNet PAD candidate; verify the exact selected files and use terms.
17. [Yakhyo MiniFASNet/ONNX inference repository](https://github.com/yakhyo/face-anti-spoofing) — alternative inference/export code; independently review model-weight provenance and file licensing.
18. [NIST FATE Part 10: Passive Software-Based PAD Evaluation](https://www.nist.gov/publications/face-analysis-technology-evaluation-fate-part-10-performance-passive-software-based) — evidence that PAD performance varies across algorithms and attack types.

### Privacy/legal source

19. [India Code — Digital Personal Data Protection Act, 2023 (PDF)](https://www.indiacode.nic.in/bitstream/123456789/22037/1/a2023-22.pdf).
20. [Government of India — Digital Personal Data Protection Rules, 2025 (PDF)](https://upload.indiacode.nic.in/showfile?actid=AC_CEN_45_0_00003_2023-22_1763464807080&filename=dpdprules2025.pdf&type=hindirule).

---

## 19. Final implementation rule

Implement this system as **small, reviewed, committed increments**. Reuse the existing repository, avoid broad rewrites, keep every real face sample outside Git, and do not invent test identities or biometric data. Do not proceed past a model/license gate based on assumptions. Prioritize correct lifecycle handling, fail-closed decisions, privacy-safe data flow, and measurable performance over adding features quickly.
