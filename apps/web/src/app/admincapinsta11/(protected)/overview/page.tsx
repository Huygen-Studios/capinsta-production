import {
  Activity,
  BriefcaseBusiness,
  Clapperboard,
  KeyRound,
  LifeBuoy,
  SlidersHorizontal,
  Users,
  Video,
} from "lucide-react";
import Link from "next/link";
import { requireAdminSession } from "@/admin/auth";
import { getOverviewData } from "@/admin/data";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminMetricsPanel } from "@/components/admin/admin-metrics-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatBytes(value: unknown): string {
  const bytes = typeof value === "number" ? value : Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** unit).toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function metricDisplay(value: unknown): string {
  if (value === null || value === undefined) return "Unavailable";
  return String(value);
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ activity?: string }> }) {
  await requireAdminSession();
  const { activity = "all" } = await searchParams;
  const data = await getOverviewData();
  const recentActivity = data.recentActivity.filter((event) => activity === "all" || activityCategory(event.type) === activity);
  const captionTotal = Number(data.captions.total || 0);
  const captionSuccess = captionTotal
    ? Math.round((Number(data.captions.succeeded || 0) / captionTotal) * 100)
    : 0;
  const exportTotal = Number(data.exports.total || 0);
  const exportSuccess = exportTotal
    ? Math.round((Number(data.exports.succeeded || 0) / exportTotal) * 100)
    : 0;
  const backendStorage =
    isRecord(data.backendHealth.data) &&
    "storage" in data.backendHealth.data &&
    isRecord(data.backendHealth.data.storage)
      ? data.backendHealth.data.storage
      : null;
  const cards = [
    [
      "Registered users",
      data.users.total,
      data.users.seven === null || data.users.seven === undefined
        ? "New accounts unavailable"
        : `${data.users.seven} new in 7 days`,
      Users,
    ],
    [
      "Caption jobs",
      data.captions.total,
      `${data.captions.running} running`,
      Clapperboard,
    ],
    ["Export jobs", data.exports.total, `${data.exports.queued} queued`, Video],
    [
      "Projects",
      data.projects.total,
      `${data.projects.expiring} nearing expiry`,
      BriefcaseBusiness,
    ],
    ["Open support cases", data.support.open, "Needs triage", LifeBuoy],
    [
      "Backend",
      data.backendHealth.ok ? "Healthy" : "Unavailable",
      "Live health probe",
      Activity,
    ],
  ] as const;
  return (
    <>
      <AdminPageHeader
        title="Operational overview"
        description="Real account, job, storage, support, provider, and security signals from the Capinsta control plane."
      />
      <AdminMetricsPanel />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Transcription",
            detail: "Choose active caption provider and model",
            href: "/admincapinsta11/transcription",
            Icon: SlidersHorizontal,
          },
          {
            label: "Access control",
            detail: "Launch mode, beta approvals and permissions",
            href: "/admincapinsta11/access-control",
            Icon: KeyRound,
          },
        ].map(({ label, detail, href, Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 rounded-md border-2 p-4 transition-colors hover:bg-muted"
          >
            <Icon className="size-5 text-primary" aria-hidden="true" />
            <span>
              <span className="block font-semibold">{label}</span>
              <span className="text-xs text-muted-foreground">{detail}</span>
            </span>
          </Link>
        ))}
      </div>
      {data.degradedSources.length ? (
        <Alert className="mb-4 border-caution">
          <Activity aria-hidden="true" />
          <AlertTitle>Some overview data is temporarily unavailable</AlertTitle>
          <AlertDescription>
            Unavailable sources: {data.degradedSources.join(", ")}. Other
            administrative modules remain usable.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(([label, value, detail, Icon]) => (
          <Card key={label} className="border-2">
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardDescription>{label}</CardDescription>
                <CardTitle className="mt-1 font-display text-3xl">
                  {metricDisplay(value)}
                </CardTitle>
              </div>
              <Icon className="text-primary" aria-hidden="true" />
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {detail}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Caption reliability</CardTitle>
            <CardDescription>
              Completed jobs over all recorded jobs
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Progress value={captionSuccess} />
            <p className="text-2xl font-bold">{captionSuccess}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Export reliability</CardTitle>
            <CardDescription>
              Completed renders over all recorded exports
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Progress value={exportSuccess} />
            <p className="text-2xl font-bold">{exportSuccess}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Activity windows</CardTitle>
            <CardDescription>
              Database-backed last-seen activity
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3">
            {[
              ["Daily", data.users.dau],
              ["Weekly", data.users.wau],
              ["Monthly", data.users.mau],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="border-l-2 border-primary pl-3"
              >
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-bold">{metricDisplay(value)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
		<Card>
		  <CardHeader><CardTitle>Recent activity</CardTitle><CardDescription>Merged server-side product, account, project, access, and security events · newest first</CardDescription><div className="flex flex-wrap gap-1 pt-2">{["all","users","projects","uploads","captions","exports","access","security"].map((filter) => <Button asChild key={filter} size="sm" variant={activity === filter ? "default" : "outline"}><Link href={`?activity=${filter}`}>{filter[0].toUpperCase()+filter.slice(1)}</Link></Button>)}</div></CardHeader>
		  <CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Actor</TableHead><TableHead>Result</TableHead><TableHead>When</TableHead></TableRow></TableHeader><TableBody>{recentActivity.map((event) => <TableRow key={`${event.type}:${event.id}`}><TableCell className="font-semibold"><Link className="hover:underline" href={activityHref({ type: event.type, target: event.target, actor: event.actor })}>{event.type.replaceAll("_", " ")}</Link></TableCell><TableCell className="max-w-40 truncate font-mono text-xs">{event.actor ?? "System"}</TableCell><TableCell><Badge variant="outline">{event.status}</Badge></TableCell><TableCell title={new Date(event.createdAt).toLocaleString()}>{relativeTime(event.createdAt)}</TableCell></TableRow>)}</TableBody></Table>{!recentActivity.length ? <p className="p-6 text-sm text-muted-foreground">No recent activity matches this filter.</p> : null}</CardContent>
		</Card>
        <Card>
          <CardHeader>
            <CardTitle>Server storage</CardTitle>
            <CardDescription>
              Aggregate usage only; private filenames and paths are excluded.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ["Original media", "mediaAssetsBytes"],
              ["Uploads", "uploadsBytes"],
              ["Extracted audio", "extractedAudioBytes"],
              ["Proxies", "proxiesBytes"],
              ["Thumbnails / waveforms", "thumbnailsWaveformsBytes"],
              ["Render temporary", "temporaryRenderBytes"],
              ["Exports", "exportsBytes"],
              ["Logs", "logsBytes"],
              ["Orphaned", "orphanedBytes"],
              ["Free disk", "diskFreeBytes"],
            ].map(([label, key]) => (
              <div key={key} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 font-mono text-sm font-semibold">
                  {backendStorage ? formatBytes(backendStorage[key]) : "Unavailable"}
                </p>
              </div>
            ))}
            {backendStorage ? (
              <Badge variant="outline" className="w-fit">
                {String(backendStorage.diskPressure ?? "unknown")}
              </Badge>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Provider health</CardTitle>
            <CardDescription>
              Latest persisted check per provider component
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.providerHealth.length ? (
              data.providerHealth.map((item) => (
                <div
                  key={`${item.provider}:${item.component}`}
                  className="flex items-center justify-between border-b py-3 last:border-0"
                >
                  <div>
                    <p className="font-medium">{item.provider}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.component}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {item.status}{" "}
                    {item.latencyMs ? `· ${item.latencyMs}ms` : ""}
                  </Badge>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No provider health events have been recorded yet.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent audit activity</CardTitle>
            <CardDescription>Append-only administrative events</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentAudit.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>{event.action}</TableCell>
                    <TableCell>{event.targetType ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {event.success ? "Success" : "Failed"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!data.recentAudit.length ? (
              <p className="p-6 text-sm text-muted-foreground">
                No administrative actions recorded yet.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Last refreshed {data.refreshedAt.toLocaleString()}
      </p>
    </>
  );
}

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
}

function activityCategory(type: string) {
  if (type === "new_account") return "users";
  if (type.includes("project")) return "projects";
  if (type.includes("upload") || type.includes("media")) return "uploads";
  if (type.includes("caption")) return "captions";
  if (type.includes("export")) return "exports";
  if (type.includes("access") || type.includes("entitlement") || type.includes("user.")) return "access";
  return "security";
}

function activityHref({ type, target, actor }: { type: string; target: string | null; actor: string | null }) {
  if (type.includes("project") && target) return `/admincapinsta11/projects/${encodeURIComponent(target)}`;
  if (type.includes("caption") && target) return `/admincapinsta11/caption-jobs/${encodeURIComponent(target)}`;
  if (type.includes("export") && target) return `/admincapinsta11/exports/${encodeURIComponent(target)}`;
  if ((type === "new_account" || type.includes("access") || type.includes("user.")) && (target ?? actor)) return `/admincapinsta11/users/${encodeURIComponent(String(target ?? actor))}`;
  return "/admincapinsta11/audit-log";
}
