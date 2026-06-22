import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Capinsta Admin",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="dark min-h-svh bg-background text-foreground">
      {children}
    </div>
  );
}
