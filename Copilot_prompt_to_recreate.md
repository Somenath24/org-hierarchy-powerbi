# Power BI Organization Analytics POC — GitHub Copilot Recreation Prompts

Use these three prompts in order in a different system with GitHub Copilot.

## Critical architecture rule

Do **not** hard-code project-specific column names into the custom visual.

The visual should use generic Power BI data roles such as Employee ID, Employee Name, Manager ID, Designation, Department, Team, and configurable Card Metrics. Different projects can map different source columns to those roles without changing the visual.

---

# STEP 1 — Create the Power BI PBIP/TMDL POC

## Prompt

You are working in a Windows development environment. Create a Power BI organizational analytics POC using Power BI Project (PBIP) format with a TMDL semantic model.

Create the project in the current folder.

### Requirements

1. Use PBIP, not PBIX.
2. Use a TMDL-based semantic model.
3. Create:

```text
powerbi/
├── OrgAnalytics.pbip
├── OrgAnalytics.Report/
├── OrgAnalytics.SemanticModel/
├── organization_employee_synthetic_1000_final.csv
└── .gitignore
```

4. Use `organization_employee_synthetic_1000_final.csv` as the source.
5. Load the data into a semantic model table named `Employee`.
6. Preserve source columns rather than unnecessarily renaming them.
7. Create these useful measures:

- Total Employees
- Total Managers
- Total Teams
- Average Performance
- Average Salary
- Average Attendance
- Average Engagement
- Average Goals Achieved
- Low Performer Count
- Promotion Eligible Count
- Average Attrition Risk

8. Create an `Overview` report page with useful KPI cards/charts.
9. Create an `Org Tree Test` page for the future custom visual.
10. Add useful slicers such as Department, Team, Management Level, and Employment Status.
11. Make the PBIP open successfully in the current Power BI Desktop version.
12. Follow the current PBIP/PBIR schema. Do not invent or guess JSON structures.
13. Include required PBIP/PBIR metadata such as `version.json` where required.
14. Keep the project source-control friendly.
15. Do not use paid/external Power BI visuals.

### Validation

Before finishing:

- Validate all JSON.
- Validate TMDL.
- Verify the CSV loads.
- Verify all measures.
- Verify report structure.
- Verify the PBIP opens if Power BI Desktop is available.
- Report exactly what was created and any limitations.

Do not begin custom-visual development until the PBIP semantic model and report are valid.

---

# STEP 2 — Build the custom Organization Tree visual

## Prompt

Build an in-house Power BI custom visual named `OrganizationTreeVisual`.

The visual must be reusable across organizational datasets. Do **not** hard-code source column names such as `EmployeeID`, `ManagerID`, `PerformanceScore`, etc. Use Power BI data roles.

The final output must include a `.pbiviz` package.

### Technology

Use:

- TypeScript
- Official Power BI Custom Visual SDK/tooling
- d3-hierarchy for hierarchy layout
- SVG rendering
- Power BI Selection Manager/API

Keep the visual self-contained. Do not require external APIs, external websites, tracking, remote images, or paid visual libraries.

### Required generic data roles

Create:

```text
Employee ID        required
Employee Name      required
Manager ID         required

Designation        optional
Department         optional
Team               optional

Card Metric 1      optional
Card Metric 2      optional
Card Metric 3      optional
Card Metric 4      optional
```

The actual Power BI column mapped to each role can have any name.

Example:

```text
Emp_No             -> Employee ID
Employee_Name      -> Employee Name
Reports_To         -> Manager ID
Job_Title          -> Designation
Business_Unit      -> Department
Team_Name          -> Team
KPI Achievement    -> Card Metric 1
Utilization        -> Card Metric 2
```

The visual must not know or care about those source names.

### Hierarchy

Support structures such as:

```text
CEO
 └── Director
      └── Senior Manager
           └── Manager
                └── Team Lead
                     └── Individual Contributor
```

Do not assume exactly six levels.

Implement:

1. Build hierarchy from Employee ID + Manager ID.
2. Identify root.
3. Detect orphans.
4. Detect cycles.
5. Detect self-references.
6. Handle malformed data safely.
7. Support large organizational datasets.
8. Preserve Power BI identity for each employee.

### Cards

Render employees/managers as cards showing:

- Employee name
- Designation
- Department
- Team
- Configurable metrics
- Direct-report/subtree information where available

Do not hard-code a business metric such as PerformanceScore.

### Interaction

Implement:

1. Click employee card.
2. Use Power BI Selection Manager.
3. Selection must cross-filter/cross-highlight other Power BI visuals where supported.
4. Support multi-selection where practical.
5. `+/-` expand/collapse.
6. Zoom.
7. Pan.
8. Fit/reset.
9. Clear selection.

### Set visual root

Implement:

- `Set as Top Node`
- `Back to Top Node`

Example:

```text
Original:
CEO
 ├── Director A
 │    ├── Manager A
 │    └── Manager B
 └── Director B
```

