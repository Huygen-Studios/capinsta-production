import Link from "next/link";
import MarketingLayout from "@/components/marketing/MarketingLayout";

export default function NotFound() {
  return (
    <MarketingLayout>
      <section className="marketing-hero compact">
        <p className="marketing-eyebrow">404</p>
        <h1>Page not found</h1>
        <p>The page you are looking for is not part of the public Huygen Caps launch site.</p>
        <Link className="marketing-button primary" href="/">
          Go Home
        </Link>
      </section>
    </MarketingLayout>
  );
}
