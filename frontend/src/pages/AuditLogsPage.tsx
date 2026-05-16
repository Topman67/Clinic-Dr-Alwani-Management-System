import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';
import { subscribeInAppDataSync } from '../lib/sync';
import { usePagination } from '../lib/pagination';
import { DateRangeFilter, getDateRangeForPreset, type DateRangeValue } from '../components/DateRangeFilter';
import { Pagination } from '../components/Pagination';
import { Button, Card, Input, Table, TableHead, TableWrap, Td, Th } from '../components/ui';
import { ui } from '../styles/ui';

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
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => getDateRangeForPreset('last7'));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/audit-logs');
      setLogs(response.data as AuditLog[]);
    } catch {
      setError('Failed to load audit logs. Doctor access is required.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void loadLogs();
    });
  }, [loadLogs]);

  const filteredLogs = useMemo(() => {
    const userQ = normalizeText(queryUser);
    const activityQ = normalizeText(queryActivity);
    const from = dateRange.dateFrom ? new Date(`${dateRange.dateFrom}T00:00:00`).getTime() : null;
    const to = dateRange.dateTo ? new Date(`${dateRange.dateTo}T23:59:59`).getTime() : null;

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
  }, [logs, queryUser, queryActivity, dateRange.dateFrom, dateRange.dateTo]);

  const {
    page: listPage,
    setPage: setListPage,
    totalPages: listTotalPages,
    paginated: paginatedLogs,
  } = usePagination(filteredLogs, 10, [queryUser, queryActivity, dateRange.dateFrom, dateRange.dateTo]);

  const onFilterSubmit = (e: FormEvent) => {
    e.preventDefault();
  };

  const onReset = () => {
    setQueryUser('');
    setQueryActivity('');
    setDateRange(getDateRangeForPreset('last7'));
  };

  const onExportCsv = () => {
    const csv = createCsv(filteredLogs);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`audit-logs-${stamp}.csv`, csv);
  };

  return (
    <Card>
      <div className={ui.sectionHead}>
        <h1 className={ui.sectionTitle}>Audit Logs</h1>
        <p className={ui.sectionSubtitle}>Monitor recent system activity (latest 200 records from server).</p>
      </div>

      <form onSubmit={onFilterSubmit} className="grid grid-cols-[1.4fr_1.4fr_1fr_1fr_auto] items-center gap-2.5 max-[1080px]:grid-cols-2 max-[640px]:grid-cols-1">
        <Input
          value={queryUser}
          onChange={(e) => setQueryUser(e.target.value)}
          placeholder="User / role / user ID"
        />
        <Input
          value={queryActivity}
          onChange={(e) => setQueryActivity(e.target.value)}
          placeholder="Activity keyword"
        />
        <DateRangeFilter value={dateRange} onChange={setDateRange} includeAll />
        <Button variant="secondary" onClick={onReset}>Reset</Button>
      </form>

      <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
        <Button variant="secondary" onClick={() => void loadLogs()}>
          Refresh
        </Button>
        <Button onClick={onExportCsv} disabled={filteredLogs.length === 0}>
          Export CSV
        </Button>
      </div>

      {error && <p className={ui.error}>{error}</p>}
      {loading && <p className={ui.muted}>Loading...</p>}

      <TableWrap className="max-[640px]:hidden">
        <Table>
          <TableHead>
            <tr>
              <Th>Timestamp</Th>
              <Th>User</Th>
              <Th>Role</Th>
              <Th>User ID</Th>
              <Th>Activity</Th>
            </tr>
          </TableHead>
          <tbody>
            {paginatedLogs.map((log) => (
              <tr key={log.logId}>
                <Td>{new Date(log.timestamp).toLocaleString()}</Td>
                <Td>{log.user?.username ?? 'System'}</Td>
                <Td>{log.user?.role ?? '-'}</Td>
                <Td>{log.userId ?? '-'}</Td>
                <Td>
                  <span className="activity-pill">{log.activityType}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <Pagination page={listPage} totalPages={listTotalPages} onPageChange={setListPage} />

      <div className={ui.mobileCards}>
        {paginatedLogs.map((log) => (
          <article key={log.logId} className={ui.mobileCard}>
            <h4 className={ui.mobileCardTitle}>{log.user?.username ?? 'System'}</h4>
            <dl className={ui.kv}>
              <div className={ui.kvRow}>
                <dt className={ui.kvTerm}>Timestamp</dt>
                <dd>{new Date(log.timestamp).toLocaleString()}</dd>
              </div>
              <div className={ui.kvRow}>
                <dt className={ui.kvTerm}>Role</dt>
                <dd>{log.user?.role ?? '-'}</dd>
              </div>
              <div className={ui.kvRow}>
                <dt className={ui.kvTerm}>User ID</dt>
                <dd>{log.userId ?? '-'}</dd>
              </div>
              <div className={ui.kvRow}>
                <dt className={ui.kvTerm}>Activity</dt>
                <dd><span className="activity-pill">{log.activityType}</span></dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      {!loading && filteredLogs.length === 0 && <p className={ui.muted}>No audit logs match the current filters.</p>}
    </Card>
  );
};
