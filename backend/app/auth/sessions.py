"""Challenge session management service enforcing single-use, TTL, and replay protection."""
import secrets
import time
import uuid
from typing import Dict, List, Optional
from app.config.settings import settings
from app.domain.models import LivenessAction


class SessionRecord:
    def __init__(self, session_id: str, actions: List[LivenessAction], server_nonce: str, expires_at: float):
        self.session_id = session_id
        self.actions = actions
        self.server_nonce = server_nonce
        self.expires_at = expires_at
        self.consumed = False


class ChallengeSessionManager:
    def __init__(self):
        self._sessions: Dict[str, SessionRecord] = {}

    def create_session(self) -> SessionRecord:
        session_id = str(uuid.uuid4())
        server_nonce = secrets.token_hex(16)
        expires_at = time.time() + settings.CHALLENGE_SESSION_EXPIRE_SECONDS
        
        # Select randomized non-repeating actions
        all_actions = [LivenessAction.BLINK, LivenessAction.TURN_LEFT, LivenessAction.TURN_RIGHT, LivenessAction.SMILE]
        selected_actions = secrets.SystemRandom().sample(all_actions, k=2)
        
        record = SessionRecord(
            session_id=session_id,
            actions=selected_actions,
            server_nonce=server_nonce,
            expires_at=expires_at,
        )
        self._sessions[session_id] = record
        self._purge_expired()
        return record

    def validate_and_consume(self, session_id: str, nonce: Optional[str] = None) -> bool:
        """Validates that a session exists, is unexpired, matches nonce, and marks it consumed atomically."""
        record = self._sessions.get(session_id)
        if not record:
            return False
            
        if record.consumed:
            return False
            
        if time.time() > record.expires_at:
            return False
            
        if nonce and record.server_nonce != nonce:
            return False
            
        # Atomically mark consumed to prevent replay
        record.consumed = True
        return True

    def get_session(self, session_id: str) -> Optional[SessionRecord]:
        return self._sessions.get(session_id)

    def _purge_expired(self):
        now = time.time()
        expired_keys = [k for k, v in self._sessions.items() if v.expires_at < now or v.consumed]
        # Keep recent list bounded
        if len(expired_keys) > 50:
            for k in expired_keys:
                self._sessions.pop(k, None)


challenge_session_manager = ChallengeSessionManager()
