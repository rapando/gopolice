# gopolice UI/UX Review

Scope: `ui/src` — React + TypeScript + Tailwind + Recharts + D3, Vite-built dashboard for exploring Go codebase scan results (issues, security, dead code, tests, performance/benchmarks, dependency graph, git stats, history, config/themes).

This review is grounded in the actual source files (paths cited inline). Organized by priority: **Critical issues** (break or seriously degrade the experience), **High-impact improvements** (clear usability/legibility/consistency wins), and **Polish/nice-to-have** (refinements once the above are addressed).

---

## Critical issues

### 1. ✅ DONE — Charts and the dependency graph ignore the theme system — they'll look broken in 3 of 4 themes
**Resolved:** Added `ui/src/hooks/useThemeColors.ts`, a hook that reads the live `--ctp-*`/`--theme-*` CSS custom properties via `getComputedStyle` and reactively updates on theme changes via a `MutationObserver`. Wired it into `DepGraph.tsx`, `Performance.tsx`, `Trends.tsx`, and `Dashboard.tsx`, replacing every hardcoded hex literal (node fills, link strokes, axis/grid colors, categorical palettes, donut colors) with theme-aware equivalents. Also fixed the related issue #16 (`::selection` hardcoded blue) using `color-mix()`.

The app ships four color schemes (Catppuccin, Nord, Dracula, Gruvbox, each with light/dark — defined in `ui/src/index.css:13-287`) selectable from `ui/src/pages/Config.tsx`. But every data visualization renders with **hardcoded hex colors** that only coordinate with the default Catppuccin/slate palette:

- `ui/src/pages/DepGraph.tsx`: node fills `#f59e0b` (root) / `#6366f1` (dep), link strokes `#94a3b8`, arrowhead `#94a3b8`, tooltip uses Tailwind `bg-gray-900` (lines 128, 134, 151, 246, 255-265, 373).
- `ui/src/pages/Performance.tsx`: axis/grid colors `#e5e7eb`, `#9ca3af`, `#374151`, `#6b7280`; the `profileColors` and `catPalette` arrays (lines 126, 452-455) are fixed 10-color palettes with no theme awareness.
- `ui/src/components/Trends.tsx`: every Recharts `<XAxis>`, `<YAxis>`, `<CartesianGrid>` and `<Line>` uses literal hex strokes (`#94a3b8`, `#e2e8f0`, `#ef4444`, `#3b82f6`, `#8b5cf6`, etc., lines 133-176).
- `ui/src/pages/Dashboard.tsx`: `Donut` color props are passed as raw hex (`#ef4444`, `#22c55e`, lines 132, 146, 162).

**Why this matters:** Switching to Nord, Dracula, or Gruvbox (especially their dark variants) will produce charts whose gridlines, axis labels, and node colors clash with or vanish into the new background — e.g., Dracula dark uses `--theme-bg: #282a36`, and a `#374151` axis label or `#e5e7eb` gridline will have poor contrast against it. The theme picker effectively only "really" reskins surfaces and text, not the data visualizations that are the product's core value.

**Fix direction:** Read CSS custom properties at render time (e.g., `getComputedStyle(document.documentElement).getPropertyValue('--theme-text')`) or expose a small `useThemeColors()` hook that returns the current `--ctp-*` / `--theme-*` values, and feed those into D3 scales / Recharts `stroke`/`fill` props instead of literals. At minimum, swap the slate-gray literals (`#94a3b8`, `#e5e7eb`, `#9ca3af`, `#6b7280`, `#374151`) for `var(--theme-muted)` / `var(--theme-border)` / `var(--theme-text)` equivalents — D3 and SVG both accept `var(...)` in color attributes via inline styles.

### 2. ✅ DONE — Severity/category color helpers bypass the theme system and are duplicated five times with drifting values
**Resolved:** Consolidated all five duplicated helpers into one canonical module, `ui/src/lib/severity.ts`, exporting `severityIcon()`, `severityTextClass()`, `severityBadgeClass()`, and `categoryTextClass()` — each pairing a light-mode utility with its `dark:` counterpart. Updated `Issues.tsx`, `FileView.tsx`, `Security.tsx`, `DeadCode.tsx`, `IssueDetail.tsx`, and `History.tsx` to import from it, and deleted the dead/drifting `severityColor()`, `severityBadge()`, `categoryColor()` functions from `api/client.ts`.

