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
import { UserFormDialog } from '@/components/settings/user-form-dialog';
import { capitalize } from '@/lib/format';
import { ROLE_LABELS } from '@/types/database';
import { Plus } from 'lucide-react';
import type { User } from '@/types/database';

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

  return (
    <div>
      <PageHeader title="Users" description="Manage system users and roles">
        {isCfo && (
          <Button size="sm" className="gap-1" onClick={() => setShowDialog(true)}>
            <Plus className="h-4 w-4" /> Add User
          </Button>
        )}
      </PageHeader>

      <UserFormDialog
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
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Director</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.full_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={
                        u.role === 'cfo' ? 'bg-violet-soft text-violet-soft-foreground' :
                        u.role === 'project_manager' ? 'bg-blue-100 text-blue-700' :
                        u.role === 'team_leader' ? 'bg-teal-100 text-teal-700' :
                        u.role === 'accountant' ? 'bg-warning-soft text-warning-soft-foreground' : ''
                      }>{ROLE_LABELS[u.role]}</Badge>
                    </TableCell>
                    <TableCell>{u.director_tag ? capitalize(u.director_tag) : '—'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={u.is_active ? 'bg-success-soft text-success-soft-foreground' : 'bg-muted text-muted-foreground'}>
                        {u.is_active && <span className="mr-1 inline-block w-1.5 h-1.5 rounded-full bg-success animate-pulse" />}
                        {u.is_active ? 'Active' : 'Inactive'}
                      </Badge>
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
