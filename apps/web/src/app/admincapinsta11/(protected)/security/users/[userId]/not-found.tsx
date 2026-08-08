import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function NotFound() { return <div className="mx-auto max-w-xl rounded-md border-2 p-8 text-center"><h1 className="font-display text-2xl">Security user not found</h1><p className="mt-2 text-sm text-muted-foreground">The UUID is invalid or the account no longer exists.</p><Button asChild className="mt-5"><Link href="/admincapinsta11/security">Back to Security</Link></Button></div>; }
