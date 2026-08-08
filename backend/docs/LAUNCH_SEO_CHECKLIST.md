# Huygen Caps Launch SEO Checklist

## Production values

- Replace the placeholder domain with the final value in `PUBLIC_SITE_URL` or `NEXT_PUBLIC_SITE_URL`.
- Verify `https://huygencaps.com/sitemap.xml` after deployment.
- Verify `https://huygencaps.com/robots.txt` after deployment.
- Add the final favicon files: `favicon.ico`, `favicon.png` and `apple-touch-icon.png`.
- Add the final Open Graph image at `/og/huygen-caps-og.png` at 1200x630.
- Confirm final logo SVG/PNG assets.

## Search setup

- Connect Google Search Console.
- Submit the sitemap.
- Check that public routes are indexed and private/editor routes are not indexed.
- Review Search Console impressions for "AI caption generator" and "auto subtitle generator".
- Keep both `/ai-caption-generator` and `/auto-subtitle-generator` live until keyword data proves otherwise.

## Route checks

- Test `/`.
- Test `/pricing`.
- Test `/privacy-policy`.
- Test `/sitemap.xml`.
- Test `/robots.txt`.
- Test `/editor`.
- Test every keyword landing page from the footer and sitemap.
- Confirm direct refresh works for every public route.

## Metadata and previews

- Confirm every public page has one H1.
- Confirm page titles are unique.
- Test Open Graph and Twitter previews with social preview tools.
- Confirm canonical URLs use the final production domain.
- Confirm JSON-LD does not include fake reviews, fake ratings or fake awards.

## Performance

- Run Lighthouse or PageSpeed on mobile.
- Confirm marketing/legal pages do not load the editor bundle.
- Check for layout shift on homepage, pricing and keyword pages.
- Use compressed production images.
- Lazy-load non-critical imagery if new images are added.

## Analytics and legal

- Verify analytics configuration and cookie disclosure.
- Confirm pricing, export limits, video duration limits, storage limits and watermark rules before payments go live.
- Confirm refund rules before payments go live.
- Have Privacy Policy, Terms of Service, Refund Policy, Cookie Policy, Disclaimer and Data Deletion reviewed by a qualified legal professional.
