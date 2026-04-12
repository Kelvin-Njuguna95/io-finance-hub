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
    <div className="relative flex min-h-screen items-center justify-center bg-[#0a0f1e] px-4">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#00d4ff] to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(800px_400px_at_50%_-10%,oklch(0.78_0.18_210_/_0.12)_0%,transparent_60%),radial-gradient(600px_300px_at_80%_100%,oklch(0.84_0.18_88_/_0.06)_0%,transparent_60%)]"
      />
      <Card className="relative w-full max-w-sm border border-white/10 bg-white/[0.04] shadow-elev-3 backdrop-blur">
        <CardHeader className="items-center text-center">
          <div
            aria-hidden
            className="mx-auto flex size-12 items-center justify-center rounded-xl bg-[#F5C518] text-[14px] font-bold text-[#0a0f1e] shadow-elev-2 ring-1 ring-white/10"
          >
            IO
          </div>
          <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">
            Impact Outsourcing
          </p>
          <CardTitle className="mt-1 text-xl text-white">Finance Hub</CardTitle>
          <CardDescription className="text-white/50">Sign in to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-white/70">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@impactoutsourcing.co.ke"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="border-white/10 bg-white/[0.06] text-white placeholder:text-white/30 focus-visible:border-[#00d4ff]/50 focus-visible:ring-[#00d4ff]/20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pin" className="text-white/70">PIN</Label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                autoComplete="current-password"
                placeholder="4-digit PIN"
                value={pin}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setPin(val);
                }}
                required
                aria-describedby={error ? 'login-error' : undefined}
                aria-invalid={Boolean(error) || undefined}
                className="text-center font-mono text-lg tracking-[0.5em] border-white/10 bg-white/[0.06] text-white placeholder:text-white/30 focus-visible:border-[#00d4ff]/50 focus-visible:ring-[#00d4ff]/20"
              />
            </div>
            {error && (
              <p id="login-error" role="alert" className="text-sm text-[oklch(0.72_0.19_25)]">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={loading}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
            <div className="text-center">
              {resetSent ? (
                <p className="text-sm text-[oklch(0.72_0.16_158)]">
                  Reset link sent! Check your email.
                </p>
              ) : (
                <button
                  type="button"
                  className="text-sm text-white/40 underline transition-colors hover:text-white/70"
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
