'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';
import {
  Settings as SettingsIcon, AlertTriangle, FileText, ClipboardList,
  Mail, Receipt, BarChart3, Bell, Users, Database, Lock,
} from 'lucide-react';
import type { SystemSetting } from '@/types/database';
import { canEditSettings, canViewSettings } from '@/lib/permissions';

// -----------------------------------------------
// Section definitions
// -----------------------------------------------
interface SettingDef {
  key: string;
  label: string;
  description: string;
  type: 'number' | 'toggle' | 'text' | 'readonly';
  unit?: string;
  defaultValue?: string;
  min?: number;
  max?: number;
  step?: string;
}

interface NotificationPreference {
  id: string;
  role: 'cfo' | 'accountant' | 'project_manager' | 'team_leader';
  notif_type: string;
  enabled: boolean;
}

interface ImportBatch {
  id: string;
  file_name: string | null;
  year_month: string | null;
  record_count: number | null;
  created_at: string;
  status: string | null;
}

interface SeedSnapshot {
  year_month: string;
  data_source: string | null;
  total_agents: number | null;
  created_at: string;
}

const SECTIONS: {
  id: string;
  title: string;
  icon: typeof SettingsIcon;
  settings: SettingDef[];
}[] = [
  {
    id: 'treasury',
    title: 'Treasury & Automation',
    icon: SettingsIcon,
    settings: [
      { key: 'standard_exchange_rate', label: 'Standard Exchange Rate (USD/KES)', description: 'Official treasury conversion rate used across reports and profitability calculations', type: 'number', unit: 'KES/USD', defaultValue: '129.5', min: 1, max: 500, step: '0.0001' },
      { key: 'bank_balance_usd', label: 'Standing Bank Balance (USD)', description: 'Authoritative USD treasury balance used for liquidity and cash flow visibility', type: 'number', unit: 'USD', defaultValue: '0', min: 0, step: '0.01' },
      { key: 'eod_auto_send_enabled', label: 'EOD Auto-Send Enabled', description: 'Enable scheduled EOD automation without requiring manual intervention', type: 'toggle', defaultValue: 'true' },
      { key: 'eod_auto_send_on_expense', label: 'Trigger on Expense Activity', description: 'Auto-send EOD if at least one expense was logged today', type: 'toggle', defaultValue: 'true' },
      { key: 'eod_auto_send_on_withdrawal', label: 'Trigger on Withdrawal Activity', description: 'Auto-send EOD if at least one withdrawal was logged today', type: 'toggle', defaultValue: 'true' },
      { key: 'eod_auto_send_on_cash_received', label: 'Trigger on Cash Received Activity', description: 'Auto-send EOD if at least one customer payment (cash received) was logged today', type: 'toggle', defaultValue: 'true' },
    ],
  },
  {
    id: 'thresholds',
    title: 'Thresholds & Alerts',
    icon: AlertTriangle,
    settings: [
      { key: 'overdue_invoice_days', label: 'Overdue Invoice Threshold', description: 'Days after invoice date before flagging as overdue', type: 'number', unit: 'days', defaultValue: '30' },
      { key: 'expense_spike_threshold_percent', label: 'Expense Spike Threshold', description: 'Percentage increase that triggers a spike alert', type: 'number', unit: '%', defaultValue: '30' },
      { key: 'budget_warning_threshold_percent', label: 'Budget Warning Threshold', description: 'Budget utilization percentage that triggers a warning', type: 'number', unit: '%', defaultValue: '90' },
    ],
  },
  {
    id: 'budget',
    title: 'Budget Controls',
    icon: FileText,
    settings: [
      { key: 'financial_closure_day', label: 'Financial Closure Day', description: 'Recommended business day for monthly finance close (1-31)', type: 'number', unit: 'day', defaultValue: '5', min: 1, max: 31 },
      { key: 'finance_alert_email', label: 'Finance Alert Contact', description: 'Primary escalation email for high-risk finance alerts', type: 'text', defaultValue: 'cfo@company.com' },
    ],
  },
  {
    id: 'misc',
    title: 'Misc & Draws',
    icon: ClipboardList,
    settings: [
      { key: 'misc_pm_review_warning_days', label: 'PM Review Warning Days', description: 'Days before stuck budget triggers a flag', type: 'number', unit: 'days', defaultValue: '2' },
      { key: 'misc_underspend_alert_threshold_pct', label: 'Underspend Alert Threshold', description: 'Misc underspend percentage before LOW flag fires', type: 'number', unit: '%', defaultValue: '50' },
      { key: 'misc_request_approval_warning_days', label: 'Request Approval Warning Days', description: 'Days before pending accountant misc request flags', type: 'number', unit: 'days', defaultValue: '1' },
      { key: 'misc_report_overdue_warning_days', label: 'Report Overdue Warning Days', description: 'Days post-month-end before missing report triggers flag', type: 'number', unit: 'days', defaultValue: '3' },
      { key: 'misc_gate_start_month', label: 'Gate Start Month', description: 'First month misc gate applies (YYYY-MM)', type: 'text', defaultValue: '2026-04' },
      { key: 'misc_topup_monthly_limit_count', label: 'Top-Up Monthly Limit (count)', description: 'Maximum top-up requests per project per month', type: 'number', defaultValue: '3' },
      { key: 'misc_topup_monthly_limit_kes', label: 'Top-Up Monthly Limit (KES)', description: 'Maximum top-up KES per project per month', type: 'number', unit: 'KES', defaultValue: '50000' },
      { key: 'misc_min_itemisation_pct', label: 'Min Itemisation Required', description: 'Min percentage of drawn misc that must be itemised', type: 'number', unit: '%', defaultValue: '80' },
      { key: 'misc_report_underspend_alert_pct', label: 'Report Underspend Alert', description: 'Report underspend that flags low report', type: 'number', unit: '%', defaultValue: '30' },
      { key: 'misc_draw_expense_recording_days', label: 'Draw Expense Recording Days', description: 'Days before unrecorded draw triggers alert', type: 'number', unit: 'days', defaultValue: '2' },
      { key: 'misc_pm_approval_warning_days', label: 'PM Approval Warning Days', description: 'Days before pending PM approval flags', type: 'number', unit: 'days', defaultValue: '2' },
      { key: 'misc_report_due_day', label: 'Report Due Day of Month', description: '0 = last day of month', type: 'number', unit: 'day', defaultValue: '0' },
    ],
  },
  {
    id: 'eod',
    title: 'EOD Report',
    icon: Mail,
    settings: [
      { key: 'eod_auto_send_enabled', label: 'EOD Auto-Send Enabled', description: 'Enable/disable scheduled auto-send of EOD reports', type: 'toggle', defaultValue: 'true' },
      { key: 'eod_auto_send_time', label: 'EOD Auto-Send Time', description: 'Time to auto-send (displays in EAT)', type: 'text', defaultValue: '18:00' },
      { key: 'eod_timezone', label: 'EOD Timezone', description: 'Display timezone for EOD reports', type: 'readonly', defaultValue: 'Africa/Nairobi' },
      { key: 'eod_slack_channel', label: 'Connected Slack Channel', description: 'Slack channel for EOD reports', type: 'readonly', defaultValue: '#io-finance' },
    ],
  },
  {
    id: 'invoicing',
    title: 'Invoicing & Receivables',
    icon: Receipt,
    settings: [
      { key: 'outstanding_balance_alert_kes', label: 'Outstanding Balance Alert Threshold', description: 'Total outstanding above which HIGH flag fires', type: 'number', unit: 'KES', defaultValue: '5000000' },
      { key: 'backdated_invoice_cutoff', label: 'Backdated Invoice Cutoff Date', description: 'Earliest allowed date for backdated invoice entry', type: 'text', defaultValue: '2026-01-01' },
    ],
  },
  {
    id: 'variance',
    title: 'Variance & Expenses',
    icon: BarChart3,
    settings: [
      { key: 'overspend_flag_threshold_pct', label: 'Overspend Flag Threshold', description: 'Single line item overspend percentage before HIGH flag fires', type: 'number', unit: '%', defaultValue: '20' },
      { key: 'max_carry_forward_items', label: 'Max Carry-Forward Items', description: 'Items in carry-forward queue before MEDIUM flag fires', type: 'number', defaultValue: '5' },
      { key: 'budget_accuracy_benchmark_pct', label: 'Budget Accuracy Benchmark', description: 'Company accuracy below this triggers HIGH flag', type: 'number', unit: '%', defaultValue: '85' },
      { key: 'void_alert_threshold_kes', label: 'Void Alert Threshold', description: 'Void amount above which LOW flag fires', type: 'number', unit: 'KES', defaultValue: '50000' },
      { key: 'auto_carry_forward_on_close', label: 'Auto Carry-Forward at Month End', description: 'Unactioned expenses auto-defer to next month on closure', type: 'toggle', defaultValue: 'true' },
    ],
  },
];