After setting Manager A as visual root:

```text
Manager A
 ├── Team Lead A
 │    ├── Employee 1
 │    └── Employee 2
 └── Team Lead B
```

Only that manager's subtree is displayed.

`Back to Top Node` restores the original root.

Set-root is visual navigation state. It must not break normal Power BI selection/filter state.

### Architecture

Separate concerns:

```text
src/
├── types/
├── hierarchy/
├── dataMapping/
├── layout/
├── rendering/
├── interaction/
├── selection/
├── settings/
└── visual.ts
```

Keep Power BI data-role mapping, hierarchy construction, layout, card rendering, interaction, selection, and settings logically separate.

### Tests

Test:

- one root
- multiple roots
- orphans
- cycles
- self-reference
- arbitrary hierarchy depth
- expand/collapse
- set-root/back-to-top
- data-role mapping
- selection identity
- full 1,000-row dataset if available

### Build

Create:

```text
OrganizationTreeVisual/dist/*.pbiviz
```

Preserve the complete source code so it can be rebuilt later.

Do not automatically modify the PBIP report to embed/register the custom visual if doing so risks corrupting report JSON. Manual `.pbiviz` import into Power BI Desktop is acceptable.

At completion report:

- source location
- `.pbiviz` location
- build command
- test results
- data roles
- interactions
- manual Power BI steps

---

# STEP 3 — Make employee cards configurable and project-independent

## Prompt

Refactor the existing `OrganizationTreeVisual` without breaking its current functionality.

Current functionality already working:

- hierarchy rendering
- `+/-` expand/collapse
- card selection
- Power BI cross-filtering
- zoom/pan
- organizational hierarchy navigation

Do not regress these features.

## Main objective

Make employee-card contents configurable through Power BI data roles/settings.

The visual must not depend on business-specific source column names.

For example, one project may have:

```text
PerformanceScore
```

while another has:

```text
KPI Achievement %
Revenue Target
Customer Satisfaction
Billable Utilization
Quality Score
```

The same `.pbiviz` must support these without changing TypeScript.

## Generic data roles

Use:

```text
Employee ID
Employee Name
Manager ID

Designation
Department
Team

Card Metric 1
Card Metric 2
Card Metric 3
Card Metric 4
```

Optionally support configurable display labels.

Example:

```text
Card Metric 1 -> KPI Achievement % -> "KPI"
Card Metric 2 -> Utilization %     -> "Utilization"
Card Metric 3 -> Revenue            -> "Revenue"
```

The underlying source column name must never be assumed by the renderer.

## Card data structure

Refactor toward a generic structure such as:

```text
Employee
 ├── Name
 ├── Designation
 ├── Department
 ├── Team
 └── Metrics[]
      ├── Metric 1
      ├── Metric 2
      ├── Metric 3
      └── Metric 4
```

Do not write renderer logic such as:

```typescript
employee.performanceScore
employee.attendancePct
employee.salary
```

unless those values are explicitly supplied through generic roles.

Prefer:

```typescript
employee.metrics
```

or an equivalent generic structure.

## Optional settings

Where practical, expose settings for:

- show/hide designation
- show/hide department
- show/hide team
- show/hide metrics
- metric-label visibility
- card width
- card height
- font sizes
- spacing
- maximum visible metrics

Do not over-engineer the first version.

## Critical separation

### Data mapping

Power BI decides:

```text
Employee ID     -> ActualEmployeeNumber
Employee Name   -> FullName
Manager ID      -> ReportsToEmployee
Designation     -> JobTitle
Department      -> BusinessUnit
Team            -> TeamName
Metric 1        -> KPIAchievement
Metric 2        -> UtilizationRate
```

### Visual behavior

The custom visual decides:

```text
How to build the hierarchy
How to draw cards
How to display metrics
How to expand/collapse
How to select
How to set a visual root
How to zoom/pan
```

Do not mix these layers.

## Compatibility requirement

The same `.pbiviz` must work with multiple projects.

Project A:

```text
Metric 1 = Performance
Metric 2 = Attendance
Metric 3 = Engagement
```

Project B:

```text
Metric 1 = Revenue Achievement
Metric 2 = Customer Satisfaction
Metric 3 = Utilization
```

No TypeScript modification or rebuild should be required.

## Regression testing

After refactoring verify:

- 1,000-row hierarchy renders.
- Root detection works.
- `+/-` works.
- Card selection cross-filters other Power BI visuals.
- Zoom/pan works.
- Set as Top Node works.
- Back to Top Node works.
- Missing optional fields do not crash the visual.
- Missing metrics do not create broken UI.
- Different metric types display safely.
- No source-specific field names are hard-coded.

Run the full test suite and build a new `.pbiviz`.

Report:

- files changed
- new data roles
- new settings
- tests passed
- `.pbiviz` output path
- manual Power BI steps

Do not unnecessarily change the existing hierarchy or selection architecture.
