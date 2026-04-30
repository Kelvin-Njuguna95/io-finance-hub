'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { DepartmentFormDialog } from '@/components/settings/department-form-dialog';
import { formatDate } from '@/lib/format';
import { Plus } from 'lucide-react';
import type { Department } from '@/types/database';

const ROW_GRID = 'grid grid-cols-[1.6fr_1fr_140px] items-center gap-4';

export default function DepartmentsPage() {
  const { user } = useUser();
  const [departments, setDepartments] = useState<(Department & { owner_name?: string })[]>([]);
  const [showDialog, setShowDialog] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from('departments')
        .select('*, users!departments_owner_user_id_fkey(full_name)')
        .order('name');

      setDepartments(
        (data || []).map((d: Record<string, unknown>) => ({
          ...d,
          owner_name: 'All Directors',
        })) as (Department & { owner_name?: string })[]
      );
    }
    load();
  }, []);

  const isCfo = user?.role === 'cfo';

  const headerActions = isCfo ? (
    <Button size="sm" className="gap-1" onClick={() => setShowDialog(true)}>
      <Plus className="h-4 w-4" /> New Department
    </Button>
  ) : null;

  const subtitle = `${departments.length} department${departments.length === 1 ? '' : 's'} · shared budget owners`;

  return (
    <div className="p-6">
      <PageTitle
        primary="Department"
        accent="directory"
        subtitle={subtitle}
        action={headerActions}
      />

      <DepartmentFormDialog
        open={showDialog}
        onClose={() => setShowDialog(false)}
        onSaved={() => { setShowDialog(false); window.location.reload(); }}
      />

      <div className="mt-6">
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          {/* List head */}
          <div
            className={`${ROW_GRID} border-b border-border bg-[var(--paper-2)] px-5 py-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground`}
          >
            <div>Name</div>
            <div>Owner</div>
            <div className="text-right">Created</div>
          </div>

          {/* Rows */}
          {departments.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              No departments configured.
            </div>
          ) : (
            departments.map((d) => (
              <div
                key={d.id}
                className={`${ROW_GRID} border-b border-border-subtle px-5 py-4 last:border-b-0`}
              >
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-medium text-foreground">{d.name}</div>
                </div>
                <div className="truncate text-[13px] text-muted-foreground">
                  {d.owner_name || '—'}
                </div>
                <div className="text-right font-mono text-[11.5px] tabular-nums text-muted-foreground">
                  {formatDate(d.created_at)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
