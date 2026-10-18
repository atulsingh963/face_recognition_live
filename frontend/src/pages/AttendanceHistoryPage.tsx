import React, { useState, useEffect, useCallback } from 'react';
import { fetchAttendanceHistory, ApiError } from '../lib/api';
import type { AttendanceRecord, StudentProfile } from '../lib/types';

interface AttendanceHistoryPageProps {
  student: StudentProfile;
}

export const AttendanceHistoryPage: React.FC<AttendanceHistoryPageProps> = ({ student }) => {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const data = await fetchAttendanceHistory();
      setRecords(data.records);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg('Failed to load attendance history.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Attendance History
          </h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Official verified attendance audit records for {student.first_name} {student.last_name} ({student.roll_number}).
          </p>
        </div>
        <button
          type="button"
          disabled={isLoading}
          className="btn btn-secondary"
          onClick={loadHistory}
        >
          {isLoading ? 'Refreshing...' : 'Refresh Records'}
        </button>
      </div>

      {errorMsg && (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          {errorMsg}
        </div>
      )}

      <div className="card">
        {records.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-secondary)' }}>
            <p style={{ fontSize: '1.1rem', fontWeight: 600 }}>No Attendance Records Found</p>
            <p style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
              Complete face verification to mark your attendance.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Record #</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Timestamp (UTC)</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Status</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Biometric Match</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Liveness Score</th>
                  <th style={{ padding: '0.75rem 0.5rem' }}>Client Source</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'var(--font-mono)' }}>#{r.id}</td>
                    <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'var(--font-mono)' }}>
                      {new Date(r.timestamp).toLocaleString()}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <span className="status-badge ready" style={{ fontSize: '0.75rem' }}>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'var(--font-mono)' }}>
                      {(r.similarity_score * 100).toFixed(1)}%
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'var(--font-mono)' }}>
                      {(r.liveness_score * 100).toFixed(1)}%
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>
                      {r.device_info || 'Local Camera'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
