import {
  Activity,
  BriefcaseBusiness,
  Clapperboard,
  Flag,
  Gauge,
  LifeBuoy,
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

const navigation = [
  ["Overview", "overview", Gauge],
  ["Users", "users", Users],
  ["Access control", "access-control", KeyRound],
  ["Transcription", "transcription", SlidersHorizontal],
  ["Caption jobs", "caption-jobs", Clapperboard],
  ["Exports", "exports", Video],
  ["Projects", "projects", BriefcaseBusiness],
  ["Feedback", "feedback", LifeBuoy],
  ["System health", "system", Activity],
  ["Feature flags", "feature-flags", Flag],
  ["Audit log", "audit-log", ScrollText],
  ["Security", "security", Shield],
] as const;

export function AdminShell({
  context,
  children,
}: {
  context: AdminContext;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-shell grid min-h-svh grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="border-b bg-sidebar lg:sticky lg:top-0 lg:h-svh lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center gap-3 px-5">
          <div className="grid size-9 place-items-center rounded-md border bg-primary text-primary-foreground shadow-[2px_2px_0_var(--foreground)]">
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
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex min-h-16 items-center gap-4 border-b bg-background px-4 md:px-6">
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
