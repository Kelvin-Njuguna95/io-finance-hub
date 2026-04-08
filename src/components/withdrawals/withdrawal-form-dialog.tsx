'use client';

import { useEffect, useState } from 'react';
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
import { getCurrentYearMonth, formatCurrency } from '@/lib/format';
import { DIRECTORS } from '@/types/database';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { User, DirectorEnum } from '@/types/database';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function WithdrawalFormDialog({ open, onClose, onSaved }: Props) {
  const { user } = useUser();
  const [directorUsers, setDirectorUsers] = useState<User[]>([]);
  const [forexBureaus, setForexBureaus] = useState<{ id: string; name: string }[]>([]);
  const [directorTag, setDirectorTag] = useState<DirectorEnum | ''>('');
  const [withdrawalDate, setWithdrawalDate] = useState(new Date().toISOString().split('T')[0]);
  const [amountUsd, setAmountUsd] = useState(0);
  const [exchangeRate, setExchangeRate] = useState(0);
  const [amountKes, setAmountKes] = useState(0);
  const [forexBureau, setForexBureau] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [referenceRate, setReferenceRate] = useState(0);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAddForex, setShowAddForex] = useState(false);
  const [newForexName, setNewForexName] = useState('');

  // Auto-calculate KES when USD or rate changes
  useEffect(() => {
    if (amountUsd > 0 && exchangeRate > 0) {
      setAmountKes(Math.round(amountUsd * exchangeRate * 100) / 100);
    }
  }, [amountUsd, exchangeRate]);

  useEffect(() => {
    if (!open) return;
    async function load() {
      const supabase = createClient();
      const [usersRes, forexRes] = await Promise.all([
        supabase.from('users').select('*').not('director_tag', 'is', null).eq('is_active', true),
        supabase.from('forex_bureaus').select('id, name').eq('is_active', true).order('name'),
      ]);
      setDirectorUsers((usersRes.data || []) as User[]);
      setForexBureaus((forexRes.data || []) as { id: string; name: string }[]);
    }
    load();
  }, [open]);

  const selectedDirectorUser = directorUsers.find((u) => u.director_tag === directorTag);
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
      toast.error(error.message);
    } else {
      setForexBureaus([...forexBureaus, { id: data.id, name: data.name }].sort((a, b) => a.name.localeCompare(b.name)));
      setForexBureau(data.name);
      setNewForexName('');
      setShowAddForex(false);
      toast.success(`"${data.name}" added`);
    }
  }

  async function handleSave() {
    if (!directorTag || amountUsd <= 0 || exchangeRate <= 0) {
      toast.error('Director, USD amount, and exchange rate are required');
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const { error } = await supabase.from('withdrawals').insert({
      withdrawal_date: withdrawalDate,
      director_tag: directorTag,
      director_user_id: selectedDirectorUser!.id,
      amount_usd: amountUsd,
      exchange_rate: exchangeRate,
      amount_kes: amountKes,
      forex_bureau: forexBureau || null,
      reference_id: referenceId || null,
      reference_rate: referenceRate || null,
      variance_kes: varianceKes !== 0 ? varianceKes : null,
      year_month: getCurrentYearMonth(),
      notes: notes || null,
      recorded_by: user!.id,
    });

    if (error) {
      toast.error(error.message);
    } else {
      // Also create forex log
      const { data: withdrawal } = await supabase
        .from('withdrawals')
        .select('id')
        .eq('director_tag', directorTag)
        .eq('amount_usd', amountUsd)
        .eq('withdrawal_date', withdrawalDate)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (withdrawal) {
        await supabase.from('forex_logs').insert({
          withdrawal_id: withdrawal.id,
          rate_date: withdrawalDate,
          rate_usd_to_kes: exchangeRate,
          source: forexBureau || 'Manual entry',
        });
      }

      toast.success('Withdrawal recorded');
      onSaved();
      onClose();
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Withdrawal</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
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
              <Input
                type="number"
                step="0.01"
                value={amountKes || ''}
                onChange={(e) => setAmountKes(parseFloat(e.target.value) || 0)}
              />
              <p className="text-xs text-neutral-400">Auto-calculated, adjust if different</p>
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
            <Input
              type="number"
              step="0.0001"
              min={0}
              value={referenceRate || ''}
              onChange={(e) => setReferenceRate(parseFloat(e.target.value) || 0)}
            />
            <p className="text-xs text-neutral-400">CBK or market rate for variance calculation</p>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Record Withdrawal'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
