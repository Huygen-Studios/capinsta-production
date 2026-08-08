"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function AdminSupportControls({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("investigating");
  const [priority, setPriority] = useState("normal");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [links, setLinks] = useState({
    userId: "",
    projectId: "",
    captionJobId: "",
    exportJobId: "",
  });

  async function submit(action: "support.update" | "support.note") {
    const response = await fetch("/api/admin/mutations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        action === "support.note"
          ? { action, targetId: caseId, reason, note }
          : {
              action,
              targetId: caseId,
              reason,
              status,
              priority,
              assigneeUserId: assigneeUserId || null,
              userId: links.userId || null,
              projectId: links.projectId || null,
              captionJobId: links.captionJobId || null,
              exportJobId: links.exportJobId || null,
            },
      ),
    });
    if (!response.ok) toast.error("Support case update failed.");
    else {
      toast.success("Support case updated and history recorded.");
      router.refresh();
    }
  }

  return (
    <Card className="mt-6 border-2">
      <CardHeader>
        <CardTitle>Case management</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {[
                  "new",
                  "investigating",
                  "waiting_for_user",
                  "resolved",
                  "closed",
                ].map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Priority</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {["low", "normal", "high", "urgent"].map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="case-assignee">Assignee user ID</Label>
          <Input
            id="case-assignee"
            value={assigneeUserId}
            onChange={(event) => setAssigneeUserId(event.target.value)}
          />
        </div>
        {Object.entries(links).map(([key, value]) => (
          <div key={key} className="flex flex-col gap-2">
            <Label htmlFor={key}>{key}</Label>
            <Input
              id={key}
              value={value}
              onChange={(event) =>
                setLinks((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }
            />
          </div>
        ))}
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="case-reason">Change reason</Label>
          <Textarea
            id="case-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <Button
          disabled={reason.trim().length < 8}
          onClick={() => void submit("support.update")}
        >
          Save case changes
        </Button>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="case-note">Internal note</Label>
          <Textarea
            id="case-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button
            variant="outline"
            disabled={note.trim().length < 1 || reason.trim().length < 8}
            onClick={() => void submit("support.note")}
          >
            Add private note
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
