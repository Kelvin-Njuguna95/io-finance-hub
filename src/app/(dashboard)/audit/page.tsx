'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Download, Search, X } from 'lucide-react';
import type { AuditLog } from '@/types/database';

// -----------------------------------------------
// Action label + colour map
// -----------------------------------------------
const ACTION_MAP: Record<string, { label: string; color: string }> = {
  budget_submitted: { label: 'Budget Submitted', color: 'bg-blue-100 text-blue-700' },
  budget_approved: { label: 'Budget Approved', color: 'bg-emerald-100 text-emerald-700' },
  budget_rejected: { label: 'Budget Rejected', color: 'bg-rose-100 text-rose-700' },
  budget_recalled: { label: 'Budget Recalled', color: 'bg-amber-100 text-amber-700' },
  budget_returned_to_tl: { label: 'Budget Returned to TL', color: 'bg-amber-100 text-amber-700' },
  budget_resubmitted: { label: 'Budget Resubmitted', color: 'bg-blue-100 text-blue-700' },
  pm_review_submitted: { label: 'PM Review Submitted', color: 'bg-teal-100 text-teal-700' },
  pm_budget_approved: { label: 'PM Approved Budget', color: 'bg-emerald-100 text-emerald-700' },
  pm_budget_rejected: { label: 'PM Rejected Budget', color: 'bg-rose-100 text-rose-700' },
  pm_budget_returned: { label: 'PM Returned Budget', color: 'bg-amber-100 text-amber-700' },
  budget_item_approved: { label: 'Line Item Approved', color: 'bg-emerald-100 text-emerald-700' },
  budget_item_adjusted: { label: 'Line Item Adjusted', color: 'bg-amber-100 text-amber-700' },
  budget_item_removed: { label: 'Line Item Removed', color: 'bg-rose-100 text-rose-700' },
  cfo_budget_reverted_to_tl: { label: 'CFO Reverted Budget', color: 'bg-orange-100 text-orange-700' },
  cfo_budget_deleted: { label: 'Budget Deleted by CFO', color: 'bg-rose-200 text-rose-800' },
  expenses_auto_generated: { label: 'Expenses Auto-Generated', color: 'bg-blue-100 text-blue-700' },
  expense_confirmed: { label: 'Expense Confirmed', color: 'bg-emerald-100 text-emerald-700' },
  expense_carry_forwarded: { label: 'Expense Carry-Forwarded', color: 'bg-blue-100 text-blue-700' },
  expense_voided: { label: 'Expense Voided', color: 'bg-rose-100 text-rose-700' },
  expense_batch_import: { label: 'Expenses Batch Imported', color: 'bg-teal-100 text-teal-700' },
  historical_data_seed: { label: 'Historical Data Seeded', color: 'bg-slate-100 text-slate-600' },
  withdrawal_logged: { label: 'Withdrawal Logged', color: 'bg-blue-100 text-blue-700' },
  misc_report_submitted: { label: 'Misc Report Submitted', color: 'bg-emerald-100 text-emerald-700' },
  misc_top_up_submitted: { label: 'Misc Top-Up Raised', color: 'bg-blue-100 text-blue-700' },
  accountant_misc_raised: { label: 'Misc Raised by Accountant', color: 'bg-blue-100 text-blue-700' },
  pm_approved_misc: { label: 'Misc Approved by PM', color: 'bg-emerald-100 text-emerald-700' },
  pm_declined_misc: { label: 'Misc Declined by PM', color: 'bg-rose-100 text-rose-700' },
  misc_request_deleted: { label: 'Misc Request Deleted', color: 'bg-rose-100 text-rose-700' },
  misc_draw_expensed: { label: 'Misc Draw Recorded', color: 'bg-emerald-100 text-emerald-700' },
  month_closed: { label: 'Month Closed', color: 'bg-[#0f172a] text-white' },
  month_reopened: { label: 'Month Reopened', color: 'bg-orange-100 text-orange-700' },
  profit_share_approved: { label: 'Profit Share Approved', color: 'bg-emerald-100 text-emerald-700' },
  cfo_override: { label: 'CFO Override', color: 'bg-orange-200 text-orange-800 font-semibold' },
  backdated_invoice_entered: { label: 'Backdated Invoice Added', color: 'bg-amber-100 text-amber-700' },
  payment_recorded: { label: 'Payment Recorded', color: 'bg-emerald-100 text-emerald-700' },
  eod_report_sent: { label: 'EOD Report Sent', color: 'bg-blue-100 text-blue-700' },
  user_created: { label: 'User Created', color: 'bg-slate-100 text-slate-600' },
  setting_changed: { label: 'Setting Changed', color: 'bg-amber-100 text-amber-700' },
  // Trigger-generated actions
  INSERT: { label: 'Record Created', color: 'bg-blue-100 text-blue-700' },
  UPDATE: { label: 'Record Updated', color: 'bg-amber-100 text-amber-700' },
  DELETE: { label: 'Record Deleted', color: 'bg-rose-100 text-rose-700' },
};

