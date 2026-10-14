import React from 'react';

interface StatusCardProps {
  title: string;
  value: React.ReactNode;
  statusBadge?: {
    text: string;
    variant: 'live' | 'ready' | 'not_ready' | 'offline' | 'warning' | 'info';
  };
  description?: string;
  icon?: React.ReactNode;
}

export const StatusCard: React.FC<StatusCardProps> = ({
  title,
  value,
  statusBadge,
  description,
  icon,
}) => {
  return (
    <div className="card">
      <div className="card-title">
        <span>{title}</span>
        {statusBadge && (
          <span className={`status-badge ${statusBadge.variant}`}>
            <span className="status-dot" />
            {statusBadge.text}
          </span>
        )}
      </div>
      <div className="metric-value">{value}</div>
      {description && <div className="metric-desc">{description}</div>}
      {icon && <div style={{ marginTop: '0.5rem' }}>{icon}</div>}
    </div>
  );
};
