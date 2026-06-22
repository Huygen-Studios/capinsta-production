"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function AdminSignOut() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Sign out"
      onClick={async () => {
        await createClient().auth.signOut({ scope: "local" });
        router.replace("/admincapinsta11/login");
        router.refresh();
      }}
    >
      <LogOut aria-hidden="true" />
    </Button>
  );
}
