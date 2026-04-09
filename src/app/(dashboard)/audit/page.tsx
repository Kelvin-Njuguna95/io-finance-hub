'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Download, Search, X } from 'lucide-react';
import type { AuditLog } from '@/types/database';
import { getStatusBadgeClass } from '@/lib/status';

const ACTION_LABELS: Record<string, string> = {
  budget_submitted: 'Budget Submitted',
  budget_approved: 'Budget Approved',
  budget_rejected: 'Budget Rejected',
  budget_recalled: 'Budget Recalled',
  budget_returned_to_tl: 'Budget Returned to TL',
  budget_resubmitted: 'Budget Resubmitted',
  pm_review_submitted: 'PM Review Submitted',
  pm_budget_approved: 'PM Approved Budget',
  pm_budget_rejected: 'PM Rejected Budget',
  pm_budget_returned: 'PM Returned Budget',
  budget_item_approved: 'Line Item Approved',
  budget_item_adjusted: 'Line Item Adjusted',
  budget_item_removed: 'Line Item Removed',
  cfo_budget_reverted_to_tl: 'CFO Reverted Budget',
  cfo_budget_deleted: 'Budget Deleted by CFO',
  expenses_auto_generated: 'Expenses Auto-Generated',
  expense_confirmed: 'Expense Confirmed',
  expense_carry_forwarded: 'Expense Carry-Forwarded',
  expense_voided: 'Expense Voided',
  expense_batch_import: 'Expenses Batch Imported',
  historical_data_seed: 'Historical Data Seeded',
  withdrawal_logged: 'Withdrawal Logged',
  misc_report_submitted: 'Misc Report Submitted',
  misc_top_up_submitted: 'Misc Top-Up Raised',
  accountant_misc_raised: 'Misc Raised by Accountant',
  pm_approved_misc: 'Misc Approved by PM',
  pm_declined_misc: 'Misc Declined by PM',
  misc_request_deleted: 'Misc Request Deleted',
  misc_draw_expensed: 'Misc Draw Recorded',
  month_closed: 'Month Closed',
  month_reopened: 'Month Reopened',
  profit_share_approved: 'Profit Share Approved',
  cfo_override: 'CFO Override',
  backdated_invoice_entered: 'Backdated Invoice Added',
  payment_recorded: 'Payment Recorded',
  eod_report_sent: 'EOD Report Sent',
  user_created: 'User Created',
  setting_changed: 'Setting Changed',
  INSERT: 'Record Created',
  UPDATE: 'Record Updated',
  DELETE: 'Record Deleted',
};

const ROLE_LABELS: Record<string, string> = {
  cfo: 'CFO',
  accountant: 'Accountant',
  project_manager: 'PM',
  team_leader: 'TL',
  system: 'System',
};

const ENTITY_TYPE_OPTIONS = [
  'All', 'budgets', 'budget_items', 'budget_versions', 'expenses', 'invoices',
  'payments', 'withdrawals', 'misc_reports', 'misc_draws', 'month_closures',
  'profit_share_records', 'users', 'projects', 'system_settings',
  'eod_reports', 'pending_expenses', 'expense_variances', 'agent_counts',
];

interface AuditRow extends AuditLog {
  user_name: string;
  user_role: string;
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().split('T')[0];
}

function defaultTo(): string {
  return new Date().toISOString().split('T')[0];
}

function formatDateTimeInEAT(iso: string): string {
  const d = new Date(iso);
  const formattedDate = d.toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Africa/Nairobi',
  });
  const formattedTime = d.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Nairobi',
  });
  return `${formattedDate} ${formattedTime}`;
}

function getSummary(log: AuditLog): string {
  const nv = log.new_values;
  if (!nv) return '';
  if (nv.total_amount_kes && nv.status) return `KES ${Number(nv.total_amount_kes).toLocaleString()} → ${nv.status}`;
  if (nv.description && nv.amount_kes) return `${nv.description} KES ${Number(nv.amount_kes).toLocaleString()}`;
  if (nv.status) return `Status: ${nv.status}`;
  if (nv.comments) return String(nv.comments).slice(0, 100);
  const keys = Object.keys(nv);
  return keys.length > 0 ? `${keys.slice(0, 3).join(', ')} updated` : '';
}

function roleBadge(role: string): string {
  if (role === 'cfo') return 'bg-[#0f172a] text-white';
  if (role === 'project_manager') return 'bg-teal-100 text-teal-700';
  return getStatusBadgeClass(role, 'muted');
}

