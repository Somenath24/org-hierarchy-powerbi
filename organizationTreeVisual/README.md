# Organization Tree Visual

A Power BI custom visual that renders an employee reporting hierarchy (org
chart) from flat `employeeId` / `managerId` data, with zoom/pan, expand and
collapse, re-rooting, and Power BI cross-visual selection.

Built for the OrgAnalytics PBIP project's `Employee` table (1000 synthetic
employees, 6-level hierarchy).

## Data roles

| Role | Field name | Kind | Required | Notes |
|---|---|---|---|---|
| Employee ID | `employeeId` | Grouping | Yes (min 1, max 1) | Bind `Employee[EmployeeID]` |
| Employee Name | `employeeName` | Grouping | Yes (min 1, max 1) | Bind `Employee[EmployeeName]` |
| Manager ID | `managerId` | Grouping | Yes (min 1, max 1) | Bind `Employee[ManagerID]`; blank for the root |
| Manager Name | `managerName` | Grouping | No | |
| Designation | `designation` | Grouping | No | Shown on the card if toggled on |
| Department | `department` | Grouping | No | Parsed but not currently rendered separately (available for future filtering/coloring) |
| Team | `team` | Grouping | No | Parsed but not currently rendered separately |
| Management Level | `managementLevel` | Grouping | No | Parsed, not currently rendered |
| Metrics | `metrics` | Measure (up to 8) | No | First two bound measures can be shown on the card (toggle each independently in the formatting pane) |

### Why a table mapping, not categorical

Categorical `dataViewMappings` assume one category axis plus values. This
visual has eight independent grouping roles describing one row per employee
(id, name, manager id, manager name, designation, department, team,
management level) plus a measures bucket — that is a flat, one-row-per-entity
table, not a category/series shape. A `table` mapping with `rows.select`
binding each role is the natural fit and is what `dataMapping.ts` consumes
directly via `dataView.table`.

## Formatting pane (objects)

- **Card layout** — card width/height, horizontal/vertical spacing, font size.
- **Connectors** — curved or orthogonal link style, connector color.
- **Metrics display** — show/hide designation, 1st/2nd bound metric, direct-reports count.
- **Root navigation** — auto-expand levels from root, max nodes shown before auto-collapsing.

## Architecture

```
src/
├── visual.ts           Thin orchestrator: Power BI lifecycle -> the modules below
├── types.ts             Shared interfaces (EmployeeNode, HierarchyResult, ViewState, ...)
├── dataMapping.ts        DataView (table) -> EmployeeRecord[]
├── hierarchy.ts           Pure tree engine: EmployeeRecord[] -> HierarchyResult + diagnostics
├── layout.ts              d3-hierarchy tree() layout -> positioned nodes/links (no DOM)
├── rendering.ts            SVG drawing (cards, connectors, expand glyphs) from a layout
├── interaction.ts          View-state machine: zoom/pan/expand/collapse/select/re-root, d3-zoom
├── settings.ts             FormattingSettingsModel (formatting pane)
└── selectionManager.ts      ISelectionManager wrapper (Power BI selection API)
```

`hierarchy.ts` has zero DOM/d3-selection/Power BI dependencies and is
independently unit tested (see `test/`).

## Hierarchy algorithm

`buildHierarchy(records)` in `hierarchy.ts`:

1. **De-duplicate** by `employeeId` — first occurrence (input array order)
   wins; every later occurrence is recorded in `diagnostics.duplicateIds`
   (with all occurrence row indexes and which one was kept) and excluded from
   the tree.
2. **Resolve parents** — for each record, decide `effectiveParentId`:
   - no `managerId` -> root.
   - `managerId === employeeId` -> self-reference; recorded in
     `diagnostics.selfReferences`, treated as root (never causes a 1-node
     infinite loop).
   - `managerId` not found among known ids -> recorded in
     `diagnostics.missingParents`, treated as root (never silently dropped).
     This is also exactly what happens if Power BI hands the visual a
     dataView where an external filter removed an employee's manager — see
     Limitations below.
