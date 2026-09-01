/*
 *  Organization Tree Visual — hierarchy engine.
 *
 *  Pure TypeScript, no DOM / d3-selection / Power BI API dependency, so this
 *  file is directly importable and unit-testable in isolation (see
 *  test/hierarchy.test.ts). It builds a tree out of a flat list of
 *  { employeeId, managerId } records and reports every data-quality issue it
 *  encounters instead of silently dropping rows.
 *
 *  Design notes / edge-case handling:
 *   - Duplicate employeeId: first occurrence (by input array order) wins and
 *     is used to build the tree; later occurrences are recorded in
 *     diagnostics.duplicateIds and excluded from the tree entirely.
 *   - Self-reference (employeeId === managerId): treated as "no manager" —
 *     the record becomes a root — and reported in diagnostics.selfReferences.
 *     This avoids a trivial 1-node infinite loop while still surfacing the
 *     bad data to the caller.
 *   - Missing parent (managerId doesn't match any known employeeId): the
 *     record becomes a root (so it's never silently dropped) and is reported
 *     in diagnostics.missingParents. This is also exactly what happens when
 *     Power BI applies an external filter that removes an employee's manager
 *     from the dataView — see README "Limitations".
 *   - Cycles (A -> B -> C -> A): detected via iterative DFS with a coloring
 *     scheme (white/gray/black), never via unbounded recursion. Every node
 *     that is part of a cycle, or whose only path to a root runs through a
 *     cycle, is excluded from the tree's roots' descendant sets and reported
 *     in diagnostics.cycles (one entry per distinct cycle found). Such nodes
 *     are NOT force-attached as extra roots, because they do have a
 *     syntactically valid managerId — attaching them anywhere would be
 *     fabricating structure that doesn't exist in the data.
 *   - No recursion depth assumptions anywhere: both tree construction and
 *     depth/subtree-count computation use explicit stacks/queues, so a
 *     1000-node tree (or a pathological 1000-node chain) cannot stack overflow.
 */

"use strict";

import { EmployeeNode, EmployeeRecord, HierarchyDiagnostics, HierarchyResult, MissingParentIssue } from "./types";

/** Minimal input shape hierarchy.ts needs — a subset of EmployeeRecord. */
export type HierarchyInputRecord = EmployeeRecord;

const enum VisitState {
    Unvisited = 0,
    InProgress = 1,
    Done = 2
}

