'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ResetPasswordPage() {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    // Verify the user has a valid recovery session
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSessionReady(true);
      } else {
        setError('No active recovery session. Please request a new password reset link.');
      }
    });
  }, []);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      setError('PIN must be exactly 4 digits');
      setLoading(false);
      return;
    }

    if (pin !== confirmPin) {
      setError('PINs do not match');
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      // PIN is padded with 'io' to meet Supabase's 6-char minimum (same as login)
      const { error: updateError } = await supabase.auth.updateUser({
        password: pin + 'io',
      });

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#f8fafc]">
      <div className="absolute top-0 left-0 right-0 h-1 bg-[#F5C518]" />
      <Card className="w-full max-w-sm shadow-lg border border-[#e5e7eb] rounded-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Reset Your PIN</CardTitle>
          <CardDescription>IO Finance Hub — Impact Outsourcing</CardDescription>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="text-center space-y-2">
              <p className="text-sm text-green-600 font-medium">PIN updated successfully!</p>
              <p className="text-sm text-muted-foreground">Redirecting to dashboard...</p>
            </div>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pin">New 4-digit PIN</Label>
                <Input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  placeholder="Enter new PIN"
                  value={pin}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setPin(val);
                  }}
                  required
                  disabled={!sessionReady}
                  className="text-center text-lg tracking-[0.5em] font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPin">Confirm PIN</Label>
                <Input
                  id="confirmPin"
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  placeholder="Confirm new PIN"
                  value={confirmPin}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setConfirmPin(val);
                  }}
                  required
                  disabled={!sessionReady}
                  className="text-center text-lg tracking-[0.5em] font-mono"
                />
              </div>
              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}
              <Button
                type="submit"
                className="w-full btn-gradient text-white"
                disabled={loading || !sessionReady}
              >
                {loading ? 'Updating...' : 'Set New PIN'}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                <a href="/login" className="underline hover:text-foreground">
                  Back to login
                </a>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
