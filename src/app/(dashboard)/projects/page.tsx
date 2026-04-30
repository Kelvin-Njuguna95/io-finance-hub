'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { ProjectFormDialog } from '@/components/settings/project-form-dialog';
import { capitalize, formatDate } from '@/lib/format';
import { Plus, PlusCircle } from 'lucide-react';
import type { Project } from '@/types/database';

import { cn } from '@/lib/utils';

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] || '') + (parts[parts.length - 1]![0] || '')).toUpperCase();
}

function splitNameForAccent(name: string): { primary: string; accent: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return { primary: name, accent: '' };
  if (parts.length === 1) return { primary: parts[0]!, accent: '' };
  // Last token becomes the italic accent (mockup: "Apex" "Sales" / "Helios" "CX")
  const accent = parts[parts.length - 1]!;
  const primary = parts.slice(0, -1).join(' ');
  return { primary, accent };
}

export default function ProjectsPage() {
  const { user } = useUser();
  const [projects, setProjects] = useState<(Project & { director_name?: string })[]>([]);
  const [showDialog, setShowDialog] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from('projects')
        .select('*, users!projects_director_user_id_fkey(full_name)')
        .order('created_at', { ascending: false });

      setProjects(
        (data || []).map((p: Record<string, unknown>) => ({
          ...p,
          director_name: (p.users as Record<string, unknown>)?.full_name as string | undefined,
        })) as (Project & { director_name?: string })[]
      );
    }
    load();
  }, []);

  const isCfo = user?.role === 'cfo';
  const activeCount = projects.filter((p) => p.is_active).length;
  const inactiveCount = projects.length - activeCount;

  const headerActions = isCfo ? (
    <Button size="sm" className="gap-1" onClick={() => setShowDialog(true)}>
      <Plus className="h-4 w-4" /> New Project
    </Button>
  ) : null;

  const subtitle = `${projects.length} project${projects.length === 1 ? '' : 's'} · ${activeCount} active${inactiveCount > 0 ? ` · ${inactiveCount} inactive` : ''}`;

  return (
    <div className="p-6">
      <PageTitle
        primary="Project"
        accent="directory"
        subtitle={subtitle}
        action={headerActions}
      />

      <ProjectFormDialog
        open={showDialog}
        onClose={() => setShowDialog(false)}
        onSaved={() => { setShowDialog(false); window.location.reload(); }}
      />

      <div className="mt-6">
        {projects.length === 0 && !isCfo ? (
          <div className="rounded-[var(--radius-lg)] border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            No projects configured.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => {
              const { primary, accent } = splitNameForAccent(p.name);
              const ownerName = p.director_name || (p.director_tag ? capitalize(p.director_tag) : '—');
              return (
                <article
                  key={p.id}
                  className={cn(
                    'group/proj relative flex flex-col gap-4 rounded-[var(--radius-lg)] border border-border bg-card p-6 pb-5',
                    'transition-colors hover:border-foreground',
                  )}
                >
                  {/* Header row — name block + status pill */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3
                        className="font-display text-[22px] font-medium leading-[1.15] tracking-[-0.01em] text-foreground"
                        style={{ fontVariationSettings: '"opsz" 28' }}
                      >
                        {primary}
                        {accent && (
                          <>
                            {' '}
                            <em className="font-normal italic">{accent}</em>
                          </>
                        )}
                      </h3>
                      {p.client_name && (
                        <div className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
                          {p.client_name}
                        </div>
                      )}
                    </div>
                    <StatusPill active={p.is_active} />
                  </div>

                  {/* Spacer / divider rail */}
                  <div className="border-t border-border-subtle" />

                  {/* Footer — owner + created */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-flex size-7 items-center justify-center rounded-full bg-[var(--ink)] font-mono text-[10px] font-semibold text-[var(--gold)]"
                      >
                        {initialsFor(ownerName)}
                      </span>
                      <span className="text-[12px] text-foreground">{ownerName}</span>
                    </div>
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
                      {formatDate(p.created_at)}
                    </span>
                  </div>
                </article>
              );
            })}

            {/* "+ New project" dashed tile (CFO only) */}
            {isCfo && (
              <button
                type="button"
                onClick={() => setShowDialog(true)}
                className={cn(
                  'flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed border-border bg-[var(--paper-2)] text-muted-foreground transition-colors',
                  'hover:border-foreground hover:bg-[var(--paper-3)] hover:text-foreground',
                )}
              >
                <PlusCircle className="size-7" strokeWidth={1.5} aria-hidden />
                <span className="font-display text-[16px] font-medium text-foreground">
                  Add a project
                </span>
                <span className="text-[12px] text-muted-foreground">
                  Start a new client engagement
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em]',
        active
          ? 'bg-success-soft text-success-soft-foreground'
          : 'bg-[var(--paper-3)] text-muted-foreground',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-[6px] rounded-full',
          active ? 'bg-[var(--success)]' : 'bg-[var(--paper-4)]',
        )}
      />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}
