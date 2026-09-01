/*
 *  Unit tests for dataMapping.ts — DataView -> EmployeeRecord[] parsing.
 *  Uses hand-built minimal DataView-shaped objects rather than the full
 *  Power BI runtime (which cannot be instantiated outside Desktop).
 */

"use strict";

import powerbi from "powerbi-visuals-api";
import { parseDataView } from "../src/dataMapping";

type DataView = powerbi.DataView;

function buildTableDataView(
    columns: { displayName: string; roles: Record<string, boolean> }[],
    rows: powerbi.DataViewTableRow[]
): DataView {
    return {
        table: {
            columns: columns.map((c) => ({ displayName: c.displayName, roles: c.roles } as powerbi.DataViewMetadataColumn)),
            rows
        },
        metadata: { columns: [] }
    } as unknown as DataView;
}

describe("dataMapping.ts", () => {
    test("returns empty, well-formed result when dataView is undefined", () => {
        const parsed = parseDataView(undefined);
        expect(parsed.records).toEqual([]);
        expect(parsed.hasRequiredRoles).toBe(false);
    });

    test("returns hasRequiredRoles=false when required roles are unbound", () => {
        const dv = buildTableDataView(
            [{ displayName: "Designation", roles: { designation: true } }],
            [["VP"]]
        );
        const parsed = parseDataView(dv);
        expect(parsed.hasRequiredRoles).toBe(false);
        expect(parsed.records).toEqual([]);
    });

    test("parses required + optional roles and multiple metrics columns", () => {
        const dv = buildTableDataView(
            [
                { displayName: "Employee ID", roles: { employeeId: true } },
                { displayName: "Employee Name", roles: { employeeName: true } },
                { displayName: "Manager ID", roles: { managerId: true } },
                { displayName: "Designation", roles: { designation: true } },
                { displayName: "AnnualSalaryINR", roles: { metrics: true } },
                { displayName: "PerformanceScore", roles: { metrics: true } }
            ],
            [
                ["10001", "Aarav Sharma", null, "CEO", 19130000, 69.9],
                ["10002", "Vivaan Sharma", "10001", "Director", 4590000, 84.3]
            ]
        );

        const parsed = parseDataView(dv);
        expect(parsed.hasRequiredRoles).toBe(true);
        expect(parsed.records).toHaveLength(2);
        expect(parsed.metricNames).toEqual(["AnnualSalaryINR", "PerformanceScore"]);

        const first = parsed.records[0];
        expect(first.employeeId).toBe("10001");
        expect(first.managerId).toBeNull();
        expect(first.metrics["AnnualSalaryINR"]).toBe(19130000);
        expect(first.metrics["PerformanceScore"]).toBe(69.9);

        const second = parsed.records[1];
        expect(second.managerId).toBe("10001");
        expect(second.rowIndex).toBe(1);
    });

    test("handles empty rows array without throwing", () => {
        const dv = buildTableDataView(
            [
                { displayName: "Employee ID", roles: { employeeId: true } },
                { displayName: "Employee Name", roles: { employeeName: true } },
                { displayName: "Manager ID", roles: { managerId: true } }
            ],
            []
        );
        const parsed = parseDataView(dv);
        expect(parsed.hasRequiredRoles).toBe(true);
        expect(parsed.records).toEqual([]);
    });
});
