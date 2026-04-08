'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      setError('PIN must be exactly 4 digits');
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      // PIN is padded to meet Supabase's 6-char minimum
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password: pin + 'io',
      });

      if (authError) {
        if (authError.message.includes('Invalid login')) {
          setError('Invalid email or PIN');
        } else {
          setError(authError.message);
        }
        setLoading(false);
        return;
      }

      setTimeout(() => {
        window.location.href = '/';
      }, 200);
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
          <CardTitle className="text-xl">IO Finance Hub</CardTitle>
          <CardDescription>Impact Outsourcing Limited</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@impactoutsourcing.co.ke"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pin">PIN</Label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                placeholder="4-digit PIN"
                value={pin}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setPin(val);
                }}
                required
                className="text-center text-lg tracking-[0.5em] font-mono"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <Button type="submit" className="w-full btn-gradient text-white" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
            <div className="text-center">
              {resetSent ? (
                <p className="text-sm text-green-600">Reset link sent! Check your email.</p>
              ) : (
                <button
                  type="button"
                  className="text-sm text-muted-foreground underline hover:text-foreground"
                  disabled={resetLoading}
                  onClick={async () => {
                    if (!email) {
                      setError('Enter your email first');
                      return;
                    }
                    setResetLoading(true);
                    setError('');
                    const supabase = createClient();
                    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
                      redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
                    });
                    if (resetError) {
                      setError(resetError.message);
                    } else {
                      setResetSent(true);
                    }
                    setResetLoading(false);
                  }}
                >
                  {resetLoading ? 'Sending...' : 'Forgot PIN?'}
                </button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