const ROLE_COLORS: Record<string, string> = {
  cfo: 'bg-[#0f172a] text-white',
  accountant: 'bg-blue-100 text-blue-700',
  project_manager: 'bg-teal-100 text-teal-700',
  team_leader: 'bg-amber-100 text-amber-700',
  system: 'bg-slate-100 text-slate-600',
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

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }) + ' ' + d.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'Africa/Nairobi',
  });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

function getDetailSummary(log: AuditLog): string {
  const nv = log.new_values;
  if (!nv) return '';
  if (nv.total_amount_kes && nv.status) return `KES ${Number(nv.total_amount_kes).toLocaleString()} \u2192 ${nv.status}`;
  if (nv.description && nv.amount_kes) return `${nv.description} KES ${Number(nv.amount_kes).toLocaleString()}`;
  if (nv.status) return `Status: ${nv.status}`;
  if (nv.comments) return String(nv.comments).slice(0, 80);
  const keys = Object.keys(nv);
  if (keys.length > 0) return keys.slice(0, 3).join(', ') + ' updated';
  return '';
}

function getSource(log: AuditLog): string {
  const action = log.action?.toLowerCase() || '';
  if (action.includes('seed') || action.includes('import')) return 'Import';
  if (!log.user_id) return 'System';
  return 'Web App';
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().split('T')[0];
}

function defaultTo(): string {
  return new Date().toISOString().split('T')[0];
}

interface AuditRow extends AuditLog {
  user_name: string;
  user_role: string;
}

