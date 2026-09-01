/*
 *  Organization Tree Visual — SVG rendering.
 *
 *  Consumes a LayoutResult (plain positioned nodes/links) and draws it with
 *  d3-selection into a <g> the caller supplies. No layout math happens here —
 *  only DOM/SVG construction and enter/update/exit binding. interaction.ts
 *  attaches event handlers to the elements this file creates (by CSS class),
 *  rather than this file knowing about zoom/click/selection semantics itself.
 */

"use strict";

import { Selection } from "d3-selection";
import { LayoutConfig, LayoutResult, PositionedLink, PositionedNode } from "./types";

export interface RenderOptions {
    config: LayoutConfig;
    connectorStyle: "curved" | "orthogonal";
    connectorColor: string;
    showDesignation: boolean;
    metricKeys: string[]; // up to 2 metric display names to render, in order
    fontSize: number;
    selectedEmployeeId: string | null;
}

const AVATAR_PALETTE = [
    "#4C6EF5", "#12B886", "#F59F00", "#E8590C", "#7048E8",
    "#1098AD", "#F03E3E", "#2F9E44", "#5C5F66", "#0CA678"
];

function initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
        return "?";
    }
    if (parts.length === 1) {
        return parts[0].substring(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarColor(employeeId: string): string {
    let hash = 0;
    for (let i = 0; i < employeeId.length; i++) {
        hash = (hash * 31 + employeeId.charCodeAt(i)) >>> 0;
    }
    return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function formatMetricValue(key: string, value: number | null): string {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return "–";
    }
    const lower = key.toLowerCase();
    if (lower.includes("pct") || lower.includes("percent")) {
        return `${value.toFixed(1)}%`;
    }
    if (lower.includes("salary") || lower.includes("inr")) {
        return `₹${Math.round(value).toLocaleString("en-IN")}`;
    }
    if (Number.isInteger(value)) {
        return value.toString();
    }
    return value.toFixed(1);
}

function linkPath(link: PositionedLink, config: LayoutConfig, style: "curved" | "orthogonal"): string {
    const sx = link.source.x;
    const sy = link.source.y + config.cardHeight / 2;
    const tx = link.target.x;
    const ty = link.target.y - config.cardHeight / 2;

    if (style === "orthogonal") {
        const midY = (sy + ty) / 2;
        return `M${sx},${sy} L${sx},${midY} L${tx},${midY} L${tx},${ty}`;
    }
    const midY = (sy + ty) / 2;
    return `M${sx},${sy} C${sx},${midY} ${tx},${midY} ${tx},${ty}`;
}

/**
 * Renders the given layout into `container` (a <g> selection). Returns the
 * node <g> selection so interaction.ts can attach click/dblclick handlers
 * without this file needing to know about interaction semantics.
 */
export function render(
    container: Selection<SVGGElement, unknown, null, undefined>,
    layout: LayoutResult,
    options: RenderOptions
): Selection<SVGGElement, PositionedNode, SVGGElement, unknown> {
    const { config } = options;

    let linksLayer = container.select<SVGGElement>("g.otv-links-layer");
    if (linksLayer.empty()) {
        linksLayer = container.append("g").attr("class", "otv-links-layer");
    }
    let nodesLayer = container.select<SVGGElement>("g.otv-nodes-layer");
    if (nodesLayer.empty()) {
        nodesLayer = container.append("g").attr("class", "otv-nodes-layer");
    }

    // --- Links ---
    const linkSel = linksLayer
        .selectAll<SVGPathElement, PositionedLink>("path.otv-link")
        .data(layout.links, (d: PositionedLink) => `${d.source.node.record.employeeId}->${d.target.node.record.employeeId}`);

    linkSel.exit().remove();

    linkSel
        .enter()
        .append("path")
        .attr("class", "otv-link")
        .merge(linkSel)
        .attr("d", (d) => linkPath(d, config, options.connectorStyle))
        .attr("fill", "none")
        .attr("stroke", options.connectorColor)
        .attr("stroke-width", 1.5);

    // --- Nodes ---
    const nodeSel = nodesLayer
        .selectAll<SVGGElement, PositionedNode>("g.otv-node")
        .data(layout.nodes, (d: PositionedNode) => d.node.record.employeeId);

    nodeSel.exit().remove();

    const nodeEnter = nodeSel
        .enter()
        .append("g")
        .attr("class", "otv-node");

    nodeEnter.append("rect").attr("class", "otv-card-bg");
    nodeEnter.append("circle").attr("class", "otv-avatar-circle");
    nodeEnter.append("text").attr("class", "otv-avatar-text");
    nodeEnter.append("text").attr("class", "otv-name-text");
    nodeEnter.append("text").attr("class", "otv-designation-text");
    nodeEnter.append("text").attr("class", "otv-metric1-text");
    nodeEnter.append("text").attr("class", "otv-metric2-text");
    nodeEnter.append("g").attr("class", "otv-expand-glyph");
    nodeEnter.select("g.otv-expand-glyph").append("circle");
    nodeEnter.select("g.otv-expand-glyph").append("text");
    nodeEnter.append("text").attr("class", "otv-collapsed-summary");

    const merged = nodeEnter.merge(nodeSel);

    merged.attr("transform", (d) => `translate(${d.x - config.cardWidth / 2}, ${d.y - config.cardHeight / 2})`);

    merged
        .select<SVGRectElement>("rect.otv-card-bg")
        .attr("width", config.cardWidth)
        .attr("height", config.cardHeight)
        .attr("rx", 6)
        .attr("ry", 6)
        .attr("class", (d) => {
            const isManager = d.hasChildren;
            const isSelected = d.node.record.employeeId === options.selectedEmployeeId;
            let cls = "otv-card-bg";
            cls += isManager ? " otv-card-manager" : " otv-card-ic";
            if (isSelected) {
                cls += " otv-card-selected";
            }
            return cls;
        });

    const avatarCx = 24;
    const avatarCy = config.cardHeight / 2;

    merged
        .select<SVGCircleElement>("circle.otv-avatar-circle")
        .attr("cx", avatarCx)
        .attr("cy", avatarCy)
        .attr("r", 16)
        .attr("fill", (d) => avatarColor(d.node.record.employeeId));

    merged
        .select<SVGTextElement>("text.otv-avatar-text")
        .attr("x", avatarCx)
        .attr("y", avatarCy)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("fill", "#ffffff")
        .attr("font-size", 11)
        .attr("font-weight", 600)
        .text((d) => initialsOf(d.node.record.employeeName));

    const textX = 48;

    merged
        .select<SVGTextElement>("text.otv-name-text")
        .attr("x", textX)
        .attr("y", 18)
        .attr("font-size", options.fontSize + 1)
        .attr("font-weight", 600)
        .attr("fill", "#1A1D29")
        .text((d) => truncate(d.node.record.employeeName, 20));

    merged
        .select<SVGTextElement>("text.otv-designation-text")
        .attr("x", textX)
        .attr("y", 33)
        .attr("font-size", options.fontSize)
        .attr("fill", "#5C6270")
        .style("display", options.showDesignation ? null : "none")
        .text((d) => truncate(d.node.record.designation ?? "", 22));

    const metric1Key = options.metricKeys[0];
    const metric2Key = options.metricKeys[1];

    merged
        .select<SVGTextElement>("text.otv-metric1-text")
        .attr("x", textX)
        .attr("y", 49)
        .attr("font-size", options.fontSize - 1)
        .attr("fill", "#2B8A3E")
        .style("display", metric1Key ? null : "none")
        .text((d) => (metric1Key ? `${metric1Key}: ${formatMetricValue(metric1Key, d.node.record.metrics[metric1Key] ?? null)}` : ""));

    merged
        .select<SVGTextElement>("text.otv-metric2-text")
        .attr("x", textX)
        .attr("y", 63)
        .attr("font-size", options.fontSize - 1)
        .attr("fill", "#495057")
        .style("display", metric2Key ? null : "none")
        .text((d) => (metric2Key ? `${metric2Key}: ${formatMetricValue(metric2Key, d.node.record.metrics[metric2Key] ?? null)}` : ""));

    // Expand/collapse glyph, only shown when the node has children.
    const glyph = merged.select<SVGGElement>("g.otv-expand-glyph");
    glyph
        .style("display", (d) => (d.hasChildren ? null : "none"))
        .attr("transform", `translate(${config.cardWidth - 14}, ${config.cardHeight / 2})`)
        .attr("class", "otv-expand-glyph");

    glyph
        .select("circle")
        .attr("r", 9)
        .attr("fill", "#ffffff")
        .attr("stroke", "#9AA1AC")
        .attr("stroke-width", 1);

    glyph
        .select("text")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("font-size", 12)
        .attr("font-weight", 700)
        .attr("fill", "#495057")
        .text((d) => (d.collapsed ? "+" : "−"));

    // Collapsed subtree summary label, drawn below the card.
    merged
        .select<SVGTextElement>("text.otv-collapsed-summary")
        .attr("x", config.cardWidth / 2)
        .attr("y", config.cardHeight + 13)
        .attr("text-anchor", "middle")
        .attr("font-size", options.fontSize - 1)
        .attr("fill", "#868E96")
        .style("display", (d) => (d.collapsed ? null : "none"))
        .text((d) => `${d.node.subtreeCount} report${d.node.subtreeCount === 1 ? "" : "s"}`);

    return merged;
}

function truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) {
        return text;
    }
    return text.substring(0, maxLen - 1) + "…";
}