Five different severity-color maps exist with inconsistent values and no dark-mode handling in some:

- `ui/src/pages/Issues.tsx:16-20`, `ui/src/pages/FileView.tsx:11`, `ui/src/pages/Security.tsx:9`, `ui/src/pages/DeadCode.tsx:10` all define `sevBadge`/`sevColor` as plain Tailwind `bg-red-50 text-red-700` / `text-red-500` with **no `dark:` variants**.
- `ui/src/pages/IssueDetail.tsx:9-13` and `ui/src/pages/TestDetail.tsx:11-15` define a *different* `sevBadge`/`statusBadge` that *does* include `dark:bg-red-950/30 dark:text-ctp-red`.
- `ui/src/api/client.ts:336-342` exports a third version, `severityBadge()`, returning `bg-red-100 text-red-800` (still no dark variant), used throughout `ui/src/pages/History.tsx` (lines 285, 296, 374, 409).
- `categoryColor()` (`ui/src/api/client.ts:363-373`) returns bare `text-red-700` / `text-gray-600` with no dark counterpart, used in `History.tsx:375`.

**Why this matters:** In dark mode (any theme), badges built from `bg-red-50 text-red-700` or `bg-red-100 text-red-800` render as a barely-visible dark-red-on-dark-surface combination — the `[data-theme] .text-gray-*` overrides in `index.css:6-10` don't cover `red-50/100/700/800`, so these classes pass through untouched. This is a contrast/legibility failure (likely well below WCAG AA's 4.5:1) on severity badges — exactly the element a user scans first to triage issues. It's also a maintenance hazard: a future change to the red hue must be made in five places and will inevitably drift further.

