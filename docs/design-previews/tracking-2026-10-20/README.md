# Maps tracking frontend design preview

This directory is a standalone visual prototype. It does not change or invoke production application code, collectors, APIs, databases, Kubernetes, Azure, or schedules.

Open `index.html` locally. The only asset is the existing official Connexup logo, copied to `assets/connexup.svg`.

## Design decisions

- Use a compact navigation rail and a wide working canvas for tables, rather than a decorative landing page.
- Keep store portfolio, keyword history, screenshot evidence, and Android point exploration as four connected views.
- Give the keyword-by-date matrix a sticky keyword column and horizontal scrolling. Missing/failed observations create gaps in the trend.
- Keep Web and Android independent. The Android portfolio uses an intentional empty state with a link to its separate point example.
- Show configuration state separately from the last observation's outcome.
- Use text and color for all result states. Unavailable is not converted to rank 21.
- Show ad-inclusive display order and organic rank separately. A merchant can have two independent rows: its advertisement and its organic listing.
- A matched device GPS receipt does not establish that returned businesses are customer-local.

## All values are illustrative

The permanent banner states: `设计预览 · 示例数据，非实时排名`.

All merchants, keywords, counts, dates, coordinates, positions, ratings, and review counts are design examples, not findings. Existing merchant names are reused only to make navigation recognizable.

No Google Maps screenshots have been generated, reconstructed, or substituted. Every evidence panel is explicitly labeled `原始截图展示区域` and `设计占位，非采集证据`.

## Interactive scope

- Navigate among the four views using the sidebar.
- Switch Web / Android locally.
- Open a store from the portfolio; Keke has six example keywords, other stores have one clearly illustrative keyword.
- Select a keyword to update its trend.
- Open a date cell to view the local evidence design and observation fields.
- Select an Android point to view example GPS and evidence states.

Historical matrix, before/after comparison, and screenshot-to-row navigation require application endpoints/integration before production use. The prototype includes no save, run, deployment, or download controls that pretend to perform those operations.

## Visual tokens

White workspace, pale lavender `#F6F5FA`, ink `#242034`, purple `#6D3BD1` / `#8C55F3`, restrained green and amber. PingFang SC and system sans-serif; numeric values use tabular figures. Table-first hierarchy, minimal shadows, visible keyboard focus, responsive bottom navigation on narrow screens.
