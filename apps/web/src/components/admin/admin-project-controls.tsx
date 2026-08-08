"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function AdminProjectControls({
  projectId,
  retentionHold,
}: {
  projectId: string;
  retentionHold: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(7);
  async function run(mode: "extend" | "hold" | "release") {
    const response = await fetch("/api/admin/mutations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "project.retention",
        targetId: projectId,
        mode,
        days,
        reason,
      }),
    });
    if (!response.ok) toast.error("Retention operation failed.");
    else {
      toast.success("Retention state updated and audited.");
      router.refresh();
    }
  }
  return (
    <Card className="mt-6 border-2">
      <CardHeader>
        <CardTitle>Retention controls</CardTitle>
      </CardHeader>
      <CardContent className="flex max-w-2xl flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="retention-reason">Written reason</Label>
          <Textarea
            id="retention-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="retention-days">Extension days</Label>
          <Input
            id="retention-days"
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={reason.trim().length < 8}
            onClick={() => void run("extend")}
          >
            Extend expiry
          </Button>
          <Button
            variant="outline"
            disabled={reason.trim().length < 8}
            onClick={() => void run(retentionHold ? "release" : "hold")}
          >
            {retentionHold ? "Remove retention hold" : "Add retention hold"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          These controls affect server metadata and temporary backend assets
          only. They cannot delete browser-local files.
        </p>
      </CardContent>
    </Card>
  );
}
