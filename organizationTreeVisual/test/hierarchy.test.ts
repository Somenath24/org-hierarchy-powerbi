/*
 *  Unit tests for hierarchy.ts — pure tree-construction logic.
 *  Covers the 13 scenarios called out in the Stage 2 spec (Phase 2L).
 */

"use strict";

import { buildHierarchy, collectSubtreeIds, countSubtree, getSubtreeRoot } from "../src/hierarchy";
import { EmployeeRecord } from "../src/types";
import { loadCsvFixture } from "./csvFixture";

function rec(partial: Partial<EmployeeRecord> & { employeeId: string }): EmployeeRecord {
    return {
        employeeId: partial.employeeId,
        employeeName: partial.employeeName ?? `Employee ${partial.employeeId}`,
        managerId: partial.managerId ?? null,
        managerName: partial.managerName ?? null,
        designation: partial.designation ?? null,
        department: partial.department ?? null,
        team: partial.team ?? null,
        managementLevel: partial.managementLevel ?? null,
        metrics: partial.metrics ?? {},
        rowIndex: partial.rowIndex ?? 0
    };
}

describe("hierarchy.ts — basic structure", () => {
    test("1. single root, no children", () => {
        const result = buildHierarchy([rec({ employeeId: "1", rowIndex: 0 })]);
        expect(result.roots).toHaveLength(1);
        expect(result.roots[0].record.employeeId).toBe("1");
        expect(result.roots[0].children).toHaveLength(0);
        expect(result.diagnostics.rootIds).toEqual(["1"]);
        expect(result.diagnostics.includedNodeCount).toBe(1);
    });

    test("2. multiple levels (5 deep)", () => {
        const records = [
            rec({ employeeId: "1", managerId: null, rowIndex: 0 }),
            rec({ employeeId: "2", managerId: "1", rowIndex: 1 }),
            rec({ employeeId: "3", managerId: "2", rowIndex: 2 }),
            rec({ employeeId: "4", managerId: "3", rowIndex: 3 }),
            rec({ employeeId: "5", managerId: "4", rowIndex: 4 })
        ];
        const result = buildHierarchy(records);
        expect(result.roots).toHaveLength(1);
        const node5 = result.nodesById.get("5");
        expect(node5?.depth).toBe(4); // root is depth 0, so 5 levels down = depth 4
        expect(result.diagnostics.includedNodeCount).toBe(5);
    });

    test("3. multiple children per node", () => {
        const records = [
            rec({ employeeId: "1", managerId: null, rowIndex: 0 }),
            rec({ employeeId: "2", managerId: "1", rowIndex: 1 }),
            rec({ employeeId: "3", managerId: "1", rowIndex: 2 }),
            rec({ employeeId: "4", managerId: "1", rowIndex: 3 })
        ];
        const result = buildHierarchy(records);
        expect(result.roots[0].children).toHaveLength(3);
        expect(result.roots[0].subtreeCount).toBe(3);
    });

    test("4. leaf employee has no children", () => {
        const records = [
            rec({ employeeId: "1", managerId: null, rowIndex: 0 }),
            rec({ employeeId: "2", managerId: "1", rowIndex: 1 })
        ];
        const result = buildHierarchy(records);
        const leaf = result.nodesById.get("2");
        expect(leaf?.children).toHaveLength(0);
        expect(leaf?.subtreeCount).toBe(0);
    });
});

