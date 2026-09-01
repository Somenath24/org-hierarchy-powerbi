/*
 *  Test-only helper: reads the real 1000-employee CSV (read-only, never
 *  modified) and converts it into hierarchy.ts's input shape. This file is
 *  test infrastructure, not part of the shipped visual bundle.
 */

"use strict";

import * as fs from "fs";
import * as path from "path";
import { EmployeeRecord } from "../src/types";

// The CSV lives at the powerbi project root, one level above OrganizationTreeVisual/.
const CSV_PATH = path.resolve(__dirname, "..", "..", "organization_employee_synthetic_1000_final.csv");

/** Minimal CSV line splitter — the source file has no embedded commas/quotes in these columns. */
function splitCsvLine(line: string): string[] {
    return line.split(",");
}

export interface CsvEmployeeRow {
    record: EmployeeRecord;
    hierarchyDepthFromCsv: number;
    subtreeEmployeeCountFromCsv: number;
}

export function loadCsvFixture(): CsvEmployeeRow[] {
    const content = fs.readFileSync(CSV_PATH, "utf-8");
    const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
    const header = splitCsvLine(lines[0]);

    const col = (name: string): number => {
        const idx = header.indexOf(name);
        if (idx === -1) {
            throw new Error(`Column not found in CSV header: ${name}`);
        }
        return idx;
    };

    const idxEmployeeId = col("EmployeeID");
    const idxEmployeeName = col("EmployeeName");
    const idxManagerId = col("ManagerID");
    const idxManagerName = col("ManagerName");
    const idxDesignation = col("Designation");
    const idxDepartment = col("Department");
    const idxTeam = col("Team");
    const idxManagementLevel = col("ManagementLevel");
    const idxHierarchyDepth = col("HierarchyDepth");
    const idxSubtreeEmployeeCount = col("SubtreeEmployeeCount");

    const rows: CsvEmployeeRow[] = [];

    for (let i = 1; i < lines.length; i++) {
        const cells = splitCsvLine(lines[i]);
        const managerIdRaw = cells[idxManagerId];

        const record: EmployeeRecord = {
            employeeId: cells[idxEmployeeId],
            employeeName: cells[idxEmployeeName],
            managerId: managerIdRaw === "" || managerIdRaw === undefined ? null : managerIdRaw,
            managerName: cells[idxManagerName] || null,
            designation: cells[idxDesignation] || null,
            department: cells[idxDepartment] || null,
            team: cells[idxTeam] || null,
            managementLevel: cells[idxManagementLevel] ? Number(cells[idxManagementLevel]) : null,
            metrics: {},
            rowIndex: i - 1
        };

        rows.push({
            record,
            hierarchyDepthFromCsv: Number(cells[idxHierarchyDepth]),
            subtreeEmployeeCountFromCsv: Number(cells[idxSubtreeEmployeeCount])
        });
    }

    return rows;
}
