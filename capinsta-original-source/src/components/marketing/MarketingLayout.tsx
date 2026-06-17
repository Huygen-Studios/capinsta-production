import Image from "next/image";
import Link from "next/link";
import { competitors } from "@/config/competitors";
import { siteConfig } from "@/config/site";

const productLinks = [
  ["Auto Subtitle Generator", "/auto-subtitle-generator"],
  ["AI Caption Generator", "/ai-caption-generator"],
  ["Animated Captions", "/animated-captions"],
  ["Word-by-Word Captions", "/word-by-word-captions"],
  ["Captions for Reels", "/captions-for-reels"],
  ["YouTube Shorts Caption Generator", "/youtube-shorts-caption-generator"],
  ["TikTok Caption Generator", "/tiktok-caption-generator"],
];

const alternativeLinks = competitors.map((competitor) => [`${competitor.name} Alternative`, `/alternatives/${competitor.slug}`]);

const companyLinks = [
  ["About", "/about"],
  ["Contact", "/contact"],
  ["Pricing", "/pricing"],
];

const legalLinks = [
  ["Privacy Policy", "/privacy-policy"],
  ["Terms of Service", "/terms-of-service"],
  ["Refund Policy", "/refund-policy"],
  ["Cookie Policy", "/cookie-policy"],
  ["Disclaimer", "/disclaimer"],
  ["Data Deletion", "/data-deletion"],
];

function FooterColumn({ title, links }: { title: string; links: string[][] }) {
  return (
    <div className="marketing-footer-column">
      <h2>{title}</h2>
      <ul>
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href}>{label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const year = new Date().getFullYear();

  return (
    <div className="marketing-site">
      <header className="marketing-nav">
        <Link className="marketing-logo" href="/" aria-label="Huygen Caps home">
          <Image src="/brand/huygen-icon-512.png" alt="" width={32} height={32} unoptimized />
          <span>{siteConfig.siteName}</span>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/auto-subtitle-generator">Product</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
        </nav>
        <Link className="marketing-nav-cta" href={siteConfig.appPath}>
          Start Creating Captions
        </Link>
      </header>
      <main>{children}</main>
      <footer className="marketing-footer">
        <div className="marketing-footer-brand">
          <Link className="marketing-logo" href="/">
            <Image src="/brand/huygen-icon-512.png" alt="" width={32} height={32} unoptimized />
            <span>{siteConfig.siteName}</span>
          </Link>
          <p>
            © {year} {siteConfig.companyName}. Huygen Caps is an auto subtitle generator and AI caption maker for creators,
            editors and short-form video teams.
          </p>
        </div>
        <FooterColumn title="Product" links={productLinks} />
        <FooterColumn title="Alternatives" links={alternativeLinks} />
        <FooterColumn title="Company" links={companyLinks} />
        <FooterColumn title="Legal" links={legalLinks} />
      </footer>
    </div>
  );
}
