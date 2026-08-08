# AdSense readiness

AdSense is disabled by default. No publisher ID or slot ID is committed.

## Production configuration

- `NEXT_PUBLIC_ADSENSE_ENABLED=true`
- `NEXT_PUBLIC_ADSENSE_CLIENT_ID=ca-pub-…`
- `NEXT_PUBLIC_ADSENSE_TOP_SLOT=…`
- `NEXT_PUBLIC_ADSENSE_SIDEBAR_SLOT=…`
- `NEXT_PUBLIC_ADSENSE_AUTO_ADS_ENABLED=false`

The client ID must match `ca-pub-` followed by 16 digits. Slot IDs must contain
digits only. Invalid or missing values result in no script and no ad container.

## Consent

The current Capinsta preference banner stores denied/default advertising
consent and allows users to reopen their choices. This does not by itself prove
compliance with regional advertising-consent requirements.

Before production activation:

1. Select and configure a Google-certified CMP where required.
2. Configure the AdSense Privacy & messaging settings.
3. Verify consent mode and personalized/non-personalized behavior for target
   regions.
4. Obtain legal review of the Privacy Policy, Cookie Policy, and advertising
   disclosure.

## ads.txt

`/ads.txt` always responds as `text/plain`. Without a real publisher ID it
contains only an explanatory comment. Once a valid client ID is configured,
the route derives the matching `pub-…` value and emits the authorized Google
seller line.

## Editor placements

- Top unit: visible only from 1600px wide and 900px high.
- Right rail: visible only from 1720px wide and 850px high.
- Right rail width: 320px, with a 300px ad unit and 150px top separation.
- Below those breakpoints the editor remains a single primary column.

Authentication, password recovery, renderer, error, and 404 routes never mount
an ad unit.

Auto ads remain independently disabled. Do not enable Auto ads and manual side
rails together without checking for duplicate or overcrowded placements.
