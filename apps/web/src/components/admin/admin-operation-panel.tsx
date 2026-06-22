"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";

export function AdminOperationPanel({
  actions,
  targetId,
}: {
  actions: Array<{ action: string; label: string; destructive?: boolean }>;
  targetId: string;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  if (actions.length === 0) return null;

  async function run(action: string) {
    if (reason.trim().length < 8 || confirmation !== targetId || pending)
      return;
    setPending(action);
    const response = await fetch("/api/admin/operations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ action, targetId, reason }),
    });
    const result: unknown = await response.json();
    if (response.status === 428) {
      router.push("/admincapinsta11/mfa?step_up=1");
      return;
    }
    if (!response.ok) {
      toast.error(
        result && typeof result === "object" && "error" in result
          ? String(Reflect.get(result, "error"))
          : "Operation failed.",
      );
    } else {
      toast.success("Operation completed and audited.");
      router.refresh();
    }
    setPending(null);
  }

  return (
    <Card className="mt-6 border-2">
      <CardHeader>
        <CardTitle>Administrative operations</CardTitle>
        <CardDescription>
          Every operation requires fresh MFA, a written reason, typed
          confirmation, idempotency, and an audit record.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex max-w-2xl flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="operation-reason">Written reason</Label>
          <Textarea
            id="operation-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={8}
            maxLength={1000}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="operation-confirm">Type {targetId} to confirm</Label>
          <Input
            id="operation-confirm"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((item) => (
            <Button
              key={item.action}
              variant={item.destructive ? "destructive" : "outline"}
              disabled={
                Boolean(pending) ||
                reason.trim().length < 8 ||
                confirmation !== targetId
              }
              onClick={() => void run(item.action)}
            >
              {pending === item.action ? "Working…" : item.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
