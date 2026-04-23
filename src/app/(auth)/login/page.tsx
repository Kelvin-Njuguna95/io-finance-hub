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
    <div className="relative flex min-h-screen items-center justify-center bg-ink px-4">
      {/* Login stage radials — gold-tinted on ink per kit.css:157-160 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(900px_520px_at_70%_20%,color-mix(in_oklab,var(--gold)_16%,transparent)_0%,transparent_60%),radial-gradient(700px_500px_at_10%_90%,color-mix(in_oklab,var(--gold)_8%,transparent)_0%,transparent_60%)]"
      />
      <Card className="relative w-full max-w-sm border border-paper/10 bg-paper/[0.04] shadow-overlay backdrop-blur">
        <CardHeader className="items-center text-center">
          <div
            aria-hidden
            className="mx-auto flex size-12 items-center justify-center rounded-[var(--radius-lg)] bg-gold font-mono text-[18px] font-medium text-gold-foreground shadow-overlay ring-1 ring-inset ring-paper/10"
          >
            IO
          </div>
          <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-paper/60">
            Impact Outsourcing
          </p>
          <CardTitle className="mt-1 text-xl text-paper">Finance Hub</CardTitle>
          <CardDescription className="text-paper/65">Sign in to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-paper/80">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@impactoutsourcing.co.ke"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="border-paper/10 bg-paper/[0.06] text-paper placeholder:text-paper/40 focus-visible:border-gold/50 focus-visible:ring-gold/20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pin" className="text-paper/80">PIN</Label>
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
                className="text-center font-mono text-lg tracking-[0.5em] border-paper/10 bg-paper/[0.06] text-paper placeholder:text-paper/40 focus-visible:border-gold/50 focus-visible:ring-gold/20"
              />
            </div>
            {error && (
              <p id="login-error" role="alert" className="text-sm text-danger-soft-foreground">
                {error}
              </p>
            )}
            <Button
              type="submit"
              variant="gold"
              className="w-full"
              disabled={loading}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
            <div className="text-center">
              {resetSent ? (
                <p className="text-sm text-success-soft-foreground">
                  Reset link sent! Check your email.
                </p>
              ) : (
                <button
                  type="button"
                  className="text-sm text-paper/55 underline transition-colors hover:text-paper/80"
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
