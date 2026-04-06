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
import { Textarea } from '@/components/ui/textarea';
import { DIRECTORS } from '@/types/database';
import { toast } from 'sonner';
import type { User, DirectorEnum } from '@/types/database';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function ProjectFormDialog({ open, onClose, onSaved }: Props) {
  const [directorUsers, setDirectorUsers] = useState<User[]>([]);
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [directorTag, setDirectorTag] = useState<DirectorEnum | ''>('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from('users')
        .select('*')
        .not('director_tag', 'is', null)
        .eq('is_active', true);
      setDirectorUsers((data || []) as User[]);
    }
    load();
  }, [open]);

  const selectedDirectorUser = directorUsers.find((u) => u.director_tag === directorTag);

  async function handleSave() {
    if (!name.trim() || !clientName.trim() || !directorTag || !selectedDirectorUser) {
      toast.error('Name, client, and director are required');
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from('projects').insert({
      name,
      client_name: clientName,
      director_user_id: selectedDirectorUser.id,
      director_tag: directorTag,
      description: description || null,
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Project created');
      setName('');
      setClientName('');
      setDirectorTag('');
      setDescription('');
      onSaved();
      onClose();
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Project Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Project Alpha" />
          </div>
          <div className="space-y-1">
            <Label>Client Name *</Label>
            <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Acme Corp" />
          </div>
          <div className="space-y-1">
            <Label>Originating Director *</Label>
            <Select value={directorTag} onValueChange={(v) => v && setDirectorTag(v as DirectorEnum)}>
              <SelectTrigger><SelectValue placeholder="Select director..." /></SelectTrigger>
              <SelectContent>
                {DIRECTORS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Creating...' : 'Create Project'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