**Fix direction:** Consolidate into one shared module (e.g., `ui/src/lib/severity.ts`) exporting a single `severityBadgeClass(sev)` / `severityDotClass(sev)` that always pairs a light-mode utility with its `dark:` counterpart (model it on `IssueDetail.tsx`'s version, which is the most complete), and have all five+ call sites import it. Better still, define `--sev-error`, `--sev-warning`, `--sev-info` CSS variables per theme in `index.css` so badges automatically track the active scheme rather than fighting it with Tailwind reds/yellows/blues that were tuned for the default palette only.

### 3. ✅ DONE — Theme switcher is buried on the Config page — most impactful personalization control is the hardest to find
**Resolved:** Extracted the shared theme-state logic (`themes`, `getScheme`, `getDark`, `applyScheme`) into `ui/src/lib/theme.ts` as a single source of truth, and built `ui/src/components/ThemeSwitcher.tsx` — a popover accessible from the top bar (`Layout.tsx`) with scheme swatches and a dark/light toggle, full ARIA support (`aria-label`, `aria-expanded`, `aria-haspopup`, `aria-pressed`), and click-outside/Escape-to-close behavior. `Config.tsx` now imports from the same shared module so the two never drift out of sync.

Despite four full color schemes plus light/dark being a headline recent feature ("new themes" per git log), the only way to change them is `ui/src/pages/Config.tsx:92-137`, reached via the bottom-most sidebar item "Config" (`ui/src/components/Layout.tsx:30`). There is no quick-access affordance (e.g., a small palette/sun-moon icon in the top bar, `ui/src/components/Layout.tsx:95-112`, which currently only holds the "Run Scan" button).

**Why this matters (Nielsen's "user control and freedom" / "recognition over recall"):** Appearance preferences are typically adjusted often during a session (e.g., switching to dark mode when lighting changes) — burying this three clicks deep in a settings page that also mixes in unrelated server config (`Port`, line 88) increases friction for a frequently-used control and makes a flagship feature easy to miss entirely.

**Fix direction:** Add a compact theme/appearance toggle to the top bar (`Layout.tsx` header, alongside the scan button) — e.g., a single icon button that opens a small popover with the same scheme swatches and dark/light toggle currently in `Config.tsx`. Keep the full settings in Config for completeness, but surface the high-frequency action where it's reachable in one click from anywhere.

---

## High-impact improvements

### 4. ✅ DONE — No accessibility (ARIA/keyboard) support anywhere in the app
**Resolved:** Added `aria-label` to icon-only buttons (close, delete, expand/collapse, search-clear) across `DepGraph.tsx`, `History.tsx`, `GitStats.tsx`; `aria-current="page"` to the active sidebar item in `Layout.tsx`; `aria-pressed`/`aria-selected`/`aria-expanded` to filter/toggle/tab/disclosure controls in `Issues.tsx`, `Trends.tsx`, `Config.tsx`, `History.tsx`, `GitStats.tsx`; `role="tablist"`/`"tab"`/`"tabpanel"` plus `aria-controls` to the `Trends.tsx` chart tabs; and `role="tooltip"` to the hover tooltips in `DepGraph.tsx` and `Performance.tsx`. The dependency-graph search now also exposes a live `aria-live="polite"` match-count region (see #7) as a non-visual affordance for the filtering result.

A repo-wide search found **zero** `aria-*` attributes and **zero** `role=` attributes across all of `ui/src`. Specific gaps observed while reading the code:

- Icon-only buttons have no labels: the close (×) buttons in `DepGraph.tsx:386-393`, `Issues.tsx` snippet close, `History.tsx:215-220` delete button, and the chevron toggles in `GitStats.tsx:110-115` / `History.tsx:362-364` are all bare SVG/`✕` glyphs inside `<button>` with no `aria-label`.
- The sidebar nav (`Layout.tsx:70-83`) is a list of `<button>`s with no `aria-current="page"` to announce the active route to assistive tech (visual state is conveyed only via background/border color).
- The D3-rendered dependency graph (`DepGraph.tsx`) and all D3/Recharts visualizations are pure SVG with mouse-only interaction (`mouseover`/`mouseout`/`click` handlers, e.g. lines 164-180, 361-373) — there is no keyboard path to select a node, view the info panel, or read tooltip content. Tooltips are positioned `<div>`s with `pointer-events-none` and no `role="tooltip"`/`aria-live`.
- Sort/filter/group controls (severity filter buttons in `Issues.tsx:137-150`, theme swatches in `Config.tsx:96-108`) use color/border changes alone to indicate selection state, with no `aria-pressed`.

**Why this matters:** This is a data-exploration tool that a developer may use for extended sessions; keyboard-only or screen-reader users currently cannot operate the dependency graph, close panels, or know which nav item is active. Even for sighted mouse users, missing `aria-label`s mean tooltips/title attributes are the only affordance for icon meaning, which is inconsistent (some icons have `title=`, e.g. `History.tsx:129`, most don't).

**Fix direction (incremental, highest ROI first):**
- Add `aria-label` to every icon-only `<button>` (close, delete, expand/collapse, search-clear). This is a 10-minute, zero-risk change with an outsized accessibility payoff.
- Add `aria-current="page"` to the active sidebar item in `Layout.tsx`.
- Add `aria-pressed`/`aria-selected` to filter/toggle/tab buttons (`Issues.tsx` severity + group-by, `Trends.tsx` range/tab buttons, `Config.tsx` theme swatches).
- For the dependency graph specifically, consider supplementing the D3 canvas with a keyboard-navigable list (the existing search results or node list could double as one) that drives the same `selected` state — this gives keyboard users parity without redesigning the graph itself.

### 5. ✅ DONE — Inconsistent page container widths create a jarring "wide/narrow" rhythm when navigating
**Resolved:** Standardized on the proposed 3-tier system: `max-w-6xl` for data-table/list pages (Issues, Security, DeadCode, Tests, History, GitStats), `max-w-4xl` for form/detail pages (Config, IssueDetail, GitStats sub-views, TestDetail, FileView), and `min(95vw, 1600px)` for wide-visualization pages (Dashboard, DepGraph, Performance — the Performance tier was bumped from `1400px` to `1600px` to match). Adjusted `FileView.tsx`, `GitStats.tsx`, `History.tsx`, `Tests.tsx`, `TestDetail.tsx`, `Performance.tsx`, and `Dashboard.tsx` accordingly so the content column no longer jumps width when navigating between pages.

Page-level wrapper widths vary with no evident rationale:
- `max-w-4xl` (Config, IssueDetail, GitStats, TestDetail-not-found) 
- `max-w-5xl` (Tests, FileView, History, TestDetail, Performance "no data" state)
- `max-w-6xl` (Issues, Security, DeadCode)
- Custom inline `style={{ maxWidth: 'min(95vw, 1600px)' }}` (Dashboard `pages/Dashboard.tsx:103`, DepGraph `pages/DepGraph.tsx:295`) and `'min(95vw, 1400px)'` (Performance `pages/Performance.tsx:763, 778`)

**Why this matters (consistency = Nielsen heuristic #4, and it affects perceived polish):** Moving from Dashboard (near full-width, ~1600px) to Issues (1152px/`6xl`) to Config (896px/`4xl`) causes the content column to visibly jump left/right and resize on every navigation, which is disorienting and makes the app feel like a collection of separately-built pages rather than one product.

**Fix direction:** Standardize on 2-3 width tiers tied to content type — e.g., a "data-table/list" tier (`6xl`/`~1152px`, for Issues/Security/DeadCode/Tests/History/GitStats), a "wide-visualization" tier (the `min(95vw, 1600px)` pattern, for Dashboard/Performance/DepGraph), and a "form/detail" tier (`4xl`, for Config/IssueDetail/TestDetail/FileView). Extract these as named constants or a shared `<PageContainer size="...">` wrapper so future pages inherit consistency automatically.

### 6. ✅ DONE — Severity visual language is redundant and not colorblind-safe
**Resolved:** In the new shared `ui/src/lib/severity.ts` (see #2), changed the warning glyph from the filled diamond `◆` to a filled triangle `▲` so error/warning/info now render as three visually distinct shapes (`●`/`▲`/`○`), and shifted "warning" from yellow to amber/orange (`text-amber-600 dark:text-ctp-peach`, `bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-ctp-peach`) to increase perceptual distance from "error" red for red-green/blue-yellow colorblindness, while keeping the redundant shape+color encoding intact.

Across `Issues.tsx`, `Security.tsx`, `DeadCode.tsx`, `FileView.tsx`, `IssueDetail.tsx`, severity is encoded redundantly via a Unicode glyph (`●`/`◆`/`○`, `sevIcon`), a text color (`text-red-500`/`text-yellow-500`/`text-blue-500`, `sevColor`), and sometimes a badge background — but **error and warning are both rendered with filled glyphs that are visually similar at a glance** (`●` vs `◆`), and the red/yellow/blue triad is the classic problematic combination for red-green and blue-yellow colorblindness (~8% of men). The shapes do help (this is good — don't remove them), but the color choices and small size (`text-base`/`text-sm`, ~14-16px) of the only differentiators in dense tables work against quick scanning.

**Why this matters:** Issue severity is the single most important triage signal in this tool — `Issues.tsx` is likely the most-visited page after Dashboard. If users must read the text label to be sure of severity, the visual encoding isn't pulling its weight.

**Fix direction:** Keep the shape+color combo (good redundant encoding) but increase the shape differentiation (e.g., filled circle / filled triangle / outlined circle are more distinct than circle/diamond/circle), and verify the red/yellow/blue trio against a colorblindness simulator — consider shifting "warning" toward orange/amber (as is already used elsewhere, e.g. `text-orange-500` in `Performance.tsx:903`) to increase perceptual distance from "error" red.

### 7. ✅ DONE — Dependency graph: legend and selection affordances could better support the stated goal of "filtering"
**Resolved:** Implemented all three suggested fixes in `DepGraph.tsx`. (1) Search now computes the set of matching nodes, displays a live "`N` of `M` match" count via `aria-live="polite"`, and auto pans/zooms to fit the matches' bounding box using `d3.zoom`/`zoom.transform`/`d3.zoomIdentity` (resetting to identity when the search is cleared). (2) A new effect recomputes `width`/`height` from the SVG's `clientWidth` and restarts the simulation's `forceCenter` (deferred via `requestAnimationFrame` so it runs after the panel-toggle layout settles) whenever `showPanel` changes, so the graph re-centers instead of drifting off to one side. (3) Node radius is now scaled by dependent count via `d3.scaleSqrt().domain([0, maxDependents]).range([6, 20])`, applied to the circle radius, collision force, and label offset, with a "`· size = dependents`" note added to the legend — so visual size now encodes "how relied-upon" at a glance.

`DepGraph.tsx` is otherwise well-built (force simulation, zoom, search-driven opacity fading, click-to-inspect side panel with dependents/dependencies) but a few rough edges undercut the recent "filtering" feature work (per git log "10-add-filtering-to-dependency-graph"):

- The search box (`searchQuery`, lines 33, 331-348) fades non-matching nodes to `opacity: 0.08` but does not recenter/zoom to the matches, so on a large graph a match could be off-screen with the user unaware (no "N matches found" or "no matches" feedback — only a static "filtered" label, line 363).
- The info panel (`showPanel`, lines 380-455) opens as a fixed `w-96` sidebar that shrinks the graph area to `w-3/5` (line 314) — this causes the force simulation's `width`/`height` (captured once at mount, lines 82-83) to become stale relative to the new rendered width, potentially leaving the graph visually off-center after the panel opens.
- Root vs. dependency is the only graph-encoded category (amber vs. indigo dot, legend lines 350-355); for large dependency trees, all third-party packages look identical regardless of how deep or how heavily used they are — there's no way to visually answer "which dependency has the most dependents" without clicking each one.

**Why this matters:** for a tool whose purpose is helping a developer understand a codebase's dependency structure, the graph view is probably the single highest-value screen — these gaps mean users can "search but not find," can experience a visually broken layout after opening the detail panel, and can't visually triage which dependencies matter most.

**Fix direction:**
- On search, auto-pan/zoom to fit the bounding box of matching nodes (d3-zoom supports `zoom.transform` with a computed translate/scale), and show a "X of Y nodes match" count.
- Recompute `width`/`height` and restart the simulation's center force when `showPanel` toggles (or simply don't shrink the SVG — overlay the panel instead with a semi-transparent backdrop).
- Consider scaling node radius by `incoming.get(id)?.length` (number of dependents) so visual size encodes "how relied-upon" — this turns the existing force-directed layout into a more informative view at a glance.

### 8. ✅ DONE — Loading / empty / error states are inconsistent across pages
**Resolved:** Extracted shared `ui/src/components/Spinner.tsx` and `ui/src/components/EmptyState.tsx` (message + optional "Run Scan" CTA wired to `onScan`/`scanning`) components. Replaced the three duplicated inline spinners (`App.tsx`, `IssueDetail.tsx`, `History.tsx`) with `<Spinner />`, and replaced the inconsistent "no data" cards in `Dashboard.tsx`, `Security.tsx`, `DeadCode.tsx`, `GitStats.tsx`, `Tests.tsx`, `DepGraph.tsx`, and `Performance.tsx` with `<EmptyState />`, threading `onScan`/`scanning` props through to `Security`, `DeadCode`, and `GitStats` (which previously lacked the CTA entirely). `Tests.tsx`'s "incomplete data" branch now shows a friendlier message with the raw JSON moved behind a collapsible `<details>/<summary>` "Technical details" disclosure (also resolves the dark-mode bug in #9).

Compare the "no data" treatments:
- `Dashboard.tsx:87-100`: card with message + CTA button, or `ScanProgress` if scanning.
- `Issues.tsx:207-210`, `Security.tsx:20-23`, `DeadCode.tsx:21-24`, `GitStats.tsx:25-34`: plain card with a one-line message, **no CTA to run a scan** (even though `Dashboard`, `Tests`, `Performance`, `DepGraph` all offer a "Run Scan" button in their empty states).
- `Tests.tsx:36-42`: a distinct "Test result data is incomplete" error state that dumps raw `JSON.stringify(testResult, null, 2)` to the screen — useful for debugging, jarring for an end user, and (per the bug below) not dark-mode styled.
- `App.tsx:95-98` and `IssueDetail.tsx:61-69`/`History.tsx:82-90`: three different inline spinner implementations (`animate-spin rounded-full h-6 w-6 border-2 ...`) repeated verbatim rather than shared.

**Why this matters:** Users who land on Security/DeadCode/GitStats with no data get a dead-end message while the equivalent Dashboard/Tests/Performance/DepGraph screens proactively offer the fix (running a scan). Inconsistent empty-state affordances make the product feel uneven and cost users an extra navigation back to Dashboard just to trigger what could be a one-click action from where they already are.

**Fix direction:** Extract a shared `<EmptyState message="..." onScan={...} scanning={...} />` (and a `<Spinner />`) component and use it everywhere data can be absent — including Security, DeadCode, GitStats, History — so the "run a scan to populate this" affordance is uniform. For `Tests.tsx`'s "incomplete data" branch, replace the raw JSON dump with a friendlier message and move the JSON behind a collapsible "technical details" disclosure (and fix its missing dark-mode classes — see bug below).

### 9. ✅ DONE — Bug: `Tests.tsx` "incomplete data" card is not dark-mode styled
**Resolved:** Added the missing `dark:bg-ctp-surface0 dark:border-ctp-surface1` classes to match its sibling cards, as part of the broader rework of this branch described in #8 (friendlier message + collapsible "technical details" disclosure replacing the raw `JSON.stringify` dump).

`ui/src/pages/Tests.tsx:37`:
```tsx
<div className="bg-white border border-gray-200 rounded p-10 text-center">
```
This is the only such card in the file lacking `dark:bg-ctp-surface0 dark:border-ctp-surface1` (compare to the surrounding cards at lines 22, 46, 50, 54, 60, 71, 77). In dark mode this renders as a glaring white box.

**Fix:** Add the missing `dark:` classes to match its siblings (a one-line change).

### 10. ✅ DONE — Tooltip in `DepGraph.tsx` renders an empty box
**Resolved:** Added `{tooltip.text}` as the tooltip `<div>`'s child (and `role="tooltip"` for accessibility, see #4) — hovering a node now shows its module path instead of an empty rectangle. This was fixed during the critical-issues pass alongside the theme-awareness work on the same component.

`ui/src/pages/DepGraph.tsx:371-376`:
```tsx
{tooltip && (
  <div className="absolute z-10 px-3 py-1.5 text-xs bg-gray-900 text-white rounded shadow-lg pointer-events-none max-w-sm break-all"
    style={{ left: tooltip.x, top: tooltip.y }}
  />
)}
```
The `tooltip` state object carries a `text` field (set on hover at line 166: `setTooltip({ x, y, text: d.id })`), but the rendered `<div>` has no children — `{tooltip.text}` is never output. Hovering a node shows a small dark rectangle with no content.

**Fix:** add `{tooltip.text}` (or better, `{extractShortName(tooltip.text)}` plus the full module path in smaller text, mirroring the richer tooltips already built in `Performance.tsx:206-212`) inside the `<div>`.

### 11. ✅ DONE — Sidebar lacks a project/scan context indicator
**Resolved:** Added optional `projectName`/`scanTime` props to `Layout.tsx`, populated from `result?.project_name`/`result?.scan_time` in `App.tsx`, and rendered them as a truncated project name (with a `title` tooltip for the full name) and a "Scanned `<timestamp>`" line beneath the "gopolice" wordmark in the sidebar header — so the current project and last-scan context are now visible in the persistent chrome regardless of page or scroll position.

`Layout.tsx:64-90` shows a static "gopolice" wordmark and version, but nowhere in the persistent chrome is the **current project name** or **last scan time** visible — `result.project_name` and scan timestamps only appear inside `Dashboard.tsx:106` and `History.tsx`. When a historical result is loaded (`historicalLabel`, `Layout.tsx:114-126`), the banner appears only on the content area, easy to miss if scrolled down, and disappears when navigating to pages that don't render `{children}` scrolled to top.

**Why this matters (orientation / "visibility of system status"):** In a multi-project or multi-scan context (the app supports History/diffing across scans), users need a persistent answer to "which project, which scan am I looking at right now?" — currently that requires returning to Dashboard.

**Fix direction:** Move project name + "scanned X ago" (or the historical-label banner) into the persistent header (`Layout.tsx` top bar), so it's visible regardless of which page or scroll position the user is on.

---

## Polish / nice-to-have

### 12. ✅ DONE — Sidebar icons are mismatched glyph styles
**Resolved:** Replaced the two emoji (`🔒` Security, `📊` Performance) with stroke-style inline SVG icons (lock and bar-chart glyphs, `fill="none" stroke="currentColor" strokeWidth={2}`) via a small `StrokeIcon` helper in `Layout.tsx`, matching the monochrome geometric style of the SVGs already used in `Config.tsx`/`DepGraph.tsx`. Widened `NavItem.icon` to `ReactNode` so the nav list can mix Unicode glyphs and SVG icons.

`navItems` in `Layout.tsx:20-31` mixes geometric Unicode symbols (`⊞ ⚠ ✕ ✓ ◉ ⬡ ↻ ⚙`) with two emoji (`🔒` Security, `📊` Performance). Emoji render with platform-specific colors/styles that clash with the otherwise monochrome, geometric icon language and break visual rhythm in the nav list. Consider replacing the two emoji with stroke-style SVG icons (the app already has a small library of inline SVGs used elsewhere, e.g. `Config.tsx:123-132`, `DepGraph.tsx:325-330`) to match the rest.

### 13. ✅ DONE — `MiniBar`/`Donut` color props passed as raw hex strings instead of theme tokens
**Resolved:** This was fixed as part of #1's `useThemeColors()` rollout — `Dashboard.tsx` now sources `colors` from the hook and passes `colors.red`/`colors.green`/`colors.yellow` into `<Donut color={...}>` instead of raw hex literals, so the donut rings now track the active theme/scheme.

`Dashboard.tsx:132, 146, 162` pass literal hex (`'#ef4444'`, `'#22c55e'`, `'#eab308'`) into `<Donut color={...}>`, while the surrounding markup correctly uses `dark:text-ctp-*` classes. Minor today (these particular colors happen to read fine on the default theme), but they'll drift from the active palette the moment a user picks Nord/Dracula/Gruvbox — same root cause as issue #1, called out separately here because it's localized to Dashboard and easy to fix opportunistically (e.g., `var(--ctp-red)` etc. work directly as SVG `stroke` values).

### 14. ✅ DONE — Density and label legibility in D3 charts at small sizes
**Resolved:** The fixed hex fills (`#374151`/`#6b7280`/etc.) called out here were already replaced by `colors.muted`/`colors.overlay1` from `useThemeColors()` during the #1 theming work. On top of that: `FlamegraphChart`'s function-row labels now use a width-aware fit check (`label.length * 5 < fnW - 8`) instead of the fixed `fn.pct > 5` threshold, so labels appear whenever they'll actually fit the rendered bar — scaling naturally with container width rather than silently dropping at an arbitrary percentage cutoff. `BenchmarkScatter`'s `pad.right` legend gutter is now responsive (`clamp(90, width * 0.11, 140)`) instead of a fixed `140px`, giving the plot more room on narrower/laptop-sized viewports while preserving the full legend width on wide screens.

- `Performance.tsx`'s `BenchmarkRanking` (lines 128-217) and `FlamegraphChart` (lines 303-392) place 9-11px SVG `<text>` labels directly adjacent to colored bars with fixed hex fills (`#374151`, `#6b7280`) — on narrow viewports these will compress further since `width = svgRef.current.clientWidth` drives a fixed `rowH`/font-size combination that doesn't scale down gracefully (labels can overlap bars, e.g. `FlamegraphChart` only shows function labels when `fn.pct > 5`, line 376, silently dropping context for smaller slices).
- `BenchmarkScatter` (lines 457-656) is a feature-rich, well-designed chart (quadrant badges, label-overlap mitigation, dual legends) — but at the default `min(95vw, 1400px)` container and `pad.right: 140`, the right-side category + size legends (lines 635-655) can feel cramped next to the plot on laptop-sized screens (~1280px viewport ⇒ plot area ~1140px minus 140px legend gutter).

**Suggestion:** These are sophisticated, mostly well-executed visualizations — the main opportunity is to make font sizes and paddings respond to `width` (e.g., scale `font-size` between 9-12px based on `width / benchmarks.length`) and to collapse the side legend into a below-chart horizontal legend on narrower containers.

### 15. ✅ DONE — Minor copy/structure inconsistencies
**Resolved:**
- `Performance.tsx`: removed the redundant external `<h4>Top Functions (Table)</h4>` wrapper and passed `title="Top Functions (Table)"` to `<ProfileTable>` directly, so both `ProfileTable` call sites now consistently rely on the component's own heading rendering.
- `History.tsx`: wrapped the top pagination block in the same `{totalPages > 1 && (...)}` condition already used by the bottom one, so both now consistently hide when there's only a single page (eliminating the visibility mismatch called out below).
- Left the `Trends.tsx`/`Issues.tsx` pill-button duplication as-is for now — a shared `<Pill>`/`<TabGroup>` primitive is a reasonable future investment, but the two call sites currently differ enough in active-state styling (icon+border-current vs. flat background) that forcing a shared abstraction today would either lose that nuance or need configuration knobs that outweigh the ~15 lines of duplication it would remove.

- `Performance.tsx:851-852` renders `<ProfileTable title="" entries={...} />` then separately repeats the section heading via an `<h4>` wrapper — the empty `title` prop suggests the component's own heading rendering (`ProfileTable`, line 399) is being deliberately suppressed in favor of an external one, while the CPU table just below (`line 857`) uses the component's built-in title. Consolidating to one heading pattern would simplify the component's API.
- `Trends.tsx` and `Issues.tsx` both implement near-identical "tab"/"filter pill" button groups (compare `Trends.tsx:96-109, 114-127` with `Issues.tsx:137-150, 154-166`) with slightly different active-state classes (`bg-blue-100 text-blue-700` vs `${sevBadge[s]} border-current`). A shared `<Pill>`/`<TabGroup>` primitive would reduce drift and make future restyling (e.g., theme-aware active states) a one-place change.
- `History.tsx` repeats the pagination control block verbatim at top (lines 124-162) and bottom (lines 233-253) of the list — worth extracting to a `<Pagination>` component, especially since the bottom copy is conditionally hidden (`totalPages > 1`) while the top isn't, which is itself a small inconsistency users may notice when there's exactly one page.

### 16. ✅ DONE — `::selection` style assumes the blue accent regardless of theme
**Resolved:** Fixed alongside #1 — `index.css` now defines `::selection { background-color: color-mix(in srgb, var(--ctp-lavender) 25%, transparent); }`, tracking the active scheme's accent instead of a hardcoded blue.

`index.css:305-307`:
```css
::selection {
  @apply bg-blue-500/20;
}
```
This hardcodes a blue selection highlight across all four themes/both modes. For Gruvbox or Dracula (where blue is not the primary accent), this is a small but noticeable mismatch. Consider `background-color: color-mix(in srgb, var(--ctp-blue) 20%, transparent)` or simply `var(--ctp-lavender)`/`var(--ctp-mauve)` depending on theme accent conventions already established (the active-nav-item highlight uses `ctp-lavender` in dark mode, `Layout.tsx:76`).

---

## Summary of recommended sequencing

1. **Fix the theme/chart disconnect (#1, #13)** and **consolidate severity color helpers (#2)** — these are the biggest "the headline feature doesn't actually work everywhere" gaps, and #2 doubles as a contrast/legibility fix.
2. **Surface the theme switcher (#3)** and **add baseline ARIA labels + keyboard affordances (#4)** — both are relatively low-effort, high-visibility wins for usability/accessibility.
3. **Standardize page widths (#5)**, **empty states (#8)**, and **fix the two concrete bugs (#9 dark-mode card, #10 empty tooltip)** — these tighten consistency and remove visible rough edges quickly.
4. Tackle the **dependency graph refinements (#7)** and **severity iconography (#6)** as the next round of UX investment, since the graph is likely the tool's signature view.
5. Treat **#11–16** as ongoing polish during normal feature work — each is small in isolation but collectively they're what separates "functional" from "feels considered."
