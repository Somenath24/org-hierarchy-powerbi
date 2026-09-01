/*
 *  Organization Tree Visual — Power BI selection integration.
 *
 *  Thin wrapper around powerbi.extensibility.ISelectionManager so the rest of
 *  the visual (interaction.ts) doesn't need to know the Power BI selection API
 *  directly. Builds one ISelectionId per employee row via the host's
 *  createSelectionIdBuilder, keyed off the table row index — this participates
 *  in Power BI's standard cross-visual selection/highlight/filter context.
 */

"use strict";

import powerbi from "powerbi-visuals-api";
import { EmployeeRecord } from "./types";

import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import DataView = powerbi.DataView;

export class SelectionHandler {
    private selectionManager: ISelectionManager;
    private host: IVisualHost;
    private idByEmployeeId: Map<string, ISelectionId> = new Map();

    constructor(host: IVisualHost) {
        this.host = host;
        this.selectionManager = host.createSelectionManager();
    }

    /**
     * Rebuilds the employeeId -> ISelectionId map. Must be called after every
     * dataMapping.parseDataView() so selection ids stay in sync with the
     * current (possibly filtered) DataView's table rows.
     */
    public rebuild(dataView: DataView, records: EmployeeRecord[]): void {
        this.idByEmployeeId.clear();
        if (!dataView.table) {
            return;
        }
        records.forEach((record) => {
            const selectionId = this.host
                .createSelectionIdBuilder()
                .withTable(dataView.table as powerbi.DataViewTable, record.rowIndex)
                .createSelectionId();
            this.idByEmployeeId.set(record.employeeId, selectionId);
        });
    }

    public getSelectionId(employeeId: string): ISelectionId | undefined {
        return this.idByEmployeeId.get(employeeId);
    }

    public async select(employeeId: string, multiSelect: boolean = false): Promise<void> {
        const id = this.idByEmployeeId.get(employeeId);
        if (!id) {
            return;
        }
        await this.selectionManager.select(id, multiSelect);
    }

    public async clear(): Promise<void> {
        await this.selectionManager.clear();
    }

    public getSelectionManager(): ISelectionManager {
        return this.selectionManager;
    }

    /** Returns the set of employeeIds currently selected, per Power BI's own selection state. */
    public getSelectedEmployeeIds(): Set<string> {
        const selectedIds = this.selectionManager.getSelectionIds() as ISelectionId[];
        const result = new Set<string>();
        if (!selectedIds || selectedIds.length === 0) {
            return result;
        }
        this.idByEmployeeId.forEach((id, employeeId) => {
            if (selectedIds.some((sel) => sel.equals(id))) {
                result.add(employeeId);
            }
        });
        return result;
    }

    public registerOnSelectCallback(callback: () => void): void {
        this.selectionManager.registerOnSelectCallback(callback);
    }
}