3. **Cycle detection** — iterative DFS with a 3-color (unvisited /
   in-progress / done) scheme walking child→parent edges, using an explicit
   stack (never recursion), so it cannot stack-overflow on a 1000-node input
   or a pathological all-cycle input. Every distinct cycle found is recorded
   in `diagnostics.cycles` with its full path. Nodes that are cycle members
   are excluded from the buildable tree — they are not force-attached
   anywhere, because doing so would fabricate hierarchy structure the data
   doesn't actually contain. A node whose *manager* is a cycle member (but
   which is not itself in the cycle) is treated the same as a missing-parent
   case: promoted to a root and reported.
4. **Attach children** — one iterative pass, skipping cycle members.
5. **Depth and subtree counts** — BFS (iterative, explicit queue) computes
   `depth` from whichever root(s) exist; a post-order traversal (explicit
   stack, two-pass) computes `subtreeCount` (descendant count, **excluding**
   self — this matches the CSV's own `SubtreeEmployeeCount` column, verified
   in tests). No level count is ever hardcoded — depth is purely a function
   of the data.

`getSubtreeRoot`, `countSubtree`, and `collectSubtreeIds` are separate pure
helpers used both by `interaction.ts` (re-rooting the *view*) and by tests.

## Layout algorithm

`layout.ts` wraps the current view root (a pointer into the in-memory
hierarchy, not a copy) in a `d3.hierarchy()` call whose children accessor
skips any node in the current `collapsedIds` set — so d3 never even sees
collapsed subtrees. `d3.tree().nodeSize([cardWidth + hGap, cardHeight +
vGap])` is used (not the default normalized `[0,1]` layout) so card spacing
stays visually constant as nodes are expanded/collapsed, rather than
rescaling on every toggle. Output is plain `{x, y}` per node plus link
source/target pairs — no SVG/DOM.

## Interactions (Phase 2E priority order)

| # | Interaction | Status |
|---|---|---|
| 1 | Zoom in/out | Done — `d3-zoom`, scale extent 0.1x–3x |
| 2 | Pan | Done — `d3-zoom` drag/wheel on the SVG root |
| 3 | Expand/collapse a node | Done — click the +/− glyph, toggles a `Set<employeeId>` and re-renders |
| 4 | Click/select -> Power BI selection | Done — `selectionManager.ts` builds one `ISelectionId` per table row via `host.createSelectionIdBuilder().withTable(...)`, participates in standard cross-visual selection |
| 5 | "Set as Top Node" | Done — double-click a card; only `viewState.viewRootId` changes, the in-memory `HierarchyResult` (built once per `update()`) is never mutated |
| 6 | "Back to Top Node" | Done — fixed bottom-left button, visible whenever `viewRootId !== trueRootId`; restores the actual original root id, not "one level up" |
| 7 | Remember expansion state across re-root | Done for the common case — the same `collapsedIds` Set is reused across `setAsTopNode`/`backToTopNode` calls, so a node's collapse state persists as you navigate. It is **reset** only when Power BI calls `update()` with a genuinely new/filtered dataView (ids that no longer exist are pruned from the set); see Limitations. |

Click toggles the expand glyph or selects the card (selection ignored if the
click landed on the glyph); double-click re-roots the view at that employee.

## Scale strategy

1000 employees are never all rendered as SVG/DOM elements by default. On
first load, `TreeInteractionController.applyDefaultAutoExpand` collapses
every node beyond **2 levels** from the (view) root; if that still exceeds
**50** nodes, it progressively collapses the deepest included level first
until under budget. Both numbers are exposed in the formatting pane ("Root
navigation" card: *Auto-expand levels from root*, *Max nodes shown before
collapsing*) so a report author can tune them per use case. Collapsed nodes
render as a single card with a "N reports" summary label instead of
descending into their subtree — no DOM nodes are created for anything
inside a collapsed subtree.

Rationale for the defaults: 2 levels below the CEO (Executives + Directors)
is almost always a small, readable set regardless of company size, and 50
cards is comfortably interactive at default card size (~180×74px) without
needing virtualization.

## Power BI selection/filter integration

- Click-to-select calls `ISelectionManager.select()` with an `ISelectionId`
  built from the employee's table row, so selecting an employee in this
  visual participates in Power BI's standard cross-visual highlight/filter
  context like any built-in visual.
