"use client";

import { ShieldCheck } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type MfaSetup = {
  mode: "challenge" | "enroll";
  factorId: string;
  qrCode?: string;
  secret?: string;
};

export function AdminMfaForm() {
  const router = useRouter();
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/admin/auth/mfa", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error ?? "Unable to load MFA.");
        setSetup(result);
      })
      .catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : "Unable to load MFA.",
        ),
      );
  }, []);

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setup || loading) return;
    setLoading(true);
    setError(null);
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    const response = await fetch("/api/admin/auth/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, factorId: setup.factorId }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "Verification failed.");
      setLoading(false);
      return;
    }
    router.replace(result.next);
    router.refresh();
  }

  return (
    <main className="grid min-h-svh place-items-center bg-background bg-grid-paper p-6">
      <Card className="w-full max-w-lg border-2 shadow-[5px_5px_0_var(--shadow-strong)]">
        <CardHeader>
          <ShieldCheck className="mb-3 text-primary" aria-hidden="true" />
          <CardTitle className="font-display text-2xl">
            Verify administrator access
          </CardTitle>
          <CardDescription>
            {setup?.mode === "enroll"
              ? "Enroll a TOTP authenticator before continuing."
              : "Enter the current six-digit code from your authenticator."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {!setup && !error ? <Skeleton className="h-48 w-full" /> : null}
          {setup?.mode === "enroll" && setup.qrCode ? (
            <div className="flex flex-col items-center gap-3 rounded-sm border-2 border-border bg-card p-4 text-foreground">
              <Image
                src={setup.qrCode}
                alt="TOTP enrollment QR code"
                width={200}
                height={200}
                unoptimized
              />
              <p className="max-w-full break-all font-mono text-xs">
                {setup.secret}
              </p>
            </div>
          ) : null}
          <form className="flex flex-col gap-4" onSubmit={verify}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="mfa-code">Authentication code</Label>
              <Input
                id="mfa-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                disabled={!setup}
                className="text-center font-mono text-xl tracking-[0.45em]"
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={!setup || loading}>
              {loading ? "Verifying…" : "Verify and continue"}
            </Button>
          </form>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Store recovery information offline. Capinsta support cannot reveal
            TOTP secrets. Administrative recovery requires another active
            super-admin and is audited.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
