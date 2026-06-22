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

export function AdminMutationPanel({
  action,
  targetId,
  title,
  description,
  confirmText,
}: {
  action: "user.suspend" | "user.restore" | "security.unblock";
  targetId: string;
  title: string;
  description: string;
  confirmText: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (confirmation !== confirmText || pending) return;
    setPending(true);
    const response = await fetch("/api/admin/mutations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      setPending(false);
      return;
    }
    toast.success("Operation completed and audited.");
    router.refresh();
    setPending(false);
  }

  return (
    <Card className="mt-6 border-2 border-destructive/50">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex max-w-2xl flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${action}-reason`}>Written reason</Label>
            <Textarea
              id={`${action}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={8}
              maxLength={1000}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${action}-confirm`}>
              Type {confirmText} to confirm
            </Label>
            <Input
              id={`${action}-confirm`}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              required
            />
          </div>
          <Button
            type="submit"
            variant="destructive"
            disabled={
              pending ||
              confirmation !== confirmText ||
              reason.trim().length < 8
            }
          >
            {pending ? "Applying…" : title}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
