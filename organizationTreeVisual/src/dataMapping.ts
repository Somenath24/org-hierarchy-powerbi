/*
 *  Organization Tree Visual — DataView parsing.
 *
 *  Converts a Power BI table-mapped DataView into EmployeeRecord[] using the
 *  data roles declared in capabilities.json. Kept separate from hierarchy.ts
 *  so "read Power BI's shape" and "build a tree" are independent concerns —
 *  dataMapping.ts is the only file that knows about DataViewTable internals.
 */

"use strict";

import powerbi from "powerbi-visuals-api";
import { EmployeeRecord } from "./types";

import DataView = powerbi.DataView;
import DataViewTable = powerbi.DataViewTable;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;

/** Role names, must match capabilities.json's dataRoles[].name exactly. */
export const ROLE = {
    employeeId: "employeeId",
    employeeName: "employeeName",
    managerId: "managerId",
    managerName: "managerName",
    designation: "designation",
    department: "department",
    team: "team",
    managementLevel: "managementLevel",
    metrics: "metrics"
} as const;

export interface ParsedDataView {
    records: EmployeeRecord[];
    /** Display names of every "metrics" measure column actually bound, in column order. */
    metricNames: string[];
    /** True when the required roles (employeeId, employeeName, managerId) are all bound. */
    hasRequiredRoles: boolean;
}

function findColumnIndex(columns: DataViewMetadataColumn[], role: string): number {
    return columns.findIndex((c) => c.roles && c.roles[role]);
}

function findAllColumnIndexes(columns: DataViewMetadataColumn[], role: string): number[] {
    const indexes: number[] = [];
    columns.forEach((c, i) => {
        if (c.roles && c.roles[role]) {
            indexes.push(i);
        }
    });
    return indexes;
}

function toStringOrNull(value: unknown): string | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    return String(value);
}

function toNumberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/**
 * Parses a table-mapped DataView into flat EmployeeRecord rows. Returns an
 * empty, well-formed result (never throws) when dataViews/table is missing —
 * matches Power BI's contract that update() can be called with no data
 * (e.g. all roles unbound, or a filter has emptied the dataset).
 */
export function parseDataView(dataView: DataView | undefined): ParsedDataView {
    const empty: ParsedDataView = { records: [], metricNames: [], hasRequiredRoles: false };

    if (!dataView || !dataView.table) {
        return empty;
    }

    const table: DataViewTable = dataView.table;
    const columns = table.columns ?? [];
    const rows = table.rows ?? [];

    const idxEmployeeId = findColumnIndex(columns, ROLE.employeeId);
    const idxEmployeeName = findColumnIndex(columns, ROLE.employeeName);
    const idxManagerId = findColumnIndex(columns, ROLE.managerId);
    const idxManagerName = findColumnIndex(columns, ROLE.managerName);
    const idxDesignation = findColumnIndex(columns, ROLE.designation);
    const idxDepartment = findColumnIndex(columns, ROLE.department);
    const idxTeam = findColumnIndex(columns, ROLE.team);
    const idxManagementLevel = findColumnIndex(columns, ROLE.managementLevel);
    const metricIndexes = findAllColumnIndexes(columns, ROLE.metrics);
    const metricNames = metricIndexes.map((i) => columns[i].displayName);

    const hasRequiredRoles = idxEmployeeId >= 0 && idxEmployeeName >= 0 && idxManagerId >= 0;

    if (!hasRequiredRoles) {
        return { records: [], metricNames, hasRequiredRoles: false };
    }

    const records: EmployeeRecord[] = rows.map((row, rowIndex) => {
        const metrics: Record<string, number | null> = {};
        metricIndexes.forEach((colIdx, i) => {
            metrics[metricNames[i]] = toNumberOrNull(row[colIdx]);
        });

        const employeeId = toStringOrNull(row[idxEmployeeId]) ?? `__missing_id_${rowIndex}`;
        const employeeName = toStringOrNull(row[idxEmployeeName]) ?? employeeId;

        return {
            employeeId,
            employeeName,
            managerId: idxManagerId >= 0 ? toStringOrNull(row[idxManagerId]) : null,
            managerName: idxManagerName >= 0 ? toStringOrNull(row[idxManagerName]) : null,
            designation: idxDesignation >= 0 ? toStringOrNull(row[idxDesignation]) : null,
            department: idxDepartment >= 0 ? toStringOrNull(row[idxDepartment]) : null,
            team: idxTeam >= 0 ? toStringOrNull(row[idxTeam]) : null,
            managementLevel: idxManagementLevel >= 0 ? toNumberOrNull(row[idxManagementLevel]) : null,
            metrics,
            rowIndex
        };
    });

    return { records, metricNames, hasRequiredRoles: true };
}
