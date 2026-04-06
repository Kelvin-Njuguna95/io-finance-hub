'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DIRECTORS, ROLE_LABELS } from '@/types/database';
import { toast } from 'sonner';
import type { UserRole, DirectorEnum } from '@/types/database';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const roles: { value: UserRole; label: string }[] = [
  { value: 'cfo', label: 'CFO' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'team_leader', label: 'Team Leader' },
  { value: 'project_manager', label: 'Project Manager' },
];

export function UserFormDialog({ open, onClose, onSaved }: Props) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('team_leader');
  const [directorTag, setDirectorTag] = useState<DirectorEnum | ''>('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!email.trim() || !fullName.trim() || !password.trim()) {
      toast.error('Email, name, and password are required');
      return;
    }

    setSaving(true);
    const supabase = createClient();

    // Create auth user via admin API (requires service role key)
    // In production, this would use a Supabase Edge Function with the service_role key
    // For now, we create the user record and instruct manual auth setup
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      // Fallback: just create the user record (auth user must be created via Supabase dashboard)
      toast.error(`Auth creation failed: ${authError.message}. Create the auth user manually in Supabase dashboard, then add the user record.`);
      setSaving(false);
      return;
    }

    // Create user profile record
    const { error: profileError } = await supabase.from('users').insert({
      id: authData.user.id,
      email,
      full_name: fullName,
      role,
      director_tag: directorTag || null,
    });

    if (profileError) {
      toast.error(profileError.message);
    } else {
      toast.success('User created');
      setEmail('');
      setFullName('');
      setPassword('');
      setRole('team_leader');
      setDirectorTag('');
      onSaved();
      onClose();
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add User</DialogTitle>
          <DialogDescription>
            Create a new system user. They will be able to log in with the provided credentials.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Full Name *</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="John Doe" />
          </div>
          <div className="space-y-1">
            <Label>Email *</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@impactoutsourcing.co.ke" />
          </div>
          <div className="space-y-1">
            <Label>Password *</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 8 characters" />
          </div>
          <div className="space-y-1">
            <Label>Role *</Label>
            <Select value={role} onValueChange={(v) => v && setRole(v as UserRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {roles.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Director Tag</Label>
            <Select value={directorTag} onValueChange={(v) => v && setDirectorTag(v as DirectorEnum)}>
              <SelectTrigger><SelectValue placeholder="None (not a director)" /></SelectTrigger>
              <SelectContent>
                {DIRECTORS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-neutral-400">Only set this for the 5 originating directors</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Creating...' : 'Create User'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
