"use client";

import { LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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

export function AdminLoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });
    const result: unknown = await response.json();
    const next =
      result &&
      typeof result === "object" &&
      "next" in result &&
      typeof Reflect.get(result, "next") === "string"
        ? String(Reflect.get(result, "next"))
        : null;
    const message =
      result &&
      typeof result === "object" &&
      "error" in result &&
      typeof Reflect.get(result, "error") === "string"
        ? String(Reflect.get(result, "error"))
        : "Unable to sign in.";
    if (!response.ok || !next) {
      setError(message);
      setLoading(false);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <main className="grid min-h-svh place-items-center bg-[radial-gradient(circle_at_top,color-mix(in_srgb,var(--primary)_16%,transparent),transparent_40%)] p-6">
      <Card className="w-full max-w-md border-2 shadow-[5px_5px_0_color-mix(in_srgb,var(--primary)_65%,transparent)]">
        <CardHeader>
          <div className="mb-3 grid size-11 place-items-center rounded-md border bg-primary text-primary-foreground">
            <LockKeyhole aria-hidden="true" />
          </div>
          <CardTitle className="font-display text-2xl">
            Capinsta Admin
          </CardTitle>
          <CardDescription>
            Restricted operations access. Multi-factor verification is required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="admin-password">Password</Label>
              <Input
                id="admin-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={loading}>
              {loading ? "Checking access…" : "Continue securely"}
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Access attempts are monitored and temporarily rate limited. Errors
              are intentionally generic.
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
