'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { getCurrentYearMonth, formatCurrency, capitalize } from '@/lib/format';
import { formatKES } from '@/lib/utils/currency';
import { DIRECTORS } from '@/types/database';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { User, DirectorEnum, PayoutType, WithdrawalType } from '@/types/database';
import { getUserErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface ProfitShareOption {
  id: string;
  period_month: string;
  distributable_amount: number;
  total_paid_out: number;
  balance_remaining: number;
  payout_status: 'unpaid' | 'partial' | 'paid';
}

interface ProfitSharePeriodOption {
  monthKey: string;
  label: string;
  record: ProfitShareOption | null;
}

const DIRECTOR_NAMES = ['Kelvin', 'Evans', 'Dan', 'Gidraph', 'Victor'] as const;
const PROFIT_SHARE_START_MONTH = '2025-09';

function getNairobiDateISO() {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return formatted;
}

function formatProfitShareMonth(periodMonth: string) {
  const [year, month] = periodMonth.split('-').map(Number);
  if (!year || !month) return periodMonth;
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function getProfitSharePeriodOptions(records: ProfitShareOption[]): ProfitSharePeriodOption[] {
  const [startYear, startMonth] = PROFIT_SHARE_START_MONTH.split('-').map(Number);
  const start = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const now = new Date();
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const byMonth = new Map(records.map((record) => [record.period_month, record]));
  const options: ProfitSharePeriodOption[] = [];
  const cursor = new Date(start);

  while (cursor <= current) {
    const monthKey = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
    options.push({
      monthKey,
      label: formatProfitShareMonth(monthKey),
      record: byMonth.get(monthKey) || null,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return options.reverse();
}

export function WithdrawalFormDialog({ open, onClose, onSaved }: Props) {
  const { user } = useUser();
  const [withdrawalType, setWithdrawalType] = useState<WithdrawalType | null>(null);

  const [directorUsers, setDirectorUsers] = useState<User[]>([]);
  const [forexBureaus, setForexBureaus] = useState<{ id: string; name: string }[]>([]);

  const [projects, setProjects] = useState<{ id: string; name: string; director_tag: string }[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');

  const [directorTag, setDirectorTag] = useState<DirectorEnum | ''>('');
  const [withdrawalDate, setWithdrawalDate] = useState(getNairobiDateISO());
  const [amountUsd, setAmountUsd] = useState(0);
  const [exchangeRate, setExchangeRate] = useState(0);
  const [amountKes, setAmountKes] = useState(0);
  const [forexBureau, setForexBureau] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [referenceRate, setReferenceRate] = useState(0);
  const [notes, setNotes] = useState('');
  const [showAddForex, setShowAddForex] = useState(false);
  const [newForexName, setNewForexName] = useState('');

  const [payoutDirector, setPayoutDirector] = useState('');
  const [payoutRecordId, setPayoutRecordId] = useState('');
  const [payoutType, setPayoutType] = useState<PayoutType>('full');
  const [payoutRecords, setPayoutRecords] = useState<ProfitShareOption[]>([]);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    async function load() {
      const supabase = createClient();
      const [usersRes, forexRes, projectsRes] = await Promise.all([
        supabase.from('users').select('*').not('director_tag', 'is', null).eq('is_active', true),
        supabase.from('forex_bureaus').select('id, name').eq('is_active', true).order('name'),
        supabase.from('projects').select('id, name, director_tag').eq('is_active', true).order('name'),
      ]);
      setDirectorUsers((usersRes.data || []) as User[]);
      setForexBureaus((forexRes.data || []) as { id: string; name: string }[]);
    setProjects((projectsRes.data || []) as { id: string; name: string; director_tag: string }[]);
    }
    load();
  }, [open]);

  useEffect(() => {
    if (!open || !payoutDirector || withdrawalType !== 'director_payout') {
      setPayoutRecords([]);
      return;
    }
    async function loadPayoutRecords() {
      const supabase = createClient();
      const { data } = await supabase
        .from('profit_share_records')
        .select('id, period_month, distributable_amount, total_paid_out, balance_remaining, payout_status')
        .eq('director_name', payoutDirector)
        .in('status', ['cfo_reviewed', 'approved'])
        .order('period_month', { ascending: false });

      setPayoutRecords(((data || []) as {
        id: string;
        period_month: string;
        distributable_amount: number;
        total_paid_out: number | null;
        balance_remaining: number | null;
        payout_status: 'unpaid' | 'partial' | 'paid' | null;
      }[]).map((record) => ({
        id: record.id,
        period_month: record.period_month,
        distributable_amount: Number(record.distributable_amount || 0),
        total_paid_out: Number(record.total_paid_out || 0),
        balance_remaining: Number(record.balance_remaining ?? record.distributable_amount ?? 0),
        payout_status: (record.payout_status || 'unpaid') as 'unpaid' | 'partial' | 'paid',
      })));
    }
    loadPayoutRecords();
  }, [open, payoutDirector, withdrawalType]);

  useEffect(() => {
    if (amountUsd > 0 && exchangeRate > 0) {
      setAmountKes(Math.round(amountUsd * exchangeRate * 100) / 100);
    }
  }, [amountUsd, exchangeRate]);

  const selectedDirectorUser = directorUsers.find((u) => u.director_tag === directorTag);
  const periodOptions = useMemo(() => getProfitSharePeriodOptions(payoutRecords), [payoutRecords]);
  const selectedPayoutRecord = useMemo(
    () => payoutRecords.find((record) => record.id === payoutRecordId) ?? null,
    [payoutRecordId, payoutRecords],
  );

  useEffect(() => {
    if (withdrawalType !== 'director_payout' || !selectedPayoutRecord) return;
    if (payoutType === 'full') {
      setAmountKes(selectedPayoutRecord.balance_remaining);
    }
  }, [withdrawalType, selectedPayoutRecord, payoutType]);

  const varianceKes = referenceRate > 0 && amountUsd > 0
    ? amountKes - (amountUsd * referenceRate)
    : 0;

  async function handleAddForexBureau() {
    if (!newForexName.trim()) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from('forex_bureaus')
      .insert({ name: newForexName.trim() })
      .select()
      .single();

    if (error) {
      toast.error(getUserErrorMessage());
    } else {
      setForexBureaus([...forexBureaus, { id: data.id, name: data.name }].sort((a, b) => a.name.localeCompare(b.name)));
      setForexBureau(data.name);
      setNewForexName('');
      setShowAddForex(false);
      toast.success(`"${data.name}" added`);
    }
  }

  async function handleSave() {
    if (withdrawalType === null) {
      toast.error('Select a withdrawal purpose to continue');
      return;
    }

    if (withdrawalType === 'operations' && (!selectedProjectId || amountUsd <= 0 || exchangeRate <= 0)) {
      toast.error('Project, USD amount, and exchange rate are required');
      return;
    }

    if (withdrawalType === 'director_payout') {
      if (!DIRECTOR_NAMES.includes(payoutDirector as (typeof DIRECTOR_NAMES)[number])) {
        toast.error('Select a valid director');
        return;
      }
      if (!payoutRecordId) {
        toast.error('Select an approved profit share period');
        return;
      }
      if (!selectedPayoutRecord) {
        toast.error('Selected profit share record was not found');
        return;
      }
      if (amountKes <= 0) {
        toast.error('Payout amount must be greater than zero');
        return;
      }
      if (amountKes > selectedPayoutRecord.balance_remaining) {
        toast.error(`Amount exceeds remaining balance. Maximum: ${formatKES(selectedPayoutRecord.balance_remaining)}`);
        return;
      }
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        toast.error('Your session has expired. Please sign in again.');
        setSaving(false);
        return;
      }

      const payload = withdrawalType === 'operations'
        ? {
          withdrawal_type: 'operations',
          withdrawal_date: withdrawalDate,
          director_tag: directorTag,
          director_user_id: selectedDirectorUser?.id,
          amount_usd: amountUsd,
          exchange_rate: exchangeRate,
          amount_kes: amountKes,
          forex_bureau: forexBureau || null,
          reference_id: referenceId || null,
          reference_rate: referenceRate || null,
          variance_kes: varianceKes !== 0 ? varianceKes : null,
          year_month: getCurrentYearMonth(),
          notes: notes || null,
        }
        : {
          withdrawal_type: 'director_payout',
          withdrawal_date: withdrawalDate,
          director_name: payoutDirector,
          profit_share_record_id: payoutRecordId,
          payout_type: payoutType,
          amount_usd: amountUsd,
          exchange_rate: exchangeRate,
          amount_kes: amountKes,
          notes: notes || null,
        };

      const response = await fetch('/api/withdrawals/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok) {
        toast.error(result?.error || getUserErrorMessage());
        return;
      }

      toast.success('Withdrawal recorded');
      onSaved();
      onClose();
    } catch {
      toast.error(getUserErrorMessage());
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Withdrawal</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-3 mb-1">
            <p className="text-sm font-medium text-slate-700">Withdrawal Purpose *</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setWithdrawalType('operations')}
                className={cn(
                  'flex flex-col items-start p-4 rounded-lg border-2 text-left transition-colors',
                  withdrawalType === 'operations' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700',
                  'hover:border-slate-900',
                )}
              >
                <span className="text-sm font-semibold mb-1">Company Operations</span>
                <span className={cn('text-xs', withdrawalType === 'operations' ? 'text-slate-300' : 'text-slate-500')}>
                  Business expenses and operational costs. Requires an approved budget.
                </span>
              </button>

              <button
                type="button"
                onClick={() => setWithdrawalType('director_payout')}
                className={cn(
                  'flex flex-col items-start p-4 rounded-lg border-2 text-left transition-colors',
                  withdrawalType === 'director_payout' ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-200 bg-white text-slate-700',
                  'hover:border-amber-500',
                )}
              >
                <span className="text-sm font-semibold mb-1">Director Payout</span>
                <span className={cn('text-xs', withdrawalType === 'director_payout' ? 'text-amber-100' : 'text-slate-500')}>
                  Profit share distribution to a director. No budget required.
                </span>
              </button>
            </div>
          </div>

          {withdrawalType === null && (
            <p className="text-sm text-slate-400 text-center py-4">Select a withdrawal purpose above to continue.</p>
          )}

          {withdrawalType === 'operations' && (
            <>
              
          <div className="space-y-1">
            <Label>Project *</Label>
            <Select value={selectedProjectId} onValueChange={(v) => { if (!v) return; setSelectedProjectId(v); const proj = projects.find(p => p.id === v); if (proj) setDirectorTag(proj.director_tag as DirectorEnum); }}>
              <SelectTrigger>
                <SelectValue placeholder="Select project...">
                  {projects.find((project) => project.id === selectedProjectId)?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

<div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Director *</Label>
                  <Select value={directorTag} onValueChange={(v) => v && setDirectorTag(v as DirectorEnum)}>
                    <SelectTrigger><SelectValue placeholder="Select director..." /></SelectTrigger>
                    <SelectContent>
                      {DIRECTORS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Withdrawal Date</Label>
                  <Input type="date" value={withdrawalDate} onChange={(e) => setWithdrawalDate(e.target.value)} />
                </div>
              </div>

              <div className="space-y-1">
                <Label>USD Amount *</Label>
                <Input type="number" step="0.0001" min={0} value={amountUsd || ''} onChange={(e) => setAmountUsd(parseFloat(e.target.value) || 0)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Exchange Rate (USD to KES) *</Label>
                  <Input type="number" step="0.0001" min={0} value={exchangeRate || ''} onChange={(e) => setExchangeRate(parseFloat(e.target.value) || 0)} />
                </div>
                <div className="space-y-1">
                  <Label>KES Received</Label>
                  <Input type="number" step="0.01" value={amountKes || ''} onChange={(e) => setAmountKes(parseFloat(e.target.value) || 0)} />
                  <p className="text-xs text-muted-foreground">Auto-calculated, adjust if different</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Forex Bureau</Label>
                  {!showAddForex ? (
                    <Select value={forexBureau} onValueChange={(v) => {
                      if (v === '__add_new__') {
                        setShowAddForex(true);
                      } else if (v) {
                        setForexBureau(v);
                      }
                    }}>
                      <SelectTrigger><SelectValue placeholder="Select bureau..." /></SelectTrigger>
                      <SelectContent>
                        {forexBureaus.map((fb) => (
                          <SelectItem key={fb.id} value={fb.name}>{fb.name}</SelectItem>
                        ))}
                        <Separator className="my-1" />
                        <SelectItem value="__add_new__">
                          <span className="flex items-center gap-1 text-blue-600">
                            <Plus className="h-3 w-3" /> Add new bureau
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        value={newForexName}
                        onChange={(e) => setNewForexName(e.target.value)}
                        placeholder="New bureau name"
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && handleAddForexBureau()}
                      />
                      <Button size="sm" onClick={handleAddForexBureau} disabled={!newForexName.trim()}>Add</Button>
                      <Button size="sm" variant="ghost" onClick={() => setShowAddForex(false)}>Cancel</Button>
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Reference ID</Label>
                  <Input value={referenceId} onChange={(e) => setReferenceId(e.target.value)} placeholder="Transaction ref" />
                </div>
              </div>

              <div className="space-y-1">
                <Label>Reference Rate (optional)</Label>
                <Input type="number" step="0.0001" min={0} value={referenceRate || ''} onChange={(e) => setReferenceRate(parseFloat(e.target.value) || 0)} />
                <p className="text-xs text-muted-foreground">CBK or market rate for variance calculation</p>
              </div>

              {varianceKes !== 0 && (
                <div className={`rounded-md p-3 text-sm ${varianceKes > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  Forex variance: {formatCurrency(varianceKes, 'KES')} ({varianceKes > 0 ? 'gain' : 'loss'})
                </div>
              )}

              <div className="space-y-1">
                <Label>Notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
            </>
          )}

          {withdrawalType === 'director_payout' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Director *</Label>
                  <Select value={payoutDirector} onValueChange={(value) => {
                    if (!value) return;
                    setPayoutDirector(value);
                    setPayoutRecordId('');
                  }}>
                    <SelectTrigger><SelectValue placeholder="Select director" /></SelectTrigger>
                    <SelectContent>
                      {DIRECTOR_NAMES.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Withdrawal Date</Label>
                  <Input type="date" value={withdrawalDate} onChange={(e) => setWithdrawalDate(e.target.value)} />
                </div>
              </div>

              {payoutDirector && (
                <div className="space-y-1">
                  <Label>Profit Share Period *</Label>
                  <Select value={payoutRecordId} onValueChange={(value) => setPayoutRecordId(value || '')}>
                    <SelectTrigger><SelectValue placeholder="Select approved profit share period" /></SelectTrigger>
                    <SelectContent>
                      {periodOptions.map((option) => {
                        if (!option.record) {
                          return (
                            <SelectItem key={option.monthKey} value={`no-record-${option.monthKey}`} disabled>
                              {`${option.label} — No approved record`}
                            </SelectItem>
                          );
                        }

                        const record = option.record;
                        return (
                          <SelectItem key={record.id} value={record.id} disabled={record.payout_status === 'paid'}>
                            {`${option.label} — Allocated: ${formatKES(record.distributable_amount)} — Remaining: ${formatKES(record.balance_remaining)} — ${record.payout_status === 'paid' ? 'Fully Paid' : capitalize(record.payout_status)}`}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {selectedPayoutRecord && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
                  <p className="text-xs font-medium text-amber-800 uppercase tracking-wide">Profit Share Summary</p>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-slate-500 text-xs">Allocated</p>
                      <p className="font-semibold">{formatKES(selectedPayoutRecord.distributable_amount)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs">Paid Out</p>
                      <p className="font-semibold">{formatKES(selectedPayoutRecord.total_paid_out)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs">Remaining</p>
                      <p className={cn('font-semibold', selectedPayoutRecord.balance_remaining === 0 ? 'text-green-600' : 'text-amber-700')}>
                        {formatKES(selectedPayoutRecord.balance_remaining)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <Label>Payout Type *</Label>
                <div className="flex gap-3 mt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="full"
                      checked={payoutType === 'full'}
                      onChange={() => {
                        setPayoutType('full');
                        if (selectedPayoutRecord) {
                          setAmountKes(selectedPayoutRecord.balance_remaining);
                        }
                      }}
                    />
                    <span className="text-sm">Full Payout</span>
                    {selectedPayoutRecord && payoutType === 'full' && (
                      <span className="text-xs text-slate-500">({formatKES(selectedPayoutRecord.balance_remaining)})</span>
                    )}
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="partial"
                      checked={payoutType === 'partial'}
                      onChange={() => setPayoutType('partial')}
                    />
                    <span className="text-sm">Partial Payout</span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>USD Amount *</Label>
                  <Input type="number" step="0.0001" min={0} value={amountUsd || ''} onChange={(e) => setAmountUsd(parseFloat(e.target.value) || 0)} />
                </div>
                <div className="space-y-1">
                  <Label>Exchange Rate (USD to KES) *</Label>
                  <Input type="number" step="0.0001" min={0} value={exchangeRate || ''} onChange={(e) => setExchangeRate(parseFloat(e.target.value) || 0)} />
                </div>
              </div>

              <div className="space-y-1">
                <Label>KES Amount *</Label>
                <Input type="number" step="0.01" min={0} value={amountKes || ''} onChange={(e) => setAmountKes(parseFloat(e.target.value) || 0)} />
                {selectedPayoutRecord && (
                  <p className="text-xs text-slate-500">Maximum allowed: {formatKES(selectedPayoutRecord.balance_remaining)}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label>Notes</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional notes (e.g. 'Q1 2026 profit distribution')"
                  rows={2}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || withdrawalType === null}>{saving ? 'Saving...' : 'Record Withdrawal'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
