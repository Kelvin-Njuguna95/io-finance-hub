'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SystemSetting } from '@/types/database';
import { toast } from 'sonner';

export default function SettingsPage() {
  const { user } = useUser();
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from('system_settings').select('*').order('key');
      setSettings(data || []);
      const v: Record<string, string> = {};
      (data || []).forEach((s) => { v[s.key] = s.value; });
      setValues(v);
    }
    load();
  }, []);

  async function handleSave() {
    const supabase = createClient();
    for (const s of settings) {
      if (values[s.key] !== s.value) {
        await supabase.from('system_settings').update({
          value: values[s.key],
          updated_by: user?.id,
          updated_at: new Date().toISOString(),
        }).eq('id', s.id);
      }
    }
    toast.success('Settings saved');
  }

  const settingLabels: Record<string, string> = {
    overdue_invoice_days: 'Overdue Invoice Threshold (days)',
    expense_spike_threshold_percent: 'Expense Spike Threshold (%)',
    budget_warning_threshold_percent: 'Budget Warning Threshold (%)',
  };

  return (
    <div>
      <PageHeader title="Settings" description="Configure system thresholds and parameters" />

      <div className="p-6">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle className="text-sm">Alert Thresholds</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {settings.map((s) => (
              <div key={s.id} className="space-y-1">
                <Label htmlFor={s.key}>{settingLabels[s.key] || s.key}</Label>
                {s.description && (
                  <p className="text-xs text-neutral-400">{s.description}</p>
                )}
                <Input
                  id={s.key}
                  type="number"
                  value={values[s.key] || ''}
                  onChange={(e) => setValues((v) => ({ ...v, [s.key]: e.target.value }))}
                />
              </div>
            ))}
            <Button onClick={handleSave} className="mt-2">Save Settings</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
