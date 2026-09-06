# Admin and graphics workspace improvements

## Behavior

- Keep More and EWC alongside the other Community navigation links.
- Measure the site header so the admin sidebar and sticky toolbar remain below it at desktop and mobile breakpoints, including Arabic layouts.
- Search the existing permission-filtered admin tools. Show the active tool in the toolbar and avoid duplicate desktop back links and nested main landmarks.
- Put dashboard statistics and posts before optional workflow/access guidance. Keep access guidance expanded when the visitor is not an admin.
- Filter graphics sources by game/channel, status, and search text. Show the selected source in full and remove raw database IDs from source rows.
- Offer automatic or manual previews, visible format guidance, and PNG/JPEG/WebP exports beside the preview. JPEG and WebP conversion happens in the browser; the rendering API remains unchanged.
- Disable current-image exports while the preview is stale or rendering. Restore saved versions with their own dimensions and export filenames. Ignore aborted render responses.
- Keep recent-version restore and download actions independently keyboard accessible; wrap the preview toolbar on phones.

## Verification

The browser regression tests cover desktop and mobile admin tool search, header positioning, graphics filtering, stale-export blocking, version restoration, and the actual PNG/JPEG/WebP download signatures. Rendering responses in those tests use a local PNG fixture; no external media request is needed.

Manual local inspection covered the generated match card, desktop navigation, phone layout, and Arabic dashboard. No API methods, authorization policies, database schemas, or production auth behavior changed.
