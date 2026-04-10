import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';

type AuditLog = {
  logId: number;
  userId: number | null;
  activityType: string;
  timestamp: string;
  user?: {
    userId: number;
    username: string;
    role: string;
  } | null;
};

const normalizeText = (value: string) => value.trim().toLowerCase();

const escapeCsv = (value: string | number | null | undefined) => {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const createCsv = (rows: AuditLog[]) => {
  const headers = ['Log ID', 'Timestamp', 'Username', 'Role', 'User ID', 'Activity'];
  const lines = rows.map((row) => [
    row.logId,
    new Date(row.timestamp).toISOString(),
    row.user?.username ?? 'System',
    row.user?.role ?? '-',
    row.userId,
    row.activityType,
  ]);

  return [headers, ...lines].map((line) => line.map((value) => escapeCsv(value)).join(',')).join('\n');
};

const downloadCsv = (filename: string, csv: string) => {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const AuditLogsPage = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [queryUser, setQueryUser] = useState('');
  const [queryActivity, setQueryActivity] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/audit');
      setLogs(response.data as AuditLog[]);
    } catch {
      setError('Failed to load audit logs. Doctor access is required.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();
  }, []);

  const filteredLogs = useMemo(() => {
    const userQ = normalizeText(queryUser);
    const activityQ = normalizeText(queryActivity);
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null;

    return logs.filter((log) => {
      const logTime = new Date(log.timestamp).getTime();
      if (from && logTime < from) return false;
      if (to && logTime > to) return false;

      if (userQ) {
        const username = normalizeText(log.user?.username ?? 'system');
        const role = normalizeText(log.user?.role ?? '');
        const userId = String(log.userId ?? '');
        const userMatched = username.includes(userQ) || role.includes(userQ) || userId.includes(userQ);
        if (!userMatched) return false;
      }

      if (activityQ && !normalizeText(log.activityType).includes(activityQ)) return false;

      return true;
    });
  }, [logs, queryUser, queryActivity, dateFrom, dateTo]);

  const onFilterSubmit = (e: FormEvent) => {
    e.preventDefault();
  };

  const onReset = () => {
    setQueryUser('');
    setQueryActivity('');
    setDateFrom('');
    setDateTo('');
  };

  const onExportCsv = () => {
    const csv = createCsv(filteredLogs);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`audit-logs-${stamp}.csv`, csv);
  };

  return (
    <section className="card">
      <div className="section-head">
        <h1>Audit Logs</h1>
        <p className="muted">Monitor recent system activity (latest 200 records from server).</p>
      </div>

      <form onSubmit={onFilterSubmit} className="audit-filters-grid">
        <input
          value={queryUser}
          onChange={(e) => setQueryUser(e.target.value)}
          placeholder="User / role / user ID"
        />
        <input
          value={queryActivity}
          onChange={(e) => setQueryActivity(e.target.value)}
          placeholder="Activity keyword"
        />
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" />
        <button type="button" className="btn-secondary" onClick={onReset}>Reset</button>
      </form>

      <div className="action-row" style={{ marginTop: 10 }}>
        <button type="button" className="btn-secondary" onClick={() => void loadLogs()}>
          Refresh
        </button>
        <button type="button" onClick={onExportCsv} disabled={filteredLogs.length === 0}>
          Export CSV
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading...</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>Role</th>
              <th>User ID</th>
              <th>Activity</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map((log) => (
              <tr key={log.logId}>
                <td>{new Date(log.timestamp).toLocaleString()}</td>
                <td>{log.user?.username ?? 'System'}</td>
                <td>{log.user?.role ?? '-'}</td>
                <td>{log.userId ?? '-'}</td>
                <td>
                  <span className="activity-pill">{log.activityType}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mobile-cards">
        {filteredLogs.map((log) => (
          <article key={log.logId} className="mobile-card">
            <h4>{log.user?.username ?? 'System'}</h4>
            <dl className="kv">
              <div>
                <dt>Timestamp</dt>
                <dd>{new Date(log.timestamp).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{log.user?.role ?? '-'}</dd>
              </div>
              <div>
                <dt>User ID</dt>
                <dd>{log.userId ?? '-'}</dd>
              </div>
              <div>
                <dt>Activity</dt>
                <dd><span className="activity-pill">{log.activityType}</span></dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      {!loading && filteredLogs.length === 0 && <p className="muted">No audit logs match the current filters.</p>}
    </section>
  );
};
