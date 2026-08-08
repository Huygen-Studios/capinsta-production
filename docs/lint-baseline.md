# Web Lint Baseline

`apps/web` currently has unrelated lint debt outside the auth, billing, payment, entitlement, account, donation, pricing, and changed-file surface.

`bun run lint` gates changed files and protected auth/billing/payment paths while
reporting this baseline. A successful run with baseline debt remaining is a
`baseline lint gate passed` result, not a full-lint-clean result.

`bun run lint:raw` prints the full raw ESLint output. `bun run
lint:update-baseline` updates `apps/web/eslint-baseline.json` only when the
baseline change is intentional and reviewed. CI should fail if protected files
have lint errors or if this baseline drifts without that explicit update.

Current baseline: 157 errors and 20 warnings across 101 unrelated files.

## Files

- `src/access/decision.ts`: 1 errors, 0 warnings
- `src/actions/registry.ts`: 2 errors, 0 warnings
- `src/actions/use-action-handler.ts`: 2 errors, 0 warnings
- `src/admin/product-access.ts`: 2 errors, 0 warnings
- `src/app/api/admin/product-access/bulk/[operationId]/route.ts`: 1 errors, 0 warnings
- `src/app/api/admin/users/[userId]/product-access/route.ts`: 2 errors, 0 warnings
- `src/app/blog/page.tsx`: 0 errors, 1 warnings
- `src/app/guides/captions-for-short-form-video/page.tsx`: 3 errors, 0 warnings
- `src/app/guides/hinglish-telgish-caption-workflows/page.tsx`: 4 errors, 0 warnings
- `src/app/guides/how-automatic-captions-work/page.tsx`: 2 errors, 0 warnings
- `src/app/guides/why-captions-improve-accessibility/page.tsx`: 1 errors, 0 warnings
- `src/app/how-it-works/page.tsx`: 0 errors, 1 warnings
- `src/app/privacy/page.tsx`: 1 errors, 0 warnings
- `src/app/render/render-client.tsx`: 13 errors, 3 warnings
- `src/app/render/render-token.ts`: 4 errors, 0 warnings
- `src/app/render/renderColor.test.ts`: 1 errors, 0 warnings
- `src/app/render/renderColor.ts`: 1 errors, 0 warnings
- `src/blog/query.ts`: 1 errors, 0 warnings
- `src/capinsta/captionVisibility.test.ts`: 1 errors, 0 warnings
- `src/capinsta/export/capinsta-overlay-capture.ts`: 1 errors, 0 warnings
- `src/capinsta/export/captionLayoutDiagnostics.ts`: 1 errors, 0 warnings
- `src/capinsta/export/exportStyleHash.ts`: 2 errors, 0 warnings
- `src/capinsta/fonts/captionFontRegistry.browser.test.ts`: 1 errors, 0 warnings
- `src/capinsta/fonts/captionFontRegistry.ts`: 1 errors, 0 warnings
- `src/capinsta/useProjectHeartbeat.ts`: 1 errors, 0 warnings
- `src/clipboard/handlers/index.ts`: 1 errors, 0 warnings
- `src/commands/timeline/element/delete-elements.ts`: 0 errors, 1 warnings
- `src/commands/timeline/element/effects/add-effect.ts`: 1 errors, 0 warnings
- `src/commands/timeline/element/effects/remove-effect.ts`: 1 errors, 0 warnings
- `src/commands/timeline/element/effects/reorder-effect.ts`: 1 errors, 0 warnings
- `src/commands/timeline/element/effects/toggle-effect.ts`: 1 errors, 0 warnings
- `src/commands/timeline/element/effects/update-effect-params.ts`: 1 errors, 0 warnings
- `src/components/admin/admin-product-access-panel.tsx`: 2 errors, 0 warnings
- `src/components/admin/admin-users-product-access-table.tsx`: 2 errors, 0 warnings
- `src/components/analytics/google-analytics-provider.tsx`: 1 errors, 0 warnings
- `src/components/editor/mobile-gate.tsx`: 1 errors, 0 warnings
- `src/components/editor/panels/assets/assets-panel-store.tsx`: 1 errors, 1 warnings
- `src/components/editor/panels/assets/views/settings/background.tsx`: 2 errors, 0 warnings
- `src/components/editor/panels/properties/empty-view.tsx`: 1 errors, 0 warnings
- `src/components/providers/editor-provider.tsx`: 2 errors, 0 warnings
- `src/components/render-route-exclusions.tsx`: 1 errors, 0 warnings
- `src/components/storage-provider.tsx`: 0 errors, 1 warnings
- `src/components/ui/alert.tsx`: 1 errors, 0 warnings
- `src/components/ui/font-picker.tsx`: 1 errors, 0 warnings
- `src/components/ui/form.tsx`: 3 errors, 0 warnings
- `src/components/ui/prose.tsx`: 1 errors, 0 warnings
- `src/components/ui/resizable.tsx`: 0 errors, 1 warnings
- `src/core/managers/playback-manager.ts`: 0 errors, 2 warnings
- `src/core/managers/project-manager.ts`: 1 errors, 0 warnings
- `src/core/managers/timeline-manager.ts`: 3 errors, 0 warnings
- `src/editor/panel-store.ts`: 1 errors, 0 warnings
- `src/feedback/components/feedback-popover.tsx`: 0 errors, 1 warnings
- `src/fonts/use-font-atlas.ts`: 1 errors, 0 warnings
- `src/gradients/canvas.ts`: 3 errors, 0 warnings
- `src/gradients/parser.ts`: 2 errors, 0 warnings
- `src/graphics/definitions/ellipse.ts`: 1 errors, 0 warnings
- `src/graphics/definitions/polygon.ts`: 1 errors, 0 warnings
- `src/graphics/definitions/rectangle.ts`: 1 errors, 0 warnings
- `src/graphics/definitions/star.ts`: 1 errors, 0 warnings
- `src/graphics/stroke.ts`: 1 errors, 0 warnings
- `src/hooks/use-mobile.ts`: 1 errors, 0 warnings
- `src/media/use-paste-media.ts`: 1 errors, 0 warnings
- `src/preview/components/capinsta-active-caption-overlay.tsx`: 2 errors, 0 warnings
- `src/preview/components/overlay-layer.tsx`: 1 errors, 0 warnings
- `src/preview/components/preview-viewport.tsx`: 2 errors, 0 warnings
- `src/preview/components/toolbar.tsx`: 4 errors, 0 warnings
- `src/preview/controllers/transform-handle-controller.ts`: 3 errors, 0 warnings
- `src/preview/hooks/use-preview-interaction.ts`: 2 errors, 0 warnings
- `src/project/components/delete-project-dialog.tsx`: 3 errors, 0 warnings
- `src/ripple/diff.ts`: 0 errors, 1 warnings
- `src/security/clipboard.ts`: 1 errors, 0 warnings
- `src/selection/selectable-surface.tsx`: 2 errors, 0 warnings
- `src/services/renderer/compositor/wasm-compositor.ts`: 1 errors, 0 warnings
- `src/services/renderer/nodes/base-node.ts`: 1 errors, 0 warnings
- `src/services/renderer/nodes/capinsta-caption-node.ts`: 0 errors, 1 warnings
- `src/services/renderer/scene-builder.ts`: 2 errors, 0 warnings
- `src/services/storage/components/storage-persistence-dialog.tsx`: 1 errors, 0 warnings
- `src/services/storage/indexeddb-adapter.ts`: 2 errors, 0 warnings
- `src/services/storage/migrations/transformers/v21-to-v22.ts`: 0 errors, 1 warnings
- `src/services/storage/opfs-adapter.ts`: 0 errors, 1 warnings
- `src/services/storage/storage-lifecycle.test.ts`: 1 errors, 0 warnings
- `src/services/storage/use-local-storage.ts`: 3 errors, 0 warnings
- `src/services/transcription/worker.ts`: 1 errors, 0 warnings
- `src/stickers/index.ts`: 2 errors, 0 warnings
- `src/subtitles/ass.ts`: 1 errors, 0 warnings
- `src/subtitles/components/caption-editor-panel.tsx`: 6 errors, 0 warnings
- `src/text/layout.ts`: 1 errors, 0 warnings
- `src/timeline/__tests__/update-pipeline.test.ts`: 0 errors, 1 warnings
- `src/timeline/bookmarks/components/bookmarks.tsx`: 3 errors, 0 warnings
- `src/timeline/bookmarks/hooks/use-bookmark-drag.ts`: 0 errors, 1 warnings
- `src/timeline/components/drop-target.ts`: 0 errors, 1 warnings
- `src/timeline/components/selection-hit-testing.test.ts`: 3 errors, 0 warnings
- `src/timeline/controllers/playhead-controller.ts`: 1 errors, 0 warnings
- `src/timeline/controllers/seek-controller.ts`: 1 errors, 0 warnings
- `src/timeline/controllers/zoom-controller.ts`: 1 errors, 0 warnings
- `src/timeline/hooks/element/use-element-interaction.ts`: 2 errors, 0 warnings
- `src/timeline/hooks/use-element-preview.ts`: 1 errors, 0 warnings
- `src/timeline/linked-media.test.ts`: 3 errors, 0 warnings
- `src/timeline/placement/apply.ts`: 5 errors, 1 warnings
- `src/timeline/update-pipeline.ts`: 1 errors, 0 warnings
- `src/utils/browser.ts`: 2 errors, 0 warnings
