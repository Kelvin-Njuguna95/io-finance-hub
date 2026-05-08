'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useIdempotencyKey } from '@/hooks/use-idempotency-key';
import { createClient } from '@/lib/supabase/client';
import { formatKES } from '@/lib/utils/currency';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

// Stage 3 of 5 (PRED-3). Two-tab dialog that records director payouts
// that occurred BEFORE the app was adopted. Calls the routes from
// PRED-2:
//   • 70% Project Share → POST /api/predated-payouts
//   • 30% Company Pool  → POST /api/predated-company-shares
//
// Each tab carries its own form state and its own idempotency key.
// Switching tabs preserves the other tab's draft. Both keys regen on
// every dialog open and on every successful submit so the next attempt
// gets a fresh key (the partial unique index on idempotency_key is the
// duplicate-submit lock).

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'mobile_money', label: 'Mobile money' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
] as const;

const NOTES_MAX_CHARS = 500;
const PREDATED_START_YEAR = 2024;
const PREDATED_START_MONTH = 10;

export type PredatedDirectorOption = { id: string; full_name: string };
export type PredatedProjectOption = {
  id: string;
  name: string;
  is_active: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  directors: PredatedDirectorOption[];
  projects: PredatedProjectOption[];
  onSuccess?: () => void;
};

/** Build YYYY-MM options from Oct 2024 through last month, anchored to
 *  Africa/Nairobi so a server in any timezone agrees on "this month."
 *  Returns most-recent first. */
function buildYearMonthOptions(): Array<{ value: string; label: string }> {
  const parts = new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const curYear = Number(parts.find((p) => p.type === 'year')?.value);
  const curMonth = Number(parts.find((p) => p.type === 'month')?.value);

  // Last month in Nairobi.
  let endYear = curYear;
  let endMonth = curMonth - 1;
  if (endMonth === 0) {
    endMonth = 12;
    endYear -= 1;
  }

  const out: Array<{ value: string; label: string }> = [];
  let y = endYear;
  let m = endMonth;
  while (
    y > PREDATED_START_YEAR ||
    (y === PREDATED_START_YEAR && m >= PREDATED_START_MONTH)
  ) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    const labelDate = new Date(Date.UTC(y, m - 1, 1));
    const label = new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: 'long',
    }).format(labelDate);
    out.push({ value: ym, label });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