describe("hierarchy.ts — data quality edge cases", () => {
    test("5. missing manager -> becomes a root, reported in diagnostics, not dropped", () => {
        const records = [
            rec({ employeeId: "1", managerId: null, rowIndex: 0 }),
            rec({ employeeId: "2", managerId: "999", rowIndex: 1 }) // 999 doesn't exist
        ];
        const result = buildHierarchy(records);
        expect(result.diagnostics.missingParents).toHaveLength(1);
        expect(result.diagnostics.missingParents[0]).toEqual({ employeeId: "2", managerId: "999" });
        // Not silently dropped: node 2 must still exist somewhere in the tree.
        expect(result.nodesById.has("2")).toBe(true);
        expect(result.diagnostics.rootIds).toContain("2");
        expect(result.diagnostics.includedNodeCount).toBe(2);
    });

    test("6. duplicate EmployeeID -> deterministic dedup, first occurrence wins, reported", () => {
        const records = [
            rec({ employeeId: "1", managerId: null, rowIndex: 0 }),
            rec({ employeeId: "2", managerId: "1", employeeName: "First Version", rowIndex: 1 }),
            rec({ employeeId: "2", managerId: "1", employeeName: "Second Version (duplicate)", rowIndex: 2 })
        ];
        const result = buildHierarchy(records);
        expect(result.diagnostics.duplicateIds).toHaveLength(1);
        expect(result.diagnostics.duplicateIds[0].employeeId).toBe("2");
        expect(result.diagnostics.duplicateIds[0].occurrences).toEqual([1, 2]);
        expect(result.diagnostics.duplicateIds[0].keptRowIndex).toBe(1);
        // Only one node "2" ends up in the tree, and it's the first occurrence's data.
        const node2 = result.nodesById.get("2");
        expect(node2?.record.employeeName).toBe("First Version");
        expect(result.diagnostics.includedNodeCount).toBe(2); // root + node 2 (duplicate excluded)
    });

    test("7. self-reference -> detected, becomes root, not infinite-looped", () => {
        const records = [rec({ employeeId: "1", managerId: "1", rowIndex: 0 })];
        const result = buildHierarchy(records);
        expect(result.diagnostics.selfReferences).toEqual([{ employeeId: "1" }]);
        expect(result.diagnostics.rootIds).toEqual(["1"]);
        expect(result.diagnostics.includedNodeCount).toBe(1);
    });

    test("8. cycle A->B->C->A -> detected, does not crash or infinite-loop", () => {
        const records = [
            rec({ employeeId: "A", managerId: "C", rowIndex: 0 }),
            rec({ employeeId: "B", managerId: "A", rowIndex: 1 }),
            rec({ employeeId: "C", managerId: "B", rowIndex: 2 })
        ];
        const result = buildHierarchy(records);
        expect(result.diagnostics.cycles.length).toBeGreaterThanOrEqual(1);
        const cycleIds = new Set(result.diagnostics.cycles[0].path);
        expect(cycleIds.has("A")).toBe(true);
        expect(cycleIds.has("B")).toBe(true);
        expect(cycleIds.has("C")).toBe(true);
        // No roots should be produced from a pure 3-node cycle with no valid entry point.
        expect(result.roots).toHaveLength(0);
        expect(result.diagnostics.includedNodeCount).toBe(0);
    });

    test("8b. cycle with an external node hanging off it does not crash and excludes the cyclical branch", () => {
        const records = [
            rec({ employeeId: "root", managerId: null, rowIndex: 0 }),
            rec({ employeeId: "A", managerId: "C", rowIndex: 1 }),
            rec({ employeeId: "B", managerId: "A", rowIndex: 2 }),
            rec({ employeeId: "C", managerId: "B", rowIndex: 3 }),
            rec({ employeeId: "D", managerId: "root", rowIndex: 4 }) // valid, unrelated to the cycle
        ];
        const result = buildHierarchy(records);
        expect(result.diagnostics.cycles.length).toBeGreaterThanOrEqual(1);
        expect(result.nodesById.get("root")?.children.map((c) => c.record.employeeId)).toEqual(["D"]);
        expect(result.diagnostics.includedNodeCount).toBe(2); // root + D only
    });

    test("9. empty input array returns a valid, empty result without throwing", () => {
        expect(() => buildHierarchy([])).not.toThrow();
        const result = buildHierarchy([]);
        expect(result.roots).toEqual([]);
        expect(result.diagnostics.totalInputRows).toBe(0);
        expect(result.diagnostics.includedNodeCount).toBe(0);
    });
});

