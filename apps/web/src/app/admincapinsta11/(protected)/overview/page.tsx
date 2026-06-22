import {
  Activity,
  BriefcaseBusiness,
  Clapperboard,
  LifeBuoy,
  Users,
  Video,
} from "lucide-react";
import { requireAdminSession } from "@/admin/auth";
import { getOverviewData } from "@/admin/data";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Badge } from "@/components/ui/badge";
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

export default async function OverviewPage() {
  await requireAdminSession();
  const data = await getOverviewData();
  const captionTotal = Number(data.captions.total || 0);
  const captionSuccess = captionTotal
    ? Math.round((Number(data.captions.succeeded || 0) / captionTotal) * 100)
    : 0;
  const exportTotal = Number(data.exports.total || 0);
  const exportSuccess = exportTotal
    ? Math.round((Number(data.exports.succeeded || 0) / exportTotal) * 100)
    : 0;
  const cards = [
    [
      "Registered users",
      data.users.total,
      `${data.users.seven} new in 7 days`,
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
                  {String(value)}
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
                <p className="text-xl font-bold">{String(value)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
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
