'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { DepartmentFormDialog } from '@/components/settings/department-form-dialog';
import { formatDate } from '@/lib/format';
import { Plus } from 'lucide-react';
import type { Department } from '@/types/database';

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

  return (
    <div>
      <PageHeader title="Departments" description="Organizational units for shared budgets">
        {isCfo && (
          <Button size="sm" className="gap-1" onClick={() => setShowDialog(true)}>
            <Plus className="h-4 w-4" /> New Department
          </Button>
        )}
      </PageHeader>

      <DepartmentFormDialog
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
                  <TableHead>Name</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{d.owner_name || '—'}</TableCell>
                    <TableCell className="text-sm text-neutral-500">{formatDate(d.created_at)}</TableCell>
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
