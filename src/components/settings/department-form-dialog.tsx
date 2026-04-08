'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import type { User } from '@/types/database';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function DepartmentFormDialog({ open, onClose, onSaved }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('is_active', true)
        .order('full_name');
      setUsers((data || []) as User[]);
    }
    load();
  }, [open]);

  async function handleSave() {
    if (!name.trim() || !ownerId) {
      toast.error('Name and owner are required');
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from('departments').insert({
      name,
      owner_user_id: ownerId,
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Department created');
      setName('');
      setOwnerId('');
      onSaved();
      onClose();
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Department</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Department Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Human Resources" />
          </div>
          <div className="space-y-1">
            <Label>Owner (PM / Dept Head) *</Label>
            <Select value={ownerId} onValueChange={(v) => v && setOwnerId(v)}>
              <SelectTrigger><SelectValue placeholder="Select owner..." /></SelectTrigger>
              <SelectContent>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name} ({u.role})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Creating...' : 'Create Department'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