function parseAmount(raw: string): number {
  return Number.parseFloat(raw.replace(/,/g, ''));
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Your session has expired. Please sign in again.');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

export function PredatedPayoutDialog({
  open,
  onOpenChange,
  directors,
  projects,
  onSuccess,
}: Props) {
  // 70% project-share tab state.
  const [pDirector, setPDirector] = useState('');
  const [pProject, setPProject] = useState('');
  const [pYearMonth, setPYearMonth] = useState('');
  const [pAmount, setPAmount] = useState('');
  const [pPaymentMethod, setPPaymentMethod] = useState('');
  const [pNotes, setPNotes] = useState('');
  const [pSubmitting, setPSubmitting] = useState(false);
  const [pIdempotencyKey, regenP] = useIdempotencyKey();

  // 30% company-pool tab state.
  const [cDirector, setCDirector] = useState('');
  const [cYearMonth, setCYearMonth] = useState('');
  const [cAmount, setCAmount] = useState('');
  const [cPaymentMethod, setCPaymentMethod] = useState('');
  const [cNotes, setCNotes] = useState('');
  const [cSubmitting, setCSubmitting] = useState(false);
  const [cIdempotencyKey, regenC] = useIdempotencyKey();

  // Reset all form state and regenerate both keys on every open. Each
  // open is a fresh attempt cycle for both tabs.
  useEffect(() => {
    if (!open) return;
    setPDirector('');
    setPProject('');
    setPYearMonth('');
    setPAmount('');
    setPPaymentMethod('');
    setPNotes('');
    setCDirector('');
    setCYearMonth('');
    setCAmount('');
    setCPaymentMethod('');
    setCNotes('');
    regenP();
    regenC();
  }, [open, regenP, regenC]);

  const yearMonthOptions = useMemo(buildYearMonthOptions, []);

  const sortedDirectors = useMemo(
    () =>
      [...directors].sort((a, b) =>
        (a.full_name ?? '').localeCompare(b.full_name ?? ''),
      ),
    [directors],
  );

  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) => {
        // Active first, then alphabetical within each group.
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [projects],
  );

  const directorNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of sortedDirectors) m.set(d.id, d.full_name);
    return m;
  }, [sortedDirectors]);

  async function submitProjectShare() {
    if (!pDirector) {
      toast.error('Select a director.');
      return;
    }
    if (!pProject) {
      toast.error('Select a project.');
      return;
    }
    if (!pYearMonth) {
      toast.error('Select a month.');
      return;
    }
    const amt = parseAmount(pAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Amount must be greater than zero.');
      return;
    }
    if (!pPaymentMethod) {
      toast.error('Select a payment method.');
      return;
    }
    if (pNotes.length > NOTES_MAX_CHARS) {
      toast.error(`Notes must be at most ${NOTES_MAX_CHARS} characters.`);
      return;
    }

    setPSubmitting(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/predated-payouts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          director_user_id: pDirector,
          project_id: pProject,
          year_month: pYearMonth,
          amount_kes: amt,
          payment_method: pPaymentMethod,
          notes: pNotes.trim() || undefined,
          idempotency_key: pIdempotencyKey,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(data.error || 'Failed to record predated payout.');
        return;
      }
      toast.success(
        `Recorded ${formatKES(amt)} for ${directorNameById.get(pDirector) ?? 'director'}.`,
      );
      regenP();
      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to record predated payout.',
      );
    } finally {
      setPSubmitting(false);
    }
  }

  async function submitCompanyShare() {
    if (!cDirector) {
      toast.error('Select a director.');
      return;
    }
    if (!cYearMonth) {
      toast.error('Select a month.');
      return;
    }
    const amt = parseAmount(cAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Amount must be greater than zero.');
      return;
    }
    if (!cPaymentMethod) {
      toast.error('Select a payment method.');
      return;
    }
    if (cNotes.length > NOTES_MAX_CHARS) {
      toast.error(`Notes must be at most ${NOTES_MAX_CHARS} characters.`);
      return;
    }

    setCSubmitting(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/predated-company-shares', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          director_user_id: cDirector,
          year_month: cYearMonth,
          amount_kes: amt,
          payment_method: cPaymentMethod,
          notes: cNotes.trim() || undefined,
          idempotency_key: cIdempotencyKey,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(
          data.error || 'Failed to record predated company-share distribution.',
        );
        return;
      }
      toast.success(
        `Recorded ${formatKES(amt)} for ${directorNameById.get(cDirector) ?? 'director'} (company pool).`,
      );
      regenC();
      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Failed to record predated company-share distribution.',
      );
    } finally {
      setCSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record predated payout</DialogTitle>
          <DialogDescription>
            Record a director payout that occurred before the app was adopted
            (Oct 2024 onwards). Two streams: 70% project share or 30% company
            pool.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="seventy" className="mt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="seventy">70% project share</TabsTrigger>
            <TabsTrigger value="thirty">30% company pool</TabsTrigger>
          </TabsList>

          <TabsContent value="seventy" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="pred-p-director">Director</Label>
              <Select
                value={pDirector || undefined}
                onValueChange={(v) => v && setPDirector(v)}
              >
                <SelectTrigger id="pred-p-director">
                  <SelectValue placeholder="Select a director" />
                </SelectTrigger>
                <SelectContent>
                  {sortedDirectors.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pred-p-project">Project</Label>
              <Select
                value={pProject || undefined}
                onValueChange={(v) => v && setPProject(v)}
              >
                <SelectTrigger id="pred-p-project">
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {sortedProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.is_active ? p.name : `${p.name} (deactivated)`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pred-p-month">Month</Label>
              <Select
                value={pYearMonth || undefined}
                onValueChange={(v) => v && setPYearMonth(v)}
              >
                <SelectTrigger id="pred-p-month">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {yearMonthOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pred-p-amount">Amount (KES)</Label>
              <Input
                id="pred-p-amount"
                inputMode="decimal"
                value={pAmount}
                onChange={(e) => setPAmount(e.target.value)}
                placeholder="500000"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pred-p-method">Payment method</Label>
              <Select
                value={pPaymentMethod || undefined}
                onValueChange={(v) => v && setPPaymentMethod(v)}
              >
                <SelectTrigger id="pred-p-method">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pred-p-notes">Notes (optional)</Label>
              <Textarea
                id="pred-p-notes"
                value={pNotes}
                onChange={(e) => setPNotes(e.target.value)}
                placeholder="Optional context (e.g. reference number, recipient confirmation)"
                rows={3}
              />
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pSubmitting}
              >
                Cancel
              </Button>
              <Button onClick={submitProjectShare} disabled={pSubmitting}>
                {pSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                Record payout
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="thirty" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="pred-c-director">Director</Label>
              <Select
                value={cDirector || undefined}
                onValueChange={(v) => v && setCDirector(v)}
              >
                <SelectTrigger id="pred-c-director">
                  <SelectValue placeholder="Select a director" />
                </SelectTrigger>
                <SelectContent>
                  {sortedDirectors.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pred-c-month">Month</Label>
              <Select
                value={cYearMonth || undefined}
                onValueChange={(v) => v && setCYearMonth(v)}
              >
                <SelectTrigger id="pred-c-month">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {yearMonthOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pred-c-amount">Amount (KES)</Label>
              <Input
                id="pred-c-amount"
                inputMode="decimal"
                value={cAmount}
                onChange={(e) => setCAmount(e.target.value)}
                placeholder="200000"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pred-c-method">Payment method</Label>
              <Select
                value={cPaymentMethod || undefined}
                onValueChange={(v) => v && setCPaymentMethod(v)}
              >
                <SelectTrigger id="pred-c-method">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pred-c-notes">Notes (optional)</Label>
              <Textarea
                id="pred-c-notes"
                value={cNotes}
                onChange={(e) => setCNotes(e.target.value)}
                placeholder="Optional context (e.g. reference number, recipient confirmation)"
                rows={3}
              />
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={cSubmitting}
              >
                Cancel
              </Button>
              <Button onClick={submitCompanyShare} disabled={cSubmitting}>
                {cSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                Record distribution
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