- On every `update()`, the visual re-parses `options.dataViews[0]` and
  rebuilds the hierarchy from scratch via `buildHierarchy()`. If another
  visual (e.g. a Department slicer) filters the dataView to a subset of
  employees, and that subset excludes some employees' managers, those
  employees are **not dropped** — `hierarchy.ts` promotes them to roots and
  reports them in `diagnostics.missingParents`, exactly like a genuine
  data-quality issue. The visual currently does not surface the diagnostics
  object in the UI (it's returned from `buildHierarchy` but only logged
  implicitly through `console` during development) — see Limitations.

## Limitations (plain, honest)

- **Not rendered/verified in Power BI Desktop.** Everything here was built,
  type-checked, unit-tested, and packaged from the command line; there is no
  way to launch Desktop from this environment. The `.pbiviz` has not been
  visually confirmed to render correctly, and the formatting pane has not
  been confirmed to round-trip values through Desktop's UI. TypeScript
  compiling cleanly and `pbiviz package` succeeding are strong signals but
  not proof of correct on-canvas behavior.
- **Diagnostics are not surfaced in the UI.** `hierarchy.ts` computes a full
  diagnostics report (missing parents, cycles, duplicates, self-references)
  but `visual.ts` does not currently display it anywhere (no warning icon,
  no tooltip, no debug panel). On the real 1000-employee dataset this
  doesn't matter (diagnostics are all empty), but if a user filters to a
  subset that orphans employees, or the underlying data has a real quality
  issue, the visual will silently promote the affected employees to
  additional roots rather than telling the user why. Wiring a visible
  diagnostics affordance is straightforward future work.
- **Expansion-state persistence across a Power BI filter change is
  best-effort, not guaranteed.** `collapsedIds` and `selectedId` survive a
  re-render (resize, formatting change, or a filter that doesn't remove the
  current view root) because `interaction.ts` keeps the same `ViewState`
  object and only prunes ids that no longer exist. But if the current view
  root itself is filtered out of the new dataView, there's no reasonable
  place to preserve a "view root" that longer exists, so the view resets to
  the (new) true root and the collapse set is pruned around that. This is a
  deliberate, documented trade-off, not an oversight.
- **Cross-report drillthrough is not implemented.** Out of scope per the
  Stage 2 spec ("Phase 2M — do not do these yet" implicitly covers this;
  it was never attempted).
- **Department/Team/ManagementLevel roles are parsed but not yet rendered**
  on the card or used for coloring/filtering within the visual itself — they
  are captured in `EmployeeRecord` for future use (e.g. department-colored
  borders) but the MVP only surfaces designation + up to two metrics per the
  Phase 2D/2F spec's minimum bar.
- **No accessibility/keyboard navigation, tooltips, context menu, or high-
  contrast handling.** `pbiviz package`'s own output flags these as
  recommended-but-optional features this visual doesn't yet implement
  (Allow Interactions, Keyboard Navigation, Tooltips, High Contrast, Context
  Menu, Landing Page, Localization, Selection Across Visuals). All are
  legitimate follow-up work, explicitly deferred here to stay inside the
  Stage 2 MVP scope.
- **CSV parsing in the "manual" sense is not needed at runtime** — the CSV
  is only read by `test/csvFixture.ts` for the automated test suite (Jest,
  Node `fs`), never by the shipped visual, and it is never modified.

## PBIP report changes (`OrgAnalytics.Report`)

Added a new page, `Org Tree Test` (folder id `a1b2c3d4e5f6a7b8c9d0`), appended
after the existing `Overview` page in `pages.json`'s `pageOrder`.
`activePageName` was left unchanged (`Overview`), per the instruction not to
move it without good reason. The `Overview` page's own `page.json` was not
touched.

The new page currently contains three fully-wired, standard Power BI slicer
visuals (each a real `visual.json` under
`definition/pages/a1b2c3d4e5f6a7b8c9d0/visuals/<name>/`, schema
`visualContainer/2.9.0`, matching this project's own
`reportVersionAtImport.visual: "2.9.0"`):

