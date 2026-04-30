'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { UserFormDialog } from '@/components/settings/user-form-dialog';
import { capitalize } from '@/lib/format';
import { ROLE_LABELS } from '@/types/database';
import { Plus } from 'lucide-react';
import type { User } from '@/types/database';

import { cn } from '@/lib/utils';

const ROW_GRID = 'grid grid-cols-[2fr_1fr_120px_140px_120px] items-center gap-4';

const ROLE_PILL_TONE: Record<string, string> = {
  cfo: 'bg-[oklch(0.95_0.10_90)] text-[oklch(0.40_0.15_75)] border border-[var(--gold)]',
  project_manager: 'bg-info-soft text-info-soft-foreground',
  team_leader: 'bg-[oklch(0.95_0.04_220)] text-[oklch(0.40_0.15_230)]',
  accountant: 'bg-[var(--paper-3)] text-foreground',
};

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] || '') + (parts[parts.length - 1]![0] || '')).toUpperCase();
}

export default function UsersPage() {
  const { user } = useUser();
  const [users, setUsers] = useState<User[]>([]);
  const [showDialog, setShowDialog] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from('users').select('*').order('full_name');
      setUsers((data || []) as User[]);
    }
    load();
  }, []);

  const isCfo = user?.role === 'cfo';
  const activeCount = users.filter((u) => u.is_active).length;
  const roleCount = new Set(users.map((u) => u.role)).size;

  const headerActions = isCfo ? (
    <Button size="sm" className="gap-1" onClick={() => setShowDialog(true)}>
      <Plus className="h-4 w-4" /> Add User
    </Button>
  ) : null;

  const subtitle = `${users.length} user${users.length === 1 ? '' : 's'} · ${activeCount} active · ${roleCount} role${roleCount === 1 ? '' : 's'}`;

  return (
    <div className="p-6">
      <PageTitle
        primary="Users &"
        accent="roles"
        subtitle={subtitle}
        action={headerActions}
      />

      <UserFormDialog
        open={showDialog}
        onClose={() => setShowDialog(false)}
        onSaved={() => { setShowDialog(false); window.location.reload(); }}
      />

      <div className="mt-6">
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          {/* List head */}
          <div
            className={cn(
              ROW_GRID,
              'border-b border-border bg-[var(--paper-2)] px-5 py-3',
              'font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground',
            )}
          >
            <div>User</div>
            <div>Email</div>
            <div>Role</div>
            <div>Director</div>
            <div>Status</div>
          </div>

          {/* Rows */}
          {users.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              No users found.
            </div>
          ) : (
            users.map((u) => {
              const tone = ROLE_PILL_TONE[u.role] || 'bg-muted text-muted-foreground';
              return (
                <div
                  key={u.id}
                  className={cn(
                    ROW_GRID,
                    'border-b border-border-subtle px-5 py-4 transition-colors last:border-b-0',
                    'hover:bg-[var(--paper-2)]',
                  )}
                >
                  {/* User: avatar + name */}
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      aria-hidden
                      className={cn(
                        'inline-flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold',
                        u.is_active
                          ? 'bg-[var(--ink)] text-[var(--gold)]'
                          : 'bg-[var(--paper-3)] text-muted-foreground',
                      )}
                    >
                      {initialsFor(u.full_name)}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-medium text-foreground">
                        {u.full_name}
                      </div>
                    </div>
                  </div>

                  {/* Email */}
                  <div className="truncate font-mono text-[11.5px] text-muted-foreground">
                    {u.email}
                  </div>

                  {/* Role */}
                  <div>
                    <span
                      className={cn(
                        'inline-flex items-center whitespace-nowrap rounded-[var(--radius-sm)] px-2 py-0.5 font-mono text-[10.5px] font-semibold tracking-[0.04em]',
                        tone,
                      )}
                    >
                      {ROLE_LABELS[u.role]}
                    </span>
                  </div>

                  {/* Director */}
                  <div className="font-mono text-[11.5px] uppercase tracking-[0.10em] text-muted-foreground">
                    {u.director_tag ? capitalize(u.director_tag) : '—'}
                  </div>

                  {/* Status */}
                  <div className="font-mono text-[11px]">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className={cn(
                          'size-[7px] rounded-full',
                          u.is_active ? 'bg-[var(--success)]' : 'bg-[var(--paper-4)]',
                        )}
                      />
                      <span className={u.is_active ? 'text-foreground' : 'text-muted-foreground'}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