export function buildHierarchy(records: HierarchyInputRecord[]): HierarchyResult {
    const diagnostics: HierarchyDiagnostics = {
        rootIds: [],
        missingParents: [],
        selfReferences: [],
        cycles: [],
        duplicateIds: [],
        totalInputRows: records.length,
        includedNodeCount: 0
    };

    // --- Pass 1: de-duplicate by employeeId, first occurrence wins. ---
    const firstOccurrenceIndexById = new Map<string, number>();
    const duplicateOccurrences = new Map<string, number[]>();

    records.forEach((r, idx) => {
        const id = r.employeeId;
        if (!firstOccurrenceIndexById.has(id)) {
            firstOccurrenceIndexById.set(id, idx);
        } else {
            const list = duplicateOccurrences.get(id) ?? [firstOccurrenceIndexById.get(id) as number];
            list.push(idx);
            duplicateOccurrences.set(id, list);
        }
    });

    duplicateOccurrences.forEach((occurrences, employeeId) => {
        diagnostics.duplicateIds.push({
            employeeId,
            occurrences,
            keptRowIndex: firstOccurrenceIndexById.get(employeeId) as number
        });
    });

    const dedupedRecords: EmployeeRecord[] = [];
    firstOccurrenceIndexById.forEach((idx) => dedupedRecords.push(records[idx]));

    // --- Pass 2: build nodes + resolved parent pointers, catching self-refs / missing parents. ---
    const nodesById = new Map<string, EmployeeNode>();
    dedupedRecords.forEach((record) => {
        nodesById.set(record.employeeId, {
            record,
            children: [],
            depth: 0,
            subtreeCount: 0
        });
    });

    // effectiveParentId: null means "this node is a root" (either genuinely no
    // manager, or forced to root status due to self-reference / missing parent).
    const effectiveParentId = new Map<string, string | null>();

    dedupedRecords.forEach((record) => {
        const id = record.employeeId;
        const managerId = record.managerId;

        if (managerId === null || managerId === "" || managerId === undefined) {
            effectiveParentId.set(id, null);
            return;
        }

        if (managerId === id) {
            diagnostics.selfReferences.push({ employeeId: id });
            effectiveParentId.set(id, null);
            return;
        }

        if (!nodesById.has(managerId)) {
            const issue: MissingParentIssue = { employeeId: id, managerId };
            diagnostics.missingParents.push(issue);
            effectiveParentId.set(id, null);
            return;
        }

        effectiveParentId.set(id, managerId);
    });

    // --- Pass 3: cycle detection via iterative coloring DFS over the parent graph. ---
    // We walk child -> parent edges (effectiveParentId). A cycle exists iff
    // following parent pointers from some node revisits a node currently
    // "in progress" on the same walk.
    const visitState = new Map<string, VisitState>();
    dedupedRecords.forEach((r) => visitState.set(r.employeeId, VisitState.Unvisited));

    const nodesInCycles = new Set<string>();

    for (const record of dedupedRecords) {
        const startId = record.employeeId;
        if (visitState.get(startId) !== VisitState.Unvisited) {
            continue;
        }

        // Walk up the parent chain iteratively, tracking the path we've taken
        // on THIS walk so we can detect a back-edge into it (a real cycle) vs.
        // running into a node already fully processed by an earlier walk.
        const pathStack: string[] = [];
        const pathIndex = new Map<string, number>();
        let currentId: string | null = startId;

        while (currentId !== null) {
            const state = visitState.get(currentId);

            if (state === VisitState.InProgress || pathIndex.has(currentId)) {
                // Found a cycle: the portion of pathStack from pathIndex.get(currentId) to end.
                const cycleStart = pathIndex.get(currentId) as number;
                const cyclePath = pathStack.slice(cycleStart);
                cyclePath.push(currentId);
                cyclePath.forEach((id) => nodesInCycles.add(id));
                diagnostics.cycles.push({ path: cyclePath });

                // Mark the whole in-progress path (up to but not including the
                // cycle re-entry, which is already marked) as Done so we don't
                // re-walk it, then stop this walk.
                pathStack.forEach((id) => visitState.set(id, VisitState.Done));
                break;
            }

            if (state === VisitState.Done) {
                // Ran into an already-resolved chain with no cycle — stop.
                pathStack.forEach((id) => visitState.set(id, VisitState.Done));
                break;
            }

            // Unvisited: push onto the path and continue up toward the parent.
            visitState.set(currentId, VisitState.InProgress);
            pathIndex.set(currentId, pathStack.length);
            pathStack.push(currentId);

            const parent = effectiveParentId.get(currentId);
            if (parent === null || parent === undefined) {
                // Reached a genuine root with no cycle — mark whole path Done.
                pathStack.forEach((id) => visitState.set(id, VisitState.Done));
                currentId = null;
                break;
            }
            currentId = parent;
        }
    }

    // Nodes that are part of a cycle cannot be safely attached anywhere (their
    // "parent" pointer only leads back into the cycle) — sever them by forcing
    // effectiveParentId to null is wrong (would fabricate false roots for data
    // that clearly declares a manager); instead we exclude cycle members from
    // the buildable tree entirely and they are surfaced solely via diagnostics.cycles.
    // (They are NOT counted in includedNodeCount.)

    // --- Pass 4: attach children (iterative), skipping cycle members. ---
    const roots: EmployeeNode[] = [];

    dedupedRecords.forEach((record) => {
        const id = record.employeeId;
        if (nodesInCycles.has(id)) {
            return;
        }
        const parentId = effectiveParentId.get(id);
        const node = nodesById.get(id) as EmployeeNode;

        if (parentId === null || parentId === undefined) {
            roots.push(node);
        } else if (nodesInCycles.has(parentId)) {
            // Parent is a cycle member: this node's chain to any real root is
            // broken by the cycle. Treat as an orphan root rather than silently
            // dropping it, and report it the same way as a missing parent.
            diagnostics.missingParents.push({ employeeId: id, managerId: parentId });
            roots.push(node);
        } else {
            const parentNode = nodesById.get(parentId) as EmployeeNode;
            parentNode.children.push(node);
        }
    });

    // Sort roots deterministically by employeeId for stable output.
    roots.sort((a, b) => a.record.employeeId.localeCompare(b.record.employeeId));
    diagnostics.rootIds = roots.map((r) => r.record.employeeId);

    // --- Pass 5: compute depth (BFS, iterative) and subtreeCount (post-order via explicit stack). ---
    let includedNodeCount = 0;

    // BFS for depth, guarding against any residual cycle by tracking visited.
    const bfsVisited = new Set<string>();
    const queue: EmployeeNode[] = [];
    roots.forEach((r) => {
        r.depth = 0;
        queue.push(r);
        bfsVisited.add(r.record.employeeId);
    });

    let head = 0;
    while (head < queue.length) {
        const current = queue[head++];
        includedNodeCount++;
        for (const child of current.children) {
            const childId = child.record.employeeId;
            if (bfsVisited.has(childId)) {
                // Defensive: should not happen given cycle exclusion above, but
                // never loop forever regardless of upstream data shape.
                continue;
            }
            bfsVisited.add(childId);
            child.depth = current.depth + 1;
            queue.push(child);
        }
    }

    // Post-order subtreeCount using an explicit stack (iterative, two-pass).
    const postOrder: EmployeeNode[] = [];
    const visitStack: EmployeeNode[] = [...roots];
    const stackVisited = new Set<string>();
    while (visitStack.length > 0) {
        const node = visitStack.pop() as EmployeeNode;
        if (stackVisited.has(node.record.employeeId)) {
            continue;
        }
        stackVisited.add(node.record.employeeId);
        postOrder.push(node);
        for (const child of node.children) {
            visitStack.push(child);
        }
    }
    // Reverse so children are processed before parents.
    for (let i = postOrder.length - 1; i >= 0; i--) {
        const node = postOrder[i];
        let count = 0;
        for (const child of node.children) {
            count += 1 + child.subtreeCount;
        }
        node.subtreeCount = count;
    }

    diagnostics.includedNodeCount = includedNodeCount;

    return {
        roots,
        nodesById,
        diagnostics
    };
}

