import { Badge } from "@/components/ui/badge";

export function AdminPageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-6 flex flex-col gap-2 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Capinsta operations
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          {title}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      <Badge variant="outline">Live data</Badge>
    </div>
  );
}
