# Priestess Dashboard interaction prototype

Standalone output: `index.html`. Inline output: `/Users/heyanle/.codex/visualizations/2026/10/25/01a17195-a81f-7b23-860a-29a729947454/priestess-dashboard-prototype.html`.

Source consists of `shell.html`, `styles.css` and strict `app.ts`. Build with `python3 prototypes/dashboard-ux/build.py` from the repository root. This uses the project's existing TypeScript/esbuild and the local visualization renderer. The renderer supplies its UI runtime and icon library.

Local preview: `python3 -m http.server 4175 --bind 127.0.0.1 --directory prototypes/dashboard-ux`.

Try editing the persona, toggling network search, sending a test message, reviewing publication changes, or completing the NapCat wizard. All values and responses are examples. No real provider, bot, NAS, filesystem service, or management credential is used. State is held in memory and reset on reload.

`design-qa.md` records browser checks, captures, corrections and prototype limits. Do not substitute this prototype or its fixture policies for production authorization or runtime logic.
