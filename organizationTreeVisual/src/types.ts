/*
 *  Organization Tree Visual — shared type definitions.
 *
 *  This file has no dependency on d3, the DOM, or the Power BI API. It defines
 *  the plain-data contracts that dataMapping.ts, hierarchy.ts, layout.ts,
 *  rendering.ts and interaction.ts all share, so each of those files can be
 *  reasoned about (and unit tested) independently.
 */

"use strict";

/**
 * One employee record as parsed out of the Power BI DataView, before any
 * hierarchy construction happens. IDs are normalized to strings so that
 * hierarchy.ts never has to worry about numeric vs. string identity.
 */
export interface EmployeeRecord {
    employeeId: string;
    employeeName: string;
    managerId: string | null;
    managerName: string | null;
    designation: string | null;
    department: string | null;
    team: string | null;
    managementLevel: number | null;
    /** Bound "Metrics" measures, keyed by the display name of the measure field. */
    metrics: Record<string, number | null>;
    /** Row index in the original DataView table — used to build a stable ISelectionId. */
    rowIndex: number;
}

/**
 * A node in the constructed hierarchy tree. Distinct from the Power BI-facing
 * EmployeeRecord so the tree-shape concerns (children, depth) are separated
 * from the raw parsed fields.
 */
export interface EmployeeNode {
    record: EmployeeRecord;
    children: EmployeeNode[];
    /** Depth from the true hierarchy root (root = 0). Computed, never hardcoded. */
    depth: number;
    /** Total descendant count (not including self), computed from the built tree. */
    subtreeCount: number;
}

/** One entry in hierarchy.ts's diagnostics report. */
export interface MissingParentIssue {
    employeeId: string;
    managerId: string;
}

export interface SelfReferenceIssue {
    employeeId: string;
}

export interface CycleIssue {
    /** Employee IDs forming the cycle, in traversal order, first id repeated at the end. */
    path: string[];
}

export interface DuplicateIdIssue {
    employeeId: string;
    /** Row indexes (into the original input array) that shared this employeeId. */
    occurrences: number[];
    /** Row index that was kept. First occurrence always wins, deterministically. */
    keptRowIndex: number;
}

export interface HierarchyDiagnostics {
    rootIds: string[];
    missingParents: MissingParentIssue[];
    selfReferences: SelfReferenceIssue[];
    cycles: CycleIssue[];
    duplicateIds: DuplicateIdIssue[];
    totalInputRows: number;
    /** Count of nodes actually reachable from a root and included in the tree(s). */
    includedNodeCount: number;
}

export interface HierarchyResult {
    /** Usually one root (the CEO), but the engine tolerates >1 root gracefully. */
    roots: EmployeeNode[];
    /** Fast lookup from employeeId to its node, for re-rooting / selection / subtree queries. */
    nodesById: Map<string, EmployeeNode>;
    diagnostics: HierarchyDiagnostics;
}

/** A positioned node, output of layout.ts. Plain data — no SVG/DOM references. */
export interface PositionedNode {
    node: EmployeeNode;
    x: number;
    y: number;
    /** True if this node's children are currently collapsed (not laid out / not rendered). */
    collapsed: boolean;
    /** True if this node has at least one child in the full hierarchy (regardless of collapse state). */
    hasChildren: boolean;
}

export interface PositionedLink {
    source: PositionedNode;
    target: PositionedNode;
}

export interface LayoutResult {
    nodes: PositionedNode[];
    links: PositionedLink[];
    /** Bounding box of the laid-out content, in layout coordinate space. */
    width: number;
    height: number;
}

/**
 * The visual's current view state — everything interaction.ts owns and mutates.
 * Deliberately separate from HierarchyResult: viewRootId is just a pointer into
 * the full in-memory hierarchy, never a mutation of it.
 */
export interface ViewState {
    /** employeeId currently used as the rendered root. Equal to the true root initially. */
    viewRootId: string;
    /** employeeIds whose children are currently collapsed (not rendered). */
    collapsedIds: Set<string>;
    /** employeeId of the currently selected employee, if any. */
    selectedId: string | null;
}

/** Card sizing/spacing constants resolved from formatting settings, passed to layout+rendering. */
export interface LayoutConfig {
    cardWidth: number;
    cardHeight: number;
    horizontalSpacing: number;
    verticalSpacing: number;
}
