# face_recognition_live

Face Recognition & Challenge-based Liveness Verification System with Android Client and Python/FastAPI Backend.

This repository includes a local web-based development and manual verification console (`frontend/`) connected to the FastAPI backend (`backend/app`).

---

## 1. Prerequisites & Environment

- **Python**: `>=3.11` (tested with Python 3.13)
- **Node.js**: `>=18` (tested with Node.js v24.19.0 and npm 11.17.0)
- **Browser**: Modern web browser supporting MediaDevices API (Chrome, Edge, Firefox)

---

## 2. Local Startup Workflow (Concurrent Two-Terminal Setup)

### Terminal 1 — Backend (FastAPI)

```powershell
cd D:\Projects\face_recognition_live\backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The backend starts listening on `http://127.0.0.1:8000`.

- Service Root: `http://127.0.0.1:8000/`
- Live Health Probe: `http://127.0.0.1:8000/health/live`
- Model Readiness Probe: `http://127.0.0.1:8000/health/ready`
- Interactive API Docs (when `DEBUG=True`): `http://127.0.0.1:8000/docs`

### Terminal 2 — Frontend (Vite + React)

```powershell
cd D:\Projects\face_recognition_live\frontend
npm ci
npm run dev -- --host 127.0.0.1
```

*(If you are setting up without an existing package-lock or after dependencies changes, use `npm install`).*

The frontend web console will be available at:
**`http://127.0.0.1:5173`**

---

## 3. Configuration

### Frontend Configuration
Frontend environment variables are configured in `frontend/.env` (template provided in `frontend/.env.example`):

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000
```

### Backend Configuration
Backend configuration is managed via Pydantic Settings in `backend/app/config/settings.py` (with override support via `.env`):
- `HOST`: Server host (default `127.0.0.1`)
- `PORT`: Server port (default `8000`)
- `CORS_ORIGINS`: Allowed local origins for frontend access (default `["http://127.0.0.1:5173", "http://localhost:5173"]`)
- `PAD_MODEL_APPROVED`: Boolean gate for PAD inference (default `False`)
- `EMBEDDING_MODEL_APPROVED`: Boolean gate for face embedding extraction (default `False`)

---

## 4. Understanding Health vs. Readiness

- **Health (`/health/live`)**:
  Confirms that the FastAPI server process is online, listening on the socket, and able to respond to HTTP requests. A passing health check does **not** indicate that biometric models are loaded or approved.
- **Readiness (`/health/ready`)**:
  Evaluates model approval gates (`PAD_MODEL_APPROVED` and `EMBEDDING_MODEL_APPROVED`). By default, unapproved models cause the backend to return `status: "not_ready"` and `ready_for_inference: false`. This enforces a **Fail-Closed** security architecture to prevent unvalidated biometric decisions.

---

## 5. Architectural & Verification Scope

- **Primary Target Client**: The authoritative production client architecture specified in project documentation is the **Android mobile client**.
- **Local Web Console Role**: The React frontend provides a local development, diagnostic, and manual testing console to inspect backend telemetry, verify challenge-response sessions, and validate camera capture.
- **Biometric Inference & PAD**:
  - Live challenge session creation (`POST /v1/liveness-sessions`), randomized action generation, anti-replay nonce tracking, camera streaming, and single-use session consumption are fully connected.
  - Evidence submission (`/v1/verifications`) requires data-plane endpoint registration and licensed model weights. The UI displays an explicit unavailable notice rather than fabricating simulated biometric results.
- **Zero Third-Party Telemetry**: Face frames are kept in browser memory only during active sessions and are never sent to third-party APIs or saved in localStorage.

---

## 6. Troubleshooting

1. **CORS Errors**:
   Ensure the frontend URL matches one of `CORS_ORIGINS` in `backend/app/config/settings.py` (e.g. `http://127.0.0.1:5173`).
2. **Camera Access Denied**:
   Click the site lock/permissions icon in your browser address bar, set Camera to "Allow", and click "Start Camera" again. Ensure no other application (e.g., Zoom, Teams) holds an exclusive camera lock.
3. **Port Conflicts**:
   If port 8000 or 5173 is already occupied, stop the existing process or adjust the respective configuration.