// -----------------------------------------------
// Component
// -----------------------------------------------
export default function SettingsPage() {
  const { user } = useUser();
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [activeSection, setActiveSection] = useState('thresholds');
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreference[]>([]);
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);
  const [seedSnapshots, setSeedSnapshots] = useState<SeedSnapshot[]>([]);
  const [removingSeed, setRemovingSeed] = useState(false);
  const canEdit = canEditSettings(user?.role);
  const canView = canViewSettings(user?.role);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from('system_settings').select('*').order('key');
      setSettings(data || []);
      const v: Record<string, string> = {};
      (data || []).forEach((s: SystemSetting) => { v[s.key] = s.value; });
      setValues(v);

      // Load notification preferences
      const { data: prefs } = await supabase.from('notification_preferences').select('*').order('role,notif_type');
      setNotifPrefs(prefs || []);

      // Load import batches for Data section
      const { data: batches } = await supabase.from('expense_import_batches').select('*').order('created_at', { ascending: false }).limit(20);
      setImportBatches(batches || []);

      // Load seed snapshots
      const { data: snaps } = await supabase.from('monthly_financial_snapshots').select('year_month, data_source, total_agents, created_at').not('data_source', 'is', null).order('year_month');
      const typedSnapshots = (snaps || []) as SeedSnapshot[];
      setSeedSnapshots(typedSnapshots.filter((s) => s.data_source?.startsWith('historical_seed')));
    }
    load();
  }, []);

  function setValue(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
    setDirty(true);
  }

  async function handleSave() {
    if (!canEdit) return;
    const supabase = createClient();
    const allKeys = SECTIONS.flatMap((s) => s.settings.map((d) => d.key));
    const allDefs = SECTIONS.flatMap((s) => s.settings);

    for (const def of allDefs) {
      if (def.type !== 'number') continue;
      const raw = values[def.key];
      if (raw === undefined || raw === '') continue;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        toast.error(`${def.label} must be a valid number`);
        return;
      }
      if (def.min !== undefined && parsed < def.min) {
        toast.error(`${def.label} must be at least ${def.min}`);
        return;
      }
      if (def.max !== undefined && parsed > def.max) {
        toast.error(`${def.label} must be at most ${def.max}`);
        return;
      }
    }

    for (const key of allKeys) {
      if (values[key] === undefined) continue;
      const existing = settings.find((s) => s.key === key);
      if (existing) {
        if (values[key] !== existing.value) {
          const { error } = await supabase.from('system_settings').update({
            value: values[key],
            updated_by: user?.id,
            updated_at: new Date().toISOString(),
          }).eq('id', existing.id);
          if (error) {
            toast.error(`Failed saving ${key}: ${error.message}`);
            return;
          }
        }
      } else {
        // Insert new setting
        const def = allDefs.find((d) => d.key === key);
        const { error } = await supabase.from('system_settings').insert({
          key,
          value: values[key] || def?.defaultValue || '',
          description: def?.description || '',
          updated_by: user?.id,
        });
        if (error) {
          toast.error(`Failed creating ${key}: ${error.message}`);
          return;
        }
      }
    }

    toast.success('Settings saved');
    setDirty(false);

    // Reload
    const { data } = await supabase.from('system_settings').select('*').order('key');
    setSettings(data || []);
  }

  async function toggleNotifPref(id: string, enabled: boolean) {
    if (!canEdit) return;
    const supabase = createClient();
    await supabase.from('notification_preferences').update({
      enabled,
      updated_by: user?.id,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    setNotifPrefs((prev) => prev.map((p) => p.id === id ? { ...p, enabled } : p));
    toast.success('Preference updated');
  }

  async function handleRemoveHistoricalSeed() {
    if (!canEdit) return;
    setRemovingSeed(true);
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        toast.error('Unable to verify your session. Please sign in again.');
        return;
      }

      const res = await fetch('/api/historical-seed', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = await res.json();
      if (!res.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : 'Failed to remove historical seed data';
        toast.error(message);
        return;
      }

      toast.success(payload?.message || 'Historical seed data removed');

      const { data: snaps } = await supabase
        .from('monthly_financial_snapshots')
        .select('year_month, data_source, total_agents, created_at')
        .not('data_source', 'is', null)
        .order('year_month');
      const typedSnapshots = (snaps || []) as SeedSnapshot[];
      setSeedSnapshots(typedSnapshots.filter((s) => s.data_source?.startsWith('historical_seed')));
    } catch {
      toast.error('Unexpected error while removing seed data');
    } finally {
      setRemovingSeed(false);
    }
  }

  const currentSection = SECTIONS.find((s) => s.id === activeSection);

  if (user && !canView) {
    return (
      <div>
        <PageHeader title="Settings" description="Settings are available to CFO and Accountant" />
        <div className="p-6">
          <p className="text-sm text-muted-foreground">You do not have permission to view settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Settings" description="Configure system thresholds, parameters, and preferences" />

      <div className="flex min-h-[calc(100vh-65px)]">
        {/* Left sidebar nav */}
        <div className="w-56 border-r border-border bg-card p-4 space-y-1 shrink-0">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={cn(
                'flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm transition-colors text-left',
                activeSection === s.id
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground/90 hover:bg-muted/50',
              )}
            >
              <s.icon className="h-4 w-4 shrink-0" />
              {s.title}
            </button>
          ))}
          <Separator className="my-2" />
          <button
            onClick={() => setActiveSection('notifications')}
            className={cn(
              'flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm transition-colors text-left',
              activeSection === 'notifications'
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground/90 hover:bg-muted/50',
            )}
          >
            <Bell className="h-4 w-4 shrink-0" />
            Notifications
          </button>
          {canEdit && <button
            onClick={() => setActiveSection('users')}
            className={cn(
              'flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm transition-colors text-left',
              activeSection === 'users'
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground/90 hover:bg-muted/50',
            )}
          >
            <Users className="h-4 w-4 shrink-0" />
            User Management
          </button>}
          {canEdit && <button
            onClick={() => setActiveSection('data')}
            className={cn(
              'flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm transition-colors text-left',
              activeSection === 'data'
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground/90 hover:bg-muted/50',
            )}
          >
            <Database className="h-4 w-4 shrink-0" />
            Data & Import
          </button>}
        </div>

        {/* Right content */}
        <div className="flex-1 p-6 max-w-2xl">
          {/* Regular settings sections */}
          {currentSection && (
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-1">{currentSection.title}</h2>
              <p className="text-sm text-muted-foreground mb-6">Configure {currentSection.title.toLowerCase()} parameters</p>

              <div className="space-y-5">
                {currentSection.settings.map((def) => {
                  const val = values[def.key] ?? def.defaultValue ?? '';
                  return (
                    <div key={def.key} className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={def.key} className="text-sm font-medium">{def.label}</Label>
                        {def.type === 'readonly' && <Lock className="h-3 w-3 text-muted-foreground" />}
                      </div>
                      <p className="text-xs text-muted-foreground">{def.description}</p>

                      {def.type === 'toggle' ? (
                        <Switch
                          id={def.key}
                          checked={val === 'true'}
                          onCheckedChange={(checked) => setValue(def.key, checked ? 'true' : 'false')}
                          disabled={!canEdit}
                        />
                      ) : def.type === 'readonly' ? (
                        <div className="flex items-center gap-2">
                          <Input
                            id={def.key}
                            value={val}
                            disabled
                            className="bg-muted/50 text-muted-foreground max-w-xs"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Input
                            id={def.key}
                            type={def.type === 'number' ? 'number' : 'text'}
                            value={val}
                            onChange={(e) => setValue(def.key, e.target.value)}
                            disabled={!canEdit}
                            className="max-w-xs"
                            min={def.type === 'number' ? def.min : undefined}
                            max={def.type === 'number' ? def.max : undefined}
                            step={def.type === 'number' ? (def.step || 'any') : undefined}
                          />
                          {def.unit && (
                            <span className="text-xs text-muted-foreground">{def.unit}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {activeSection === 'eod' && (
                <div className="mt-6 p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <p className="text-xs text-amber-700">
                    To update the Slack webhook URL, update the <code className="font-mono bg-amber-100 px-1 rounded">EOD_SLACK_WEBHOOK_URL</code> secret in your Vercel project settings.
                  </p>
                </div>
              )}

              <div className="mt-8 flex items-center gap-3">
                <Button onClick={handleSave} disabled={!canEdit}>Save Changes</Button>
                {dirty && (
                  <span className="text-xs text-amber-600">Unsaved changes</span>
                )}
              </div>
            </div>
          )}

          {/* Notifications preferences section */}
          {activeSection === 'notifications' && (
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Notification Preferences</h2>
              <p className="text-sm text-muted-foreground mb-6">Configure which notification types each role receives</p>

              {notifPrefs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No notification preferences configured. Apply migration 00010 to seed defaults.</p>
              ) : (
                <Card className="io-card">
                  <CardContent className="p-0 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Notification Type</TableHead>
                          <TableHead className="text-center">CFO</TableHead>
                          <TableHead className="text-center">Accountant</TableHead>
                          <TableHead className="text-center">PM</TableHead>
                          <TableHead className="text-center">TL</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(() => {
                          const types = [...new Set(notifPrefs.map((p) => p.notif_type))];
                          return types.map((t) => (
                            <TableRow key={t}>
                              <TableCell className="text-sm capitalize">{t.replace(/_/g, ' ')}</TableCell>
                              {['cfo', 'accountant', 'project_manager', 'team_leader'].map((role) => {
                                const pref = notifPrefs.find((p) => p.role === role && p.notif_type === t);
                                return (
                                  <TableCell key={role} className="text-center">
                                    {pref ? (
                                      <Switch
                                        checked={pref.enabled}
                                        onCheckedChange={(checked) => toggleNotifPref(pref.id, checked)}
                                        disabled={!canEdit}
                                      />
                                    ) : (
                                      <span className="text-muted-foreground/60">&mdash;</span>
                                    )}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          ));
                        })()}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* User management section */}
          {canEdit && activeSection === 'users' && (
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-1">User Management</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Manage users and project assignments from the <a href="/users" className="text-blue-600 hover:underline">Users page</a>.
              </p>
              <Button variant="outline" onClick={() => window.location.href = '/users'}>
                Go to User Management
              </Button>
            </div>
          )}

          {/* Data & Import section */}
          {canEdit && activeSection === 'data' && (
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-1">Data & Import</h2>
              <p className="text-sm text-muted-foreground mb-6">Historical data and import activity</p>

              {/* Seeded data */}
              <h3 className="text-sm font-semibold text-foreground/90 mb-2">Seeded Historical Data</h3>
              {seedSnapshots.length === 0 ? (
                <p className="text-sm text-muted-foreground mb-6">No historical seeds found.</p>
              ) : (
                <Card className="io-card mb-6">
                  <CardContent className="p-0 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Source</TableHead>
                          <TableHead>Month</TableHead>
                          <TableHead>Agents</TableHead>
                          <TableHead>Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {seedSnapshots.map((s) => (
                          <TableRow key={s.year_month}>
                            <TableCell className="text-sm">{s.data_source}</TableCell>
                            <TableCell className="text-sm font-mono">{s.year_month}</TableCell>
                            <TableCell className="text-sm">{s.total_agents}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{formatDate(s.created_at)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
              {seedSnapshots.length > 0 && (
                <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-medium text-amber-900">Historical Seed Cleanup</p>
                  <p className="mt-1 text-xs text-amber-800">
                    Use this action only when you need to permanently remove previously-seeded historical records.
                  </p>
                  <Button
                    variant="destructive"
                    className="mt-3"
                    disabled={removingSeed}
                    onClick={handleRemoveHistoricalSeed}
                  >
                    {removingSeed ? 'Removing Historical Seed Data...' : 'Remove Historical Seed Data'}
                  </Button>
                </div>
              )}

              {/* Import history */}
              <h3 className="text-sm font-semibold text-foreground/90 mb-2">Import History</h3>
              {importBatches.length === 0 ? (
                <p className="text-sm text-muted-foreground mb-6">No imports recorded.</p>
              ) : (
                <Card className="io-card mb-6">
                  <CardContent className="p-0 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>File</TableHead>
                          <TableHead>Period</TableHead>
                          <TableHead>Records</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importBatches.map((b) => (
                          <TableRow key={b.id}>
                            <TableCell className="text-sm">{b.file_name || 'Unnamed'}</TableCell>
                            <TableCell className="text-sm font-mono">{b.year_month || '-'}</TableCell>
                            <TableCell className="text-sm">{b.record_count || 0}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{formatDate(b.created_at)}</TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
                                {b.status || 'complete'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
