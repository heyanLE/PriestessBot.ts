# Dashboard HTML prototype QA — 2026-10-28

final result: passed

This result applies to the local interaction prototype only, not the production Dashboard or backend behavior. No production URL or NAS state was accessed for this prototype.

## Visual evidence

- Source: `/Users/heyanle/.codex/generated_images/01a17195-a81f-7b23-860a-29a729947454/exec-ca74f1b2-428e-42ca-a856-6e7495fb115d.png`.
- Implemented initial state: `desktop-final.jpg`.
- Matching unpublished state: `desktop-draft.jpg`.
- Viewport: 1520 × 1090 CSS pixels; standalone wrapper padding 16 pixels. Browser capture clipped the product frame to 1488 × 1058, matching the source raster dimensions. Returned capture density is one pixel per CSS pixel; no resampling used.
- Source and implementation were opened together in the same comparison input. State differences: the initial prototype is clean, while the concept has unpublished changes; `desktop-draft.jpg` explicitly verifies that state. The focused role field adds an intentional keyboard focus ring.
- Full-view comparison covered navigation, object header, editor/test columns, local tabs, persona/examples/model fields and composer. These regions were readable in the paired full-size images, so no separate raster crops were needed.
- Responsive evidence: `inline-wide.jpg` at product width 1024, `mobile-top.jpg` and `mobile-final.jpg` for narrow states. DOM measurements found root scrollWidth equals clientWidth at 1024, 390 and 320 pixels. The narrow view stacks editor and test panel; normal page scrolling reveals the rest.
- Flow evidence: `publish-review.jpg`, `bot-review.jpg`.

## Iterations and findings

1. P1: native form submission did not dispatch the simulation in the renderer's sandbox. Replaced primary submission paths with explicit local button handlers, retained keyboard shortcuts and submit fallbacks. Browser verified a search-disabled reply, model creation and subsequent publication.
2. P2: initial desktop typography was too small relative to the source. Increased desktop headings, navigation and field text, then tightened section spacing so the model and advanced section remain visible. Compared `desktop-initial.jpg` with the later captures.
3. P2: narrow sidebar Settings label wrapped vertically. Changed it to an intrinsic-width, no-wrap action and raised smallest labels to 11px. Rechecked layout and horizontal overflow.
4. Removed the single-option Agent picker in the wizard; display the fixed current Agent instead of a nonfunctional choice.

## Required fidelity surfaces

- Typography: system Avenir Next/PingFang stack follows the existing product. Clear 32/24/19 desktop headings, 15–17px body/fields; narrow controls use 16px editable text. Native controls have small P3 differences from generated pixels.
- Layout: same five-item navigation and editor/test split; tested stacked narrow layout. Shared resource pickers use dialogs in this prototype, rather than a full production drawer implementation.
- Colors: original green token palette is retained; primary action, selection, text and borders consistently use product-scoped variables.
- Images: original supplied logo is embedded as a data URL, not recreated. Standard icons use the provided Lucide runtime. No rasterized form controls or fake screenshot surfaces.
- Copy: main concept labels retained. Simulated reply/connection/publication notices added to distinguish mock operations from actual model, IM or NAS activity.

## Browser interactions exercised

- Edit persona, change tabs and verify draft retention.
- Disable search, send a test message, verify the simulated failure reason.
- Open publication diff, confirm, verify version increment and clean state.
- Select a shared persona into a private draft.
- Add and choose a named model connection without credentials.
- Discard current edits and verify the most recently published persona is restored.
- Complete NapCat's four-step wizard: name, mock connection check, group rules and senior state, review, finish; verify the new list entry.
- Navigate between Agent and robots while preserving draft/state.
- Inspect 320/390/1024px layout and desktop visual state.
- Browser console error/warning query returned an empty array.
- Strict TypeScript compilation and esbuild completed successfully.

## Scope and remaining polish

All state lives in page memory; reload resets it. Replies are deterministic examples, attachments use filenames only, and the code has no backend/API/network operations. Resource catalog and diagnostic dialogs illustrate navigation; they are not complete resource CRUD or real execution engines. The one-Agent wizard is intentional. No complete WCAG audit, actual LLM test or real IM test is claimed.

P3: final production pass can tune small icon/font metrics and replace resource dialogs with drawers after the user validates the interaction structure.

## Implementation checklist

- [x] One HTML interaction prototype generated from strictly checked TypeScript.
- [x] Main Agent and robot workflows exercised in the in-app browser.
- [x] Screenshot comparison and responsive checks completed.
- [x] Local preview kept open; production remains unchanged.
