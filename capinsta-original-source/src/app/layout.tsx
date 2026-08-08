import type { Metadata } from "next";
import { createMetadata, siteConfig } from "@/config/site";
import "./globals.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/700.css";
import "@fontsource/poppins/800.css";
import "@fontsource/poppins/900.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/900.css";
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/800.css";
import "@fontsource/montserrat/900.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/700.css";
import "@fontsource/oswald/700.css";
import "@fontsource/anton/400.css";
import "@fontsource/bebas-neue/400.css";

export const metadata: Metadata = {
  ...createMetadata({
    title: siteConfig.defaultTitle,
    description: siteConfig.defaultDescription,
    path: "/",
  }),
  metadataBase: new URL(siteConfig.domain),
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/brand/huygen-icon-512.png",
  },
  manifest: "/manifest.json",
};

const criticalShellCss = `
:root{--bg-app:#050505;--bg-panel:#0b0b0b;--bg-panel-dark:#050505;--bg-panel-raised:#111;--bg-toolbar:#050505;--bg-panel-header:#050505;--panel-header-text:#f5f1e8;--bg-control:#050505;--text-primary:#f5f1e8;--text-muted:#a8a0aa;--border:#3a3a3a;--border-strong:#e8e3d7;--accent:#a970ff;--accent-hover:#c7a4ff;--button-primary-text:#050505;--shadow-hard:4px 4px 0 #000;--shadow-hard-small:2px 2px 0 #000}
:root[data-theme="light"]{--bg-app:#f7f0e4;--bg-panel:#fffdf8;--bg-panel-dark:#f1e7d6;--bg-panel-raised:#fff;--bg-toolbar:#fffdf8;--bg-panel-header:#f1e7d6;--panel-header-text:#171217;--bg-control:#fff;--text-primary:#171217;--text-muted:#51475a;--border:#b9a992;--border-strong:#2b241f;--accent:#7c3aed;--accent-hover:#4c1d95;--button-primary-text:#fff;--shadow-hard:4px 4px 0 #101010;--shadow-hard-small:2px 2px 0 #101010}
html,body{margin:0;min-height:100%;overflow-x:hidden;background:var(--bg-app);color:var(--text-primary)}
body{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}
button,input,select,textarea{font:inherit}
img{max-width:100%;height:auto}
.flex{display:flex}.inline-flex{display:inline-flex}.inline-grid{display:inline-grid}.grid{display:grid}.hidden{display:none}
.h-screen{height:100vh}.w-screen{width:100vw}.h-full{height:100%}.w-full{width:100%}.h-12{height:3rem}.h-8{height:2rem}.min-h-0{min-height:0}.min-w-0{min-width:0}.min-h-\\[420px\\]{min-height:420px}
.flex-col{flex-direction:column}.flex-1{flex:1 1 0%}.shrink-0{flex-shrink:0}.items-center{align-items:center}.justify-center{justify-content:center}.justify-between{justify-content:space-between}.place-items-center{place-items:center}
.overflow-hidden{overflow:hidden}.overflow-auto{overflow:auto}.overflow-y-auto{overflow-y:auto}.relative{position:relative}.absolute{position:absolute}.inset-0{inset:0}.z-20{z-index:20}
.gap-1{gap:.25rem}.gap-2{gap:.5rem}.gap-3{gap:.75rem}.gap-4{gap:1rem}.space-y-3>:not([hidden])~:not([hidden]){margin-top:.75rem}.space-y-4>:not([hidden])~:not([hidden]){margin-top:1rem}
.p-1{padding:.25rem}.p-2{padding:.5rem}.p-3{padding:.75rem}.p-4{padding:1rem}.px-2{padding-left:.5rem;padding-right:.5rem}.px-3{padding-left:.75rem;padding-right:.75rem}.px-4{padding-left:1rem;padding-right:1rem}.py-1{padding-top:.25rem;padding-bottom:.25rem}.py-2{padding-top:.5rem;padding-bottom:.5rem}.py-3{padding-top:.75rem;padding-bottom:.75rem}.mr-2{margin-right:.5rem}.ml-2{margin-left:.5rem}.mx-auto{margin-left:auto;margin-right:auto}
.w-\\[86px\\]{width:86px}.max-w-sm{max-width:24rem}.max-w-full{max-width:100%}.max-h-full{max-height:100%}.grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.text-center{text-align:center}.text-xs{font-size:.75rem;line-height:1rem}.text-sm{font-size:.875rem;line-height:1.25rem}.text-\\[10px\\]{font-size:10px}.text-\\[11px\\]{font-size:11px}.font-bold{font-weight:700}.font-black{font-weight:900}.uppercase{text-transform:uppercase}.rounded{border-radius:.25rem}.border{border-width:1px}.border-b{border-bottom:1px solid var(--border)}.border-r{border-right:1px solid var(--border)}
.brand-logo{display:block;width:30px!important;height:30px!important;max-width:30px!important;max-height:30px!important;object-fit:contain;box-sizing:border-box}
.empty-logo{display:block;width:96px!important;max-width:96px!important;height:auto!important;object-fit:contain}
.toolbar-shell{min-height:48px;background:var(--bg-toolbar);color:var(--text-primary);border-bottom:1px solid var(--border-strong)}
.panel{background:var(--bg-panel);color:var(--text-primary);border:1px solid var(--border-strong);overflow:hidden}
.panel-header{display:flex;align-items:center;min-height:28px;padding:5px 8px;background:var(--bg-panel-header);color:var(--panel-header-text);border-bottom:1px solid var(--border-strong);font-size:11px;font-weight:900;text-transform:uppercase}
.brand-mark{display:flex;align-items:center;gap:8px;color:var(--text-primary)}.brand-name{font-size:14px;font-weight:900;white-space:nowrap}
.btn-primary{background:var(--accent);color:var(--button-primary-text);border:2px solid var(--border-strong);padding:7px 14px;border-radius:2px;font-size:12px;font-weight:900;cursor:pointer;box-shadow:var(--shadow-hard-small)}
.btn-ghost{background:var(--bg-control);color:var(--text-muted);border:1px solid var(--border-strong);padding:5px 10px;border-radius:2px;font-size:11px;font-weight:800;cursor:pointer}
:root[data-theme="light"] .btn-ghost{background:var(--bg-control)!important;color:var(--text-muted);border-color:var(--border-strong)}
.icon-button{display:inline-grid;place-items:center;min-width:28px;height:28px;padding:0 6px;color:var(--text-muted);background:transparent;border:2px solid transparent;border-radius:2px;cursor:pointer}
.btn-primary:disabled,.btn-ghost:disabled,.icon-button:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
.control-input{width:100%;min-height:34px;border:2px solid var(--border);border-radius:2px;background:var(--bg-control);color:var(--text-primary);padding:6px 8px;font-size:12px;outline:none}
.brutal-box{background:var(--bg-panel-raised);border:1px solid var(--border-strong);border-radius:4px}.brutal-empty{background:var(--bg-panel-raised);border:1px dashed var(--border-strong);border-radius:4px}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: criticalShellCss }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
