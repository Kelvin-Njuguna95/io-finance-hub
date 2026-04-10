'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ProjectFormDialog } from '@/components/settings/project-form-dialog';
import { capitalize, formatDate } from '@/lib/format';
import { Plus } from 'lucide-react';
import type { Project } from '@/types/database';

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

  return (
    <div>
      <PageHeader title="Projects" description="Manage client projects">
        {isCfo && (
          <Button size="sm" className="gap-1" onClick={() => setShowDialog(true)}>
            <Plus className="h-4 w-4" /> New Project
          </Button>
        )}
      </PageHeader>

      <ProjectFormDialog
        open={showDialog}
        onClose={() => setShowDialog(false)}
        onSaved={() => { setShowDialog(false); window.location.reload(); }}
      />

      <div className="p-6">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project Name</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Director</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.client_name}</TableCell>
                    <TableCell>
                      {p.director_name || capitalize(p.director_tag)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.is_active ? 'default' : 'secondary'}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(p.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
