import {
  Activity,
  BriefcaseBusiness,
  Clapperboard,
  Flag,
  Gauge,
  LifeBuoy,
	ChartNoAxesCombined,
  LockKeyhole,
  KeyRound,
  ScrollText,
  Shield,
  SlidersHorizontal,
  Users,
  Video,
} from "lucide-react";
import Link from "next/link";
import type { AdminContext } from "@/admin/auth";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { AdminSignOut } from "./admin-sign-out";
import type { SiteAccessMode } from "@/access/permissions";

const navigation = [
  ["Overview", "overview", Gauge],
  ["Users", "users", Users],
  ["Access control", "access-control", KeyRound],
  ["Transcription", "transcription", SlidersHorizontal],
  ["Caption jobs", "caption-jobs", Clapperboard],
  ["Exports", "exports", Video],
  ["Projects", "projects", BriefcaseBusiness],
  ["Feedback", "feedback", LifeBuoy],
  ["Customer insights", "insights", ChartNoAxesCombined],
  ["System health", "system", Activity],
  ["Feature flags", "feature-flags", Flag],
  ["Audit log", "audit-log", ScrollText],
  ["Security", "security", Shield],
] as const;

export function AdminShell({
  context,
  children,
  siteMode,
}: {
  context: AdminContext;
  children: React.ReactNode;
  siteMode: SiteAccessMode;
}) {
  return (
    <div className="admin-shell grid min-h-svh grid-cols-1 bg-background lg:grid-cols-[252px_minmax(0,1fr)]">
      <aside className="border-b-2 border-border bg-sidebar lg:sticky lg:top-0 lg:h-svh lg:border-b-0 lg:border-r-2">
        <div className="flex h-16 items-center gap-3 px-5">
          <div className="grid size-9 place-items-center rounded-sm border-2 border-[var(--neo-black)] bg-primary text-primary-foreground shadow-[3px_3px_0_var(--shadow-strong)]">
            <LockKeyhole aria-hidden="true" />
          </div>
          <div>
            <p className="font-display font-bold">Capinsta Admin</p>
            <p className="text-xs text-muted-foreground">
              Operations control plane
            </p>
          </div>
        </div>
        <Separator />
        <nav
          aria-label="Admin navigation"
          className="grid grid-cols-2 gap-1 p-3 sm:grid-cols-5 lg:grid-cols-1"
        >
          {navigation.map(([label, href, Icon]) => (
            <Link
              key={href}
              href={`/admincapinsta11/${href}`}
              className="flex items-center gap-3 rounded-sm border-2 border-transparent px-3 py-2 text-sm font-bold text-muted-foreground transition-colors hover:border-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex min-h-16 items-center gap-4 border-b-2 border-border bg-card px-4 shadow-[0_3px_0_var(--shadow-strong)] md:px-6">
		  <Badge className="hidden md:inline-flex">Mode: {siteMode.replace("_", " ")}</Badge>
          <form action="/admincapinsta11/users" className="max-w-lg flex-1">
            <Input
              name="q"
              aria-label="Global admin search"
              placeholder="Search users, jobs, projects…"
            />
          </form>
          <Badge variant="outline" className="hidden sm:inline-flex">
            <span
              className="mr-2 size-2 rounded-full bg-constructive"
              aria-hidden="true"
            />
            AAL2 verified
          </Badge>
          <div className="text-right">
            <p className="max-w-44 truncate text-sm font-semibold">
              {context.email ?? context.userId}
            </p>
            <p className="text-xs text-muted-foreground">
              {context.roleKeys.join(", ")}
            </p>
          </div>
          <AdminSignOut />
        </header>
        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