/**
 * Returns the subtree (as a single EmployeeNode, same object identity as in
 * the original HierarchyResult — not a copy) rooted at the given employeeId,
 * or null if the id isn't present in nodesById. Used to re-root the *view*
 * without mutating the underlying hierarchy — callers must not mutate the
 * returned node's .children.
 */
export function getSubtreeRoot(hierarchy: HierarchyResult, employeeId: string): EmployeeNode | null {
    return hierarchy.nodesById.get(employeeId) ?? null;
}

/**
 * Counts all nodes in the subtree rooted at `node` (including `node` itself),
 * via iterative traversal. Equivalent to node.subtreeCount + 1 for nodes
 * produced by buildHierarchy, but implemented independently so it can be used
 * as a cross-check in tests and does not depend on subtreeCount being fresh.
 */
export function countSubtree(node: EmployeeNode): number {
    let count = 0;
    const stack: EmployeeNode[] = [node];
    while (stack.length > 0) {
        const current = stack.pop() as EmployeeNode;
        count++;
        for (const child of current.children) {
            stack.push(child);
        }
    }
    return count;
}

/**
 * Collects the flat set of employeeIds present in the subtree rooted at `node`.
 */
export function collectSubtreeIds(node: EmployeeNode): Set<string> {
    const ids = new Set<string>();
    const stack: EmployeeNode[] = [node];
    while (stack.length > 0) {
        const current = stack.pop() as EmployeeNode;
        ids.add(current.record.employeeId);
        for (const child of current.children) {
            stack.push(child);
        }
    }
    return ids;
}