describe("hierarchy.ts — subtree / re-root behavior", () => {
    test("12. subtree calculation correctness on a small synthetic fixture", () => {
        // root -> M1 -> {L1, L2}; root -> M2 -> {L3}
        const records = [
            rec({ employeeId: "root", managerId: null, rowIndex: 0 }),
            rec({ employeeId: "M1", managerId: "root", rowIndex: 1 }),
            rec({ employeeId: "M2", managerId: "root", rowIndex: 2 }),
            rec({ employeeId: "L1", managerId: "M1", rowIndex: 3 }),
            rec({ employeeId: "L2", managerId: "M1", rowIndex: 4 }),
            rec({ employeeId: "L3", managerId: "M2", rowIndex: 5 })
        ];
        const result = buildHierarchy(records);

        const m1 = result.nodesById.get("M1")!;
        expect(collectSubtreeIds(m1)).toEqual(new Set(["M1", "L1", "L2"]));
        expect(countSubtree(m1)).toBe(3);
        expect(m1.subtreeCount).toBe(2); // subtreeCount excludes self

        const root = result.roots[0];
        expect(countSubtree(root)).toBe(6);
        expect(root.subtreeCount).toBe(5);
    });

    test("11. selecting a manager as new view-root produces exactly that manager's descendants", () => {
        const records = [
            rec({ employeeId: "root", managerId: null, rowIndex: 0 }),
            rec({ employeeId: "M1", managerId: "root", rowIndex: 1 }),
            rec({ employeeId: "L1", managerId: "M1", rowIndex: 2 }),
            rec({ employeeId: "L2", managerId: "M1", rowIndex: 3 }),
            rec({ employeeId: "Other", managerId: "root", rowIndex: 4 })
        ];
        const result = buildHierarchy(records);
        const subtreeRoot = getSubtreeRoot(result, "M1")!;
        const ids = collectSubtreeIds(subtreeRoot);
        expect(ids).toEqual(new Set(["M1", "L1", "L2"]));
        expect(ids.has("Other")).toBe(false);
        expect(ids.has("root")).toBe(false);
    });

    test("13. setting a new root then getting the original root back leaves the underlying hierarchy unchanged", () => {
        const records = [
            rec({ employeeId: "root", managerId: null, rowIndex: 0 }),
            rec({ employeeId: "M1", managerId: "root", rowIndex: 1 }),
            rec({ employeeId: "L1", managerId: "M1", rowIndex: 2 })
        ];
        const result = buildHierarchy(records);
        const originalRootChildren = result.roots[0].children.map((c) => c.record.employeeId);

        // Simulate "set as top node": get a subtree pointer, don't mutate anything.
        const reRooted = getSubtreeRoot(result, "M1")!;
        expect(collectSubtreeIds(reRooted)).toEqual(new Set(["M1", "L1"]));

        // "Back to top": the original hierarchy object must be completely unaffected.
        expect(result.roots[0].children.map((c) => c.record.employeeId)).toEqual(originalRootChildren);
        expect(countSubtree(result.roots[0])).toBe(3);
    });
});

describe("hierarchy.ts — full 1000-employee CSV dataset", () => {
    // Loaded once for the whole describe block — the file is ~330KB, cheap enough per-suite.
    const csvRows = loadCsvFixture();
    const records = csvRows.map((r) => r.record);
    const result = buildHierarchy(records);

    test("10. exactly one root, zero cycles, zero orphans, 1000 nodes reached from root", () => {
        expect(result.diagnostics.totalInputRows).toBe(1000);
        expect(result.roots).toHaveLength(1);
        expect(result.roots[0].record.employeeId).toBe("10001");
        expect(result.diagnostics.cycles).toHaveLength(0);
        expect(result.diagnostics.missingParents).toHaveLength(0);
        expect(result.diagnostics.duplicateIds).toHaveLength(0);
        expect(result.diagnostics.selfReferences).toHaveLength(0);
        expect(result.diagnostics.includedNodeCount).toBe(1000);
        expect(countSubtree(result.roots[0])).toBe(1000);
    });

    test("10b. hierarchy depth is exactly 6 (0-based: max depth value 5)", () => {
        let maxDepth = 0;
        result.nodesById.forEach((node) => {
            maxDepth = Math.max(maxDepth, node.depth);
        });
        // CSV's HierarchyDepth is 1-based (root = 1), our computed depth is
        // 0-based (root = 0); "depth exactly 6" in 1-based terms is maxDepth === 5 here.
        expect(maxDepth).toBe(5);
    });

    test("10c. every node's computed depth matches CSV HierarchyDepth (1-based) minus 1", () => {
        let mismatches = 0;
        for (const row of csvRows) {
            const node = result.nodesById.get(row.record.employeeId);
            if (!node) {
                mismatches++;
                continue;
            }
            if (node.depth !== row.hierarchyDepthFromCsv - 1) {
                mismatches++;
            }
        }
        expect(mismatches).toBe(0);
    });

    test("11b. cross-check subtree count against CSV's SubtreeEmployeeCount for a sample manager", () => {
        // Pick a manager (a row with DirectReports-bearing children) — use the CEO's
        // first-level report (EmployeeID 10002 per the known CSV structure) as a stable sample.
        const sampleId = "10002";
        const csvRow = csvRows.find((r) => r.record.employeeId === sampleId)!;
        const node = result.nodesById.get(sampleId)!;
        // The CSV's SubtreeEmployeeCount counts descendants only (excludes self),
        // which matches node.subtreeCount's documented semantics exactly.
        expect(node.subtreeCount).toBe(csvRow.subtreeEmployeeCountFromCsv);
        // Cross-check countSubtree (which does include self) is consistently +1.
        expect(countSubtree(node)).toBe(csvRow.subtreeEmployeeCountFromCsv + 1);
    });
});