function actionBadge(action: string): string {
  if (action.includes('approved') || action === 'INSERT') return getStatusBadgeClass('approved');
  if (action.includes('rejected') || action.includes('voided') || action === 'DELETE') return getStatusBadgeClass('rejected');
  if (action.includes('submitted') || action.includes('recorded')) return getStatusBadgeClass('submitted');
  if (action.includes('returned') || action.includes('recalled') || action === 'UPDATE') return getStatusBadgeClass('under_review');
  return getStatusBadgeClass('draft');
}

export default function AuditLogPage() {
  const { user } = useUser();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<AuditRow | null>(null);

  const [dateFrom, setDateFrom] = useState(defaultFrom());
  const [dateTo, setDateTo] = useState(defaultTo());
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('All');
  const [roleFilter, setRoleFilter] = useState('All');

  // Security audit note: access is server-backed by RLS/auth on audit_logs and user metadata tables.
  const canViewAudit = canViewAuditPermission(user?.role);

  const fetchLogs = useCallback(async () => {
    if (!canViewAudit) {
      setLoading(false);
      setRows([]);
      return;
    }

    setLoading(true);
    const supabase = createClient();

    let query = supabase
      .from('audit_logs')
      .select('*')
      .gte('created_at', `${dateFrom}T00:00:00`)
      .lte('created_at', `${dateTo}T23:59:59`)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (entityFilter !== 'All') {
      query = query.eq('table_name', entityFilter);
    }

    const { data: logs } = await query;

    const userIds = Array.from(new Set((logs || []).map((l) => l.user_id).filter((id): id is string => Boolean(id))));
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name, role')
      .in('id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000']);

    const userMap = new Map<string, { name: string; role: string }>();
    (users || []).forEach((u) => {
      userMap.set(u.id, { name: u.full_name, role: u.role });
    });

    const mappedRows: AuditRow[] = (logs || []).map((log) => {
      const userInfo = log.user_id ? userMap.get(log.user_id) : undefined;
      return {
        ...log,
        user_name: userInfo?.name || (log.user_id ? 'Unknown User' : 'System'),
        user_role: userInfo?.role || 'system',
      };
    });

    const rowsForRole = user?.role === 'accountant'
      ? mappedRows.filter((row) => row.user_role !== 'cfo')
      : mappedRows;

    setRows(rowsForRole);
    setLoading(false);
  }, [canViewAudit, dateFrom, dateTo, entityFilter, user?.role]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const filteredRows = useMemo(() => {
    let result = rows;

    if (roleFilter !== 'All') {
      result = result.filter((r) => r.user_role === roleFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((r) =>
        r.user_name.toLowerCase().includes(q)
        || r.action.toLowerCase().includes(q)
        || r.table_name.toLowerCase().includes(q)
        || (r.reason || '').toLowerCase().includes(q)
        || getSummary(r).toLowerCase().includes(q)
      );
    }

    return result;
  }, [rows, roleFilter, search]);

  const metrics = useMemo(() => ({
    cfo: filteredRows.filter((r) => r.user_role === 'cfo').length,
    accountant: filteredRows.filter((r) => r.user_role === 'accountant').length,
    pmTl: filteredRows.filter((r) => r.user_role === 'project_manager' || r.user_role === 'team_leader').length,
    system: filteredRows.filter((r) => r.user_role === 'system' || !r.user_id).length,
  }), [filteredRows]);

  function clearFilters() {
    setSearch('');
    setEntityFilter('All');
    setRoleFilter('All');
    setDateFrom(defaultFrom());
    setDateTo(defaultTo());
  }

  function exportCsv() {
    const header = 'Timestamp (EAT),User,Role,Action,Entity Type,Entity ID,Summary,Reason\n';
    const body = filteredRows.map((row) => (
      [
        formatDateTimeInEAT(row.created_at),
        row.user_name,
        ROLE_LABELS[row.user_role] || row.user_role,
        ACTION_LABELS[row.action] || row.action,
        row.table_name,
        row.record_id || '',
        getSummary(row).replace(/,/g, ';'),
        (row.reason || '').replace(/,/g, ';'),
      ].join(',')
    )).join('\n');

    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IO_Audit_Log_${dateFrom}_to_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (user && !canViewAudit) {
    return (
      <div>
        <PageHeader title="Audit Log Viewer" description="Access restricted" />
        <div className="p-6">
          <p className="text-sm text-neutral-500">Only CFO and Accountant roles can view audit history.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Audit Log Viewer" description="Searchable, filterable trail of financial and operational changes">
        <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
          <Download className="h-3.5 w-3.5" /> Export Audit CSV
        </Button>
      </PageHeader>

      <div className="p-6 space-y-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500 shrink-0">From</label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[150px] h-8 text-sm" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500 shrink-0">To</label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[150px] h-8 text-sm" />
              </div>
              <div className="flex items-center gap-1 flex-1 min-w-[220px]">
                <Search className="h-3.5 w-3.5 text-slate-400" />
                <Input
                  placeholder="Search by user, action, entity, summary or reason..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3 items-center">
              <Select value={entityFilter} onValueChange={(v) => v && setEntityFilter(v)}>
                <SelectTrigger className="w-[190px] h-8 text-sm">
                  <SelectValue placeholder="Entity Type" />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPE_OPTIONS.map((entity) => (
                    <SelectItem key={entity} value={entity}>
                      {entity === 'All' ? 'All Entities' : entity.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={roleFilter} onValueChange={(v) => v && setRoleFilter(v)}>
                <SelectTrigger className="w-[170px] h-8 text-sm">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Roles</SelectItem>
                  <SelectItem value="cfo">CFO</SelectItem>
                  <SelectItem value="accountant">Accountant</SelectItem>
                  <SelectItem value="project_manager">Project Manager</SelectItem>
                  <SelectItem value="team_leader">Team Leader</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>

              <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={clearFilters}>
                <X className="h-3 w-3" /> Reset Filters
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-4 text-xs text-slate-500 px-1">
          <span>Showing <strong className="text-[#0f172a]">{filteredRows.length}</strong> records</span>
          <span>Range: {dateFrom} to {dateTo}</span>
          <span>{metrics.cfo} CFO</span>
          <span>{metrics.accountant} Accountant</span>
          <span>{metrics.pmTl} PM/TL</span>
          <span>{metrics.system} System</span>
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">Timestamp (EAT)</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, idx) => (
                    <TableRow key={`sk-${idx}`}>
                      <TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-neutral-500">No audit records found for the selected filters.</TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((row) => {
                    const summary = getSummary(row);
                    const actionLabel = ACTION_LABELS[row.action] || row.action.replace(/_/g, ' ');
                    return (
                      <TableRow key={row.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelectedLog(row)}>
                        <TableCell className="text-xs font-mono whitespace-nowrap">{formatDateTimeInEAT(row.created_at)}</TableCell>
                        <TableCell className="text-sm truncate max-w-[180px]" title={row.user_name}>{row.user_name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={roleBadge(row.user_role)}>{ROLE_LABELS[row.user_role] || row.user_role}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={actionBadge(row.action)}>{actionLabel}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className="truncate inline-block max-w-[180px] align-bottom" title={row.table_name}>{row.table_name.replace(/_/g, ' ')}</span>
                          {row.record_id && <span className="text-xs text-slate-400 ml-1">({row.record_id.slice(0, 8)})</span>}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500 max-w-[250px] truncate" title={summary}>{summary || '—'}</TableCell>
                        <TableCell className="text-xs text-slate-500 max-w-[220px] truncate" title={row.reason || ''}>{row.reason || '—'}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Sheet open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <SheetContent className="w-[520px] sm:max-w-[520px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">Audit Record Details</SheetTitle>
          </SheetHeader>

          {selectedLog && (
            <div className="mt-4 space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Performed by</span>
                  <span className="font-medium text-right">{selectedLog.user_name} ({ROLE_LABELS[selectedLog.user_role] || selectedLog.user_role})</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Action</span>
                  <Badge variant="secondary" className={actionBadge(selectedLog.action)}>
                    {ACTION_LABELS[selectedLog.action] || selectedLog.action}
                  </Badge>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Entity</span>
                  <span className="text-right">{selectedLog.table_name.replace(/_/g, ' ')}</span>
                </div>
                {selectedLog.record_id && (
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">Record ID</span>
                    <span className="font-mono text-xs text-right">{selectedLog.record_id}</span>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Timestamp</span>
                  <span className="text-right">{formatDateTimeInEAT(selectedLog.created_at)} EAT</span>
                </div>
                {selectedLog.reason && (
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">Reason</span>
                    <span className="text-right">{selectedLog.reason}</span>
                  </div>
                )}
              </div>

              <Separator />

              {selectedLog.old_values && Object.keys(selectedLog.old_values).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-1">Before</p>
                  <pre className="text-xs bg-rose-50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(selectedLog.old_values, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.new_values && Object.keys(selectedLog.new_values).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-1">After</p>
                  <pre className="text-xs bg-emerald-50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(selectedLog.new_values, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
