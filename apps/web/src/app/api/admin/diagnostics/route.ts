import { NextResponse } from "next/server";
import { adminBackendFetch } from "@/admin/backend";

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId || jobId.length > 200)
    return NextResponse.json({ error: "Invalid job." }, { status: 400 });
  const response = await adminBackendFetch({
    path: `/api/admin/jobs/${encodeURIComponent(jobId)}/diagnostics`,
    permission: "caption_jobs.download_diagnostics",
  });
  const body = await response.arrayBuffer();
  return new NextResponse(body, {
    status: response.status,
    headers: {
      "Content-Type":
        response.headers.get("content-type") ?? "application/json",
      "Content-Disposition":
        response.headers.get("content-disposition") ??
        `attachment; filename="caption-job-${jobId}-diagnostics.json"`,
    },
  });
}
