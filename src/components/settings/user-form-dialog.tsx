'use client';

import { useState } from 'react';
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
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<UserRole>('team_leader');
  const [directorTag, setDirectorTag] = useState<DirectorEnum | ''>('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!email.trim() || !fullName.trim() || !pin.trim()) {
      toast.error('Email, name, and PIN are required');
      return;
    }
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      toast.error('PIN must be exactly 4 digits');
      return;
    }

    setSaving(true);

    try {
      // Get the current session token to authenticate the API call
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        toast.error('You must be logged in to create users');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email,
          password: pin + 'io',
          full_name: fullName,
          role,
          director_tag: directorTag || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to create user');
      } else {
        toast.success(`User "${data.user.full_name}" created successfully`);
        setEmail('');
        setFullName('');
        setPin('');
        setRole('team_leader');
        setDirectorTag('');
        onSaved();
        onClose();
      }
    } catch (err) {
      toast.error('Network error — please try again');
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
            <Label>4-Digit PIN *</Label>
            <Input
              type="password"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="e.g. 1234"
              className="text-center text-lg tracking-[0.5em] font-mono w-32"
            />
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
            <p className="text-xs text-muted-foreground">Only set this for the 5 originating directors</p>
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
