import React from 'react';
import type { BackendSystemStatus, StudentProfile } from '../lib/types';
import { StatusCard } from '../components/StatusCard';

interface DashboardPageProps {
  status: BackendSystemStatus;
  student: StudentProfile | null;
  onNavigateToVerification: () => void;
  onNavigateToEnrollment: () => void;
  onRefresh: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  status,
  student,
  onNavigateToVerification,
  onNavigateToEnrollment,
  onRefresh,
}) => {
  const isOnline = status.connection === 'connected';
  const isReady = isOnline && status.readiness?.ready_for_inference;

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
          Student Dashboard
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Welcome back, {student ? `${student.first_name} ${student.last_name}` : 'Student'}.
        </p>
      </div>

      <div className="card-grid">
        <StatusCard
          title="Student Status"
          value={student ? student.roll_number : 'Not Logged In'}
          statusBadge={
            student?.is_enrolled
              ? { text: 'ENROLLED', variant: 'ready' }
              : { text: 'UNENROLLED', variant: 'not_ready' }
          }
          description={
            student?.is_enrolled
              ? 'Biometric face template is enrolled and ready for attendance'
              : 'Face not enrolled. Complete camera enrollment to mark attendance.'
          }
        />

        <StatusCard
          title="Inference Readiness"
          value={isReady ? 'Ready' : 'Not Ready (Gated)'}
          statusBadge={
            isReady
              ? { text: 'READY', variant: 'ready' }
              : { text: 'FAIL-CLOSED', variant: 'not_ready' }
          }
          description={
            isReady
              ? 'YuNet, MiniFASNet-V2, and ArcFace ONNX models initialized'
              : 'Biometric inference models not loaded'
          }
        />

        <StatusCard
          title="Backend Connectivity"
          value={isOnline ? 'Online' : status.connection === 'checking' ? 'Connecting...' : 'Disconnected'}
          statusBadge={
            isOnline
              ? { text: '200 OK', variant: 'live' }
              : { text: status.connection === 'checking' ? 'CHECKING' : 'OFFLINE', variant: 'offline' }
          }
          description={
            isOnline ? 'Local FastAPI service reachable' : 'FastAPI offline at 127.0.0.1:8000'
          }
        />

        <StatusCard
          title="Local Privacy Store"
          value="SQLite (Active)"
          statusBadge={{ text: 'OFFLINE/LOCAL', variant: 'live' }}
          description="Storage path: local_data/attendance.db (zero cloud transmission)"
        />
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-title">
          <span>Student Attendance Workflow</span>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>
          {student?.is_enrolled
            ? 'Your face template is active. Click below to start the live attendance verification session with anti-spoofing challenge response.'
            : 'You have not enrolled your face yet. Click "Enroll Face Template" to complete initial registration using the local camera.'}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {student?.is_enrolled ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onNavigateToVerification}
            >
              Mark Live Attendance &rarr;
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onNavigateToEnrollment}
            >
              Enroll Face Template &rarr;
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={onRefresh}
          >
            Poll Backend Status
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <span>Environment & Configuration</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', fontSize: '0.85rem' }}>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Target Host:</span>
            <div style={{ fontFamily: 'var(--font-mono)', marginTop: '0.2rem' }}>http://127.0.0.1:8000</div>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Roll Number Format:</span>
            <div style={{ fontFamily: 'var(--font-mono)', marginTop: '0.2rem' }}>^[A-Za-z0-9_-]&#123;5,20&#125;$</div>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Biometric Algorithm:</span>
            <div style={{ marginTop: '0.2rem' }}>YuNet + MiniFASNet-V2 + ArcFace 512D</div>
          </div>
        </div>
      </div>
    </div>
  );
};
