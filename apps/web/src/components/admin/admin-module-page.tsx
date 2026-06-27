import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import type { AdminPermission } from "@/admin/permissions";
import { requireAdminPermission } from "@/admin/auth";
import { ADMIN_PAGE_SIZE, getAdminModuleRows } from "@/admin/data";
import { AdminPageHeader } from "./admin-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export async function AdminModulePage({
  module,
  title,
  description,
  permission,
  searchParams,
  detailLinks = false,
}: {
  module: string;
  title: string;
  description: string;
  permission: AdminPermission;
  searchParams: Promise<{ page?: string; q?: string }>;
  detailLinks?: boolean;
}) {
  await requireAdminPermission(permission);
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const data = await getAdminModuleRows({ module, page, query: params.q });
  const columns = data.rows[0] ? Object.keys(data.rows[0]) : [];
  const totalPages = Math.max(1, Math.ceil(data.total / ADMIN_PAGE_SIZE));

  return (
    <>
      <AdminPageHeader title={title} description={description} />
      <form className="mb-4 flex max-w-xl gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            name="q"
            defaultValue={params.q}
            placeholder={`Search ${title.toLowerCase()}…`}
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <Card className="overflow-hidden border-2 shadow-[3px_3px_0_color-mix(in_srgb,var(--primary)_45%,transparent)]">
        <CardContent className="p-0">
          {data.rows.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((column) => (
                      <TableHead key={column}>{humanize(column)}</TableHead>
                    ))}
                    {detailLinks ? <TableHead>Actions</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((row, rowIndex) => {
                    const detailHref =
                      row.id === null || row.id === undefined
                        ? null
                        : `/admincapinsta11/${module}/${encodeURIComponent(String(row.id))}`;
                    return (
                      <TableRow key={String(row.id ?? rowIndex)}>
                        {columns.map((column) => (
                          <TableCell
                            key={column}
                            className="max-w-72 truncate font-mono text-xs"
                          >
                            {column === "id" && detailLinks && detailHref ? (
                              <Link
                                className="font-semibold text-primary hover:underline"
                                href={detailHref}
                              >
                                {formatValue(row[column])}
                              </Link>
                            ) : isStatus(column) ? (
                              <Badge variant="outline">
                                {formatValue(row[column])}
                              </Badge>
                            ) : (
                              formatValue(row[column])
                            )}
                          </TableCell>
                        ))}
                        {detailLinks ? (
                          <TableCell className="whitespace-nowrap">
                            {detailHref ? (
                              <Button asChild size="sm" variant="outline">
                                <Link href={detailHref}>Manage</Link>
                              </Button>
                            ) : (
                              formatValue(null)
                            )}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="grid min-h-64 place-items-center p-8 text-center">
              <div>
                <p className="font-display text-lg font-semibold">
                  No records found
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  This module is connected to production data and currently has
                  no matching records.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <p>{data.total.toLocaleString()} total records</p>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline" disabled={page <= 1}>
            <Link
              aria-disabled={page <= 1}
              href={`?page=${Math.max(1, page - 1)}&q=${encodeURIComponent(params.q ?? "")}`}
            >
              <ChevronLeft aria-hidden="true" /> Previous
            </Link>
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button
            asChild
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
          >
            <Link
              aria-disabled={page >= totalPages}
              href={`?page=${Math.min(totalPages, page + 1)}&q=${encodeURIComponent(params.q ?? "")}`}
            >
              Next <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </>
  );
}

function humanize(value: string) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function isStatus(column: string) {
  return [
    "status",
    "state",
    "severity",
    "role",
    "enabled",
    "active",
    "success",
  ].includes(column);
}

function formatValue(value: string | number | boolean | null) {
  if (value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value))
    return new Date(value).toLocaleString();
  return String(value);
}