export default function AuditLogPage() {
  const { user } = useUser();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<AuditRow | null>(null);

  // Filters
  const [dateFrom, setDateFrom] = useState(defaultFrom());
  const [dateTo, setDateTo] = useState(defaultTo());
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('All');
  const [roleFilter, setRoleFilter] = useState('All');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    let query = supabase
      .from('audit_logs')
      .select('*')
      .gte('created_at', dateFrom + 'T00:00:00')
      .lte('created_at', dateTo + 'T23:59:59')
      .order('created_at', { ascending: false })
      .limit(500);

    if (entityFilter !== 'All') {
      query = query.eq('table_name', entityFilter);
    }

    const { data: logs } = await query;

    // Fetch user names
    const userIds = [...new Set((logs || []).map((l: AuditLog) => l.user_id).filter(Boolean))];
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name, role')
      .in('id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000']);

    const userMap = new Map<string, { name: string; role: string }>();
    (users || []).forEach((u: any) => {
      userMap.set(u.id, { name: u.full_name, role: u.role });
    });

    let result: AuditRow[] = (logs || []).map((l: AuditLog) => {
      const info = l.user_id ? userMap.get(l.user_id) : null;
      return {
        ...l,
        user_name: info?.name || (l.user_id ? 'Unknown' : 'System'),
        user_role: info?.role || 'system',
      };
    });

    // Client-side filters
    if (roleFilter !== 'All') {
      result = result.filter((r) => r.user_role === roleFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((r) =>
        r.user_name.toLowerCase().includes(q) ||
        r.action.toLowerCase().includes(q) ||
        r.table_name.toLowerCase().includes(q) ||
        (r.reason || '').toLowerCase().includes(q) ||
        getDetailSummary(r).toLowerCase().includes(q)
      );
    }

    setRows(result);
    setLoading(false);
  }, [dateFrom, dateTo, entityFilter, roleFilter, search]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Summary counts
  const cfoCount = rows.filter((r) => r.user_role === 'cfo').length;
  const accCount = rows.filter((r) => r.user_role === 'accountant').length;
  const pmTlCount = rows.filter((r) => r.user_role === 'project_manager' || r.user_role === 'team_leader').length;
  const sysCount = rows.filter((r) => r.user_role === 'system' || !r.user_id).length;

  function exportCsv() {
    const header = 'Timestamp,User,Role,Action,Entity Type,Entity ID,Detail,Reason,Source\n';
    const csv = rows.map((r) =>
      [
        formatDateTime(r.created_at),
        r.user_name,
        ROLE_LABELS[r.user_role] || r.user_role,
        ACTION_MAP[r.action]?.label || r.action,
        r.table_name,
        r.record_id || '',
        getDetailSummary(r).replace(/,/g, ';'),
        (r.reason || '').replace(/,/g, ';'),
        getSource(r),
      ].join(','),
    ).join('\n');

    const blob = new Blob([header + csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IO_AuditLog_${dateFrom}_to_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Access check: CFO or Accountant
  if (user && user.role !== 'cfo' && user.role !== 'accountant') {
    return (
      <div>
        <PageHeader title="Audit Log" description="Access restricted" />
        <div className="p-6">
          <p className="text-sm text-neutral-500">You do not have permission to view the audit log.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Audit Log" description="Complete record of all financial actions, edits, overrides, and system events">
        <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </PageHeader>

      <div className="p-6 space-y-4">
        {/* Filter bar */}
        <Card className="io-card">
          <CardContent className="p-4 space-y-3">
            {/* Row 1 */}
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500 shrink-0">From</label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-[150px] h-8 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500 shrink-0">To</label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-[150px] h-8 text-sm"
                />
              </div>
              <div className="flex items-center gap-1 flex-1 min-w-[200px]">
                <Search className="h-3.5 w-3.5 text-slate-400" />
                <Input
                  placeholder="Search actions, users, entities..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            {/* Row 2 */}
            <div className="flex flex-wrap gap-3 items-center">
              <Select value={entityFilter} onValueChange={(v) => v && setEntityFilter(v)}>
                <SelectTrigger className="w-[180px] h-8 text-sm">
                  <SelectValue placeholder="Entity Type" />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPE_OPTIONS.map((e) => (
                    <SelectItem key={e} value={e}>{e === 'All' ? 'All Entities' : e.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={roleFilter} onValueChange={(v) => v && setRoleFilter(v)}>
                <SelectTrigger className="w-[160px] h-8 text-sm">
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

              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={() => {
                  setSearch('');
                  setEntityFilter('All');
                  setRoleFilter('All');
                  setDateFrom(defaultFrom());
                  setDateTo(defaultTo());
                }}
              >
                <X className="h-3 w-3" /> Clear Filters
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary bar */}
        <div className="flex flex-wrap gap-4 text-xs text-slate-500 px-1">
          <span>Showing <strong className="text-[#0f172a]">{rows.length}</strong> records</span>
          <span>|</span>
          <span>Date: {dateFrom} to {dateTo}</span>
          <span>|</span>
          <span>{cfoCount} CFO</span>
          <span>{accCount} Accountant</span>
          <span>{pmTlCount} PM/TL</span>
          <span>{sysCount} System</span>
        </div>

        {/* Audit log table */}
        <Card className="io-card">
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="w-[80px]">Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-neutral-400">Loading...</TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-neutral-500">No audit records found</TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => {
                    const actionInfo = ACTION_MAP[r.action] || { label: r.action.replace(/_/g, ' '), color: 'bg-slate-100 text-slate-600' };
                    const detail = getDetailSummary(r);
                    return (
                      <TableRow key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelectedLog(r)}>
                        <TableCell className="text-xs font-mono whitespace-nowrap" title={relativeTime(r.created_at)}>
                          {formatDateTime(r.created_at)}
                        </TableCell>
                        <TableCell className="text-sm">{r.user_name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={ROLE_COLORS[r.user_role] || 'bg-slate-100 text-slate-600'}>
                            {ROLE_LABELS[r.user_role] || r.user_role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={actionInfo.color}>
                            {actionInfo.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.table_name.replace(/_/g, ' ')}
                          {r.record_id && (
                            <span className="text-xs text-slate-400 ml-1">({r.record_id.slice(0, 8)})</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500 max-w-[200px] truncate" title={detail}>
                          {detail || '\u2014'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500 max-w-[160px] truncate" title={r.reason || ''}>
                          {r.reason ? r.reason.slice(0, 80) : '\u2014'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-400">{getSource(r)}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Detail drawer */}
      <Sheet open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">
              Audit Record &mdash; {selectedLog && (ACTION_MAP[selectedLog.action]?.label || selectedLog.action)}
            </SheetTitle>
          </SheetHeader>

          {selectedLog && (
            <div className="mt-4 space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Performed by</span>
                  <span className="font-medium">{selectedLog.user_name} ({ROLE_LABELS[selectedLog.user_role] || selectedLog.user_role})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Action</span>
                  <Badge variant="secondary" className={ACTION_MAP[selectedLog.action]?.color || 'bg-slate-100'}>
                    {ACTION_MAP[selectedLog.action]?.label || selectedLog.action}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Entity</span>
                  <span>{selectedLog.table_name.replace(/_/g, ' ')}</span>
                </div>
                {selectedLog.record_id && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Record ID</span>
                    <span className="font-mono text-xs">{selectedLog.record_id}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Timestamp</span>
                  <span>{formatDateTime(selectedLog.created_at)} EAT</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Source</span>
                  <span>{getSource(selectedLog)}</span>
                </div>
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

              {selectedLog.reason && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs font-semibold text-slate-500 mb-1">Reason</p>
                    <p className="text-sm">{selectedLog.reason}</p>
                  </div>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
