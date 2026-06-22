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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type UserAction =
  | "admin.role.assign"
  | "admin.role.revoke"
  | "admin.mfa.reset"
  | "user.sessions.revoke"
  | "user.delete.schedule"
  | "user.delete.cancel"
  | "quota.update";

export function AdminUserControls({
  targetId,
  canManageRoles,
  canScheduleDelete,
  canManageLimits,
  canResetMfa,
  deletionScheduled,
}: {
  targetId: string;
  canManageRoles: boolean;
  canScheduleDelete: boolean;
  canManageLimits: boolean;
  canResetMfa: boolean;
  deletionScheduled: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [role, setRole] = useState("support");
  const [pending, setPending] = useState<UserAction | null>(null);
  const [quotas, setQuotas] = useState({
    dailyCaptionMinutes: 60,
    dailyExportMinutes: 60,
    maxUploadDurationSeconds: 1800,
    maxConcurrentCaptionJobs: 2,
    maxConcurrentExportJobs: 1,
  });

  async function run(action: UserAction) {
    if (reason.trim().length < 8 || confirmation !== targetId || pending)
      return;
    setPending(action);
    const payload: Record<string, unknown> = { action, targetId, reason };
    if (action.startsWith("admin.role.")) payload.role = role;
    if (action === "user.delete.schedule") payload.graceDays = 30;
    if (action === "quota.update") payload.quotas = quotas;
    const response = await fetch("/api/admin/mutations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
      toast.success("User operation completed and audited.");
      router.refresh();
    }
    setPending(null);
  }

  const enabled =
    reason.trim().length >= 8 && confirmation === targetId && !pending;
  return (
    <Card className="mt-6 border-2">
      <CardHeader>
        <CardTitle>User administration</CardTitle>
        <CardDescription>
          Role, session, MFA, deletion, and quota changes require typed
          confirmation and are audited.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex max-w-3xl flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="user-admin-reason">Written reason</Label>
            <Textarea
              id="user-admin-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="user-admin-confirm">Type {targetId}</Label>
            <Input
              id="user-admin-confirm"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
        </div>
        {canManageRoles ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-52 flex-1">
              <Label>Administrative role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {[
                      "super_admin",
                      "operations",
                      "support",
                      "analyst",
                      "content_manager",
                    ].map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={!enabled}
              onClick={() => void run("admin.role.assign")}
            >
              Assign role
            </Button>
            <Button
              variant="destructive"
              disabled={!enabled}
              onClick={() => void run("admin.role.revoke")}
            >
              Revoke role
            </Button>
            <Button
              variant="outline"
              disabled={!enabled}
              onClick={() => void run("user.sessions.revoke")}
            >
              Revoke sessions
            </Button>
          </div>
        ) : null}
        {canResetMfa ? (
          <Button
            variant="destructive"
            disabled={!enabled}
            onClick={() => void run("admin.mfa.reset")}
          >
            Reset administrator MFA
          </Button>
        ) : null}
        {canScheduleDelete ? (
          <Button
            variant="destructive"
            disabled={!enabled}
            onClick={() =>
              void run(
                deletionScheduled
                  ? "user.delete.cancel"
                  : "user.delete.schedule",
              )
            }
          >
            {deletionScheduled
              ? "Cancel scheduled deletion"
              : "Schedule deletion in 30 days"}
          </Button>
        ) : null}
        {canManageLimits ? (
          <div className="grid gap-3 rounded-md border p-4 sm:grid-cols-2">
            {Object.entries(quotas).map(([key, value]) => (
              <div key={key} className="flex flex-col gap-2">
                <Label htmlFor={key}>{key.replace(/([A-Z])/g, " $1")}</Label>
                <Input
                  id={key}
                  type="number"
                  min={0}
                  value={value}
                  onChange={(event) =>
                    setQuotas((current) => ({
                      ...current,
                      [key]: Number(event.target.value),
                    }))
                  }
                />
              </div>
            ))}
            <Button
              className="sm:col-span-2"
              disabled={!enabled}
              onClick={() => void run("quota.update")}
            >
              Save per-user quotas
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
