/**
 * Generate Capinsta favicon set, PWA icons, and Open Graph image from the
 * supplied logo masters.
 *
 * Run with:  bun run scripts/generate-brand-assets.ts
 *
 * Idempotent — safe to re-run. Overwrites the derived assets only; never
 * touches the original masters in public/logos/capinsta.
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const PUBLIC = path.resolve(import.meta.dirname, "..", "public");
const MARK = path.join(PUBLIC, "logos", "capinsta", "symbol.png");
const ICONS_DIR = path.join(PUBLIC, "icons");
const OG_DIR = path.join(PUBLIC, "open-graph");

/** Capinsta brand purple (matches the supplied logo mark). */
const BRAND_PURPLE = "#7c3aed";
const BRAND_BLACK = "#0b0b0f";

const iconSizes = [
  16, 32, 36, 48, 57, 60, 70, 72, 76, 96, 114, 120, 144, 150, 152, 180, 192,
  310, 512,
];

/** Map each generated file to its naming convention (favicon vs apple vs android vs ms). */
const nameFor = (size: number): string[] => {
  const names: string[] = [];
  if ([16, 32, 96].includes(size)) names.push(`favicon-${size}x${size}.png`);
  if ([57, 60, 72, 76, 114, 120, 144, 152, 180].includes(size))
    names.push(`apple-icon-${size}x${size}.png`);
  if ([36, 48, 72, 96, 144, 192].includes(size))
    names.push(`android-icon-${size}x${size}.png`);
  if ([70, 150, 310].includes(size)) names.push(`ms-icon-${size}x${size}.png`);
  if ([192, 512].includes(size)) names.push(`pwa-${size}x${size}.png`);
  return names;
};

async function generateIcons() {
  await mkdir(ICONS_DIR, { recursive: true });
  const source = sharp(MARK);

  for (const size of iconSizes) {
    const buf = await source
      .clone()
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    for (const name of nameFor(size)) {
      await sharp(buf).toFile(path.join(ICONS_DIR, name));
    }
  }

  // favicon.ico (multi-size) — sharp can't write .ico; write a 32px png as
  // favicon.png and keep using the existing favicon.ico if present. We also
  // emit favicon-32.png which serves as the canonical small icon.
  await source
    .clone()
    .resize(32, 32, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(path.join(ICONS_DIR, "favicon-32x32.png"));

  console.log(`✓ icons generated (${iconSizes.length} sizes)`);
}

/**
 * Build a 1200×630 Open Graph card: purple-to-black hard surface with the
 * Capinsta wordmark centered. Uses the supplied wordmark PNG so artwork is
 * never reconstructed.
 */
async function generateOpenGraph() {
  await mkdir(OG_DIR, { recursive: true });

  const WORDMARK = path.join(PUBLIC, "logos", "capinsta", "logo-light.png");
  const W = 1200;
  const H = 630;

  // Background: solid brand purple with a darker vignette band at the bottom.
  const bg = sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: BRAND_PURPLE,
    },
  }).raw();

  // Compose wordmark on top (contain within the card, padded).
  const mark = await sharp(WORDMARK)
    .resize({
      width: Math.round(W * 0.7),
      height: Math.round(H * 0.5),
      fit: "inside",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const composed = await sharp(await bg.png().toBuffer())
    .composite([
      {
        input: mark,
        gravity: "center",
      },
    ])
    .png()
    .toBuffer();

  await sharp(composed)
    .png({ quality: 90 })
    .toFile(path.join(OG_DIR, "default.png"));

  // Reuse the same card for twitter/changelog fallbacks where jpg is expected.
  await sharp(composed)
    .jpeg({ quality: 85 })
    .toFile(path.join(OG_DIR, "default.jpg"));

  console.log("✓ open-graph/default.png (+ .jpg) generated");
}

await generateIcons();
await generateOpenGraph();
console.log("Brand asset generation complete.");