| Visual folder | Bound field | Position |
|---|---|---|
| `sliceDepartment` | `Employee[Department]` | x=20, y=20, 260×200 |
| `sliceManagementScope` | `Employee[ManagementScope]` | x=300, y=20, 260×200 |
| `sliceTeam` | `Employee[Team]` | x=580, y=20, 260×200 |

### Organization Tree visual — not auto-wired; manual step required

Hand-authoring a fully-bound `visual.json` for a **private, locally-imported**
custom visual (as opposed to an AppSource-registered one, which goes through
`report.json`'s `publicCustomVisuals` GUID array — a different, inapplicable
mechanism for this case) could not be verified without opening the file in
Power BI Desktop, and getting it wrong produces a **blocking error** that
prevents Desktop from opening the *entire report* on next open — an
unacceptable risk to Stage 1's already-working project. Per the task's own
explicit fallback instruction, the Organization Tree visual was **not**
auto-wired into the page; do this manually in Power BI Desktop:

1. Open `OrgAnalytics.pbip` in Power BI Desktop.
2. Go to the **Org Tree Test** page (already created, with the three slicers
   in place).
3. **Insert > More visuals > Import a visual from a file...**
4. Select
   `OrganizationTreeVisual/dist/organizationTreeVisual017D3F387FC247D9873BDFAE44E9015C.1.0.0.0.pbiviz`.
5. Drag the new **Organization Tree** icon from the Visualizations pane onto
   the empty canvas area below the slicers (roughly y=240 to the bottom of
   the page).
6. With the visual selected, bind fields from the `Employee` table in the
   Data pane:
   - **Employee ID** -> `EmployeeID`
   - **Employee Name** -> `EmployeeName`
   - **Manager ID** -> `ManagerID`
   - **Manager Name** -> `ManagerName` (optional)
   - **Designation** -> `Designation` (optional)
   - **Department** -> `Department` (optional)
   - **Team** -> `Team` (optional)
   - **Management Level** -> `ManagementLevel` (optional)
   - **Metrics** -> drag in e.g. `AnnualSalaryINR`, `PerformanceScore`,
     `AttendancePct`, `EngagementScore`, `GoalsAchievedPct`,
     `AttritionRiskPct`, `DirectReports`, `SubtreeEmployeeCount` (up to 8;
     the formatting pane's "Metrics display" card controls which of the
     first two bound are actually shown on each card)
7. Save. Desktop will place the visual's metadata into
   `OrgAnalytics.Report/CustomVisuals/` and write its own `visual.json` for
   it — safe to commit at that point.

## Build / test / import

From `OrganizationTreeVisual/`:

```
npm install          # already done in this environment
npm run test          # runs the Jest suite (hierarchy.ts + dataMapping.ts)
npm run package        # runs pbiviz package -> dist/*.pbiviz
```

To try the visual in Desktop without publishing: `npm start` runs
`pbiviz start` (a local dev server); this was not exercised in this
environment because it requires a signed certificate / Desktop's Developer
Visual, and building+packaging was judged the higher-value verification for
a headless environment.

## Judgment calls made (no spec ambiguity left undocumented)

- `SubtreeEmployeeCount`'s semantics (excludes self) was empirically
  determined by cross-checking against `hierarchy.ts` and encoded as
  `EmployeeNode.subtreeCount`'s documented meaning; `countSubtree()` (which
  includes self) is kept as a separate helper for the "how many nodes total"
  use case.
- CSV's `HierarchyDepth` is 1-based (root = 1); `hierarchy.ts`'s computed
  `depth` is 0-based (root = 0) for more natural array/BFS indexing. The
  test suite asserts the exact relationship (`node.depth === csvDepth - 1`)
  rather than picking one convention silently.
- The visual's file name for the private `.pbiviz` reference in Desktop
  import instructions uses the auto-generated GUID-suffixed name pbiviz
  produced (`organizationTreeVisual017D3F387FC247D9873BDFAE44E9015C`) —
  this is deterministic per `pbiviz.json`'s `guid` field and was not
  hand-tuned.
- Auto-expand defaults (2 levels / 50 nodes) and card default size
  (180×74px) are reasonable MVP defaults, not derived from a specific
  requirement — both are exposed as formatting-pane settings so they're
  tunable without a rebuild.
