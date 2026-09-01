/*
 *  Organization Tree Visual — tree layout.
 *
 *  Consumes an EmployeeNode (the current view root, a pointer into the
 *  hierarchy built by hierarchy.ts) plus the set of currently-collapsed
 *  employeeIds, and produces positioned nodes/links using d3-hierarchy's
 *  tree() layout. Output is plain data (x/y coordinates) — no SVG/DOM here;
 *  rendering.ts consumes this file's output.
 */

"use strict";

import { hierarchy as d3hierarchy, tree as d3tree, HierarchyNode } from "d3-hierarchy";
import { EmployeeNode, LayoutConfig, LayoutResult, PositionedLink, PositionedNode } from "./types";

/**
 * Builds a "view tree" that mirrors the real hierarchy but stops descending
 * into any node whose id is in collapsedIds — its children are omitted so
 * d3-hierarchy never sees them (and never lays them out).
 */
function toViewChildren(node: EmployeeNode, collapsedIds: Set<string>): EmployeeNode[] {
    if (collapsedIds.has(node.record.employeeId)) {
        return [];
    }
    return node.children;
}

export function computeLayout(
    viewRoot: EmployeeNode,
    collapsedIds: Set<string>,
    config: LayoutConfig
): LayoutResult {
    const root: HierarchyNode<EmployeeNode> = d3hierarchy<EmployeeNode>(
        viewRoot,
        (n) => toViewChildren(n, collapsedIds)
    );

    // nodeSize gives fixed spacing regardless of node count, which keeps card
    // sizes stable as the user expands/collapses — d3's default normalized
    // [0,1] layout would otherwise rescale card spacing on every toggle.
    const layout = d3tree<EmployeeNode>().nodeSize([
        config.cardWidth + config.horizontalSpacing,
        config.cardHeight + config.verticalSpacing
    ]);

    layout(root);

    const positionedById = new Map<string, PositionedNode>();
    const nodes: PositionedNode[] = [];

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    root.each((d3node) => {
        const employeeNode = d3node.data;
        // d3-tree lays out with x = breadth axis, y = depth axis; we render
        // depth top-to-bottom, so swap into (x = horizontal, y = depth * rowHeight).
        const x = d3node.x as number;
        const y = d3node.y as number;

        const hasChildren = employeeNode.children.length > 0;
        const collapsed = collapsedIds.has(employeeNode.record.employeeId) && hasChildren;

        const positioned: PositionedNode = {
            node: employeeNode,
            x,
            y,
            collapsed,
            hasChildren
        };
        positionedById.set(employeeNode.record.employeeId, positioned);
        nodes.push(positioned);

        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    });

    const links: PositionedLink[] = [];
    root.links().forEach((l) => {
        const source = positionedById.get(l.source.data.record.employeeId);
        const target = positionedById.get(l.target.data.record.employeeId);
        if (source && target) {
            links.push({ source, target });
        }
    });

    const width = nodes.length > 0 ? maxX - minX + config.cardWidth : config.cardWidth;
    const height = nodes.length > 0 ? maxY - minY + config.cardHeight : config.cardHeight;

    return { nodes, links, width, height };
}
