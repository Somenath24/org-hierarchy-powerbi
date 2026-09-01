/*
 *  Organization Tree Visual — interaction / state machine.
 *
 *  Owns the ViewState (view root pointer, collapsed set, selection) and wires
 *  d3-zoom + click handlers on top of what rendering.ts draws. Re-rooting
 *  ("Set as Top Node") only ever changes viewState.viewRootId — it is a
 *  pointer into the HierarchyResult built once by hierarchy.ts, and this file
 *  never mutates that hierarchy's node/children structure. "Back to Top Node"
 *  restores viewRootId to the hierarchy's true (original) root, not merely
 *  one level up.
 *
 *  Expansion state (collapsedIds) is intentionally NOT reset on re-root or
 *  back-to-top — the same Set<employeeId> is reused across navigation so a
 *  node's expand/collapse state survives moving the view root around, per
 *  the Phase 2E requirement ("remember expansion state ... where reasonably
 *  practical"). The one edge case where it necessarily resets is a full
 *  Power BI dataView update (e.g. an external filter changes the employee
 *  set) — see README Limitations for why that can't be preserved reliably.
 */

"use strict";

import { select, Selection } from "d3-selection";
import { zoom, zoomIdentity, D3ZoomEvent, ZoomBehavior } from "d3-zoom";
// d3-transition augments d3-selection's Selection interface with .transition() —
// imported for its side effect (module augmentation), used by resetZoom() below.
import "d3-transition";
import { HierarchyResult, LayoutConfig, ViewState } from "./types";
import { computeLayout } from "./layout";
import { render, RenderOptions } from "./rendering";
import { SelectionHandler } from "./selectionManager";
import { getSubtreeRoot } from "./hierarchy";

export interface InteractionCallbacks {
    /** Called after any state change that should trigger a re-render. */
    onStateChanged: (viewState: ViewState) => void;
}

export class TreeInteractionController {
    private svg: Selection<SVGSVGElement, unknown, null, undefined>;
    private zoomLayer: Selection<SVGGElement, unknown, null, undefined>;
    private zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>;
    private hierarchy: HierarchyResult;
    private viewState: ViewState;
    private selectionHandler: SelectionHandler;
    private callbacks: InteractionCallbacks;
    private readonly trueRootId: string;

    constructor(
        svgElement: SVGSVGElement,
        hierarchy: HierarchyResult,
        selectionHandler: SelectionHandler,
        callbacks: InteractionCallbacks
    ) {
        this.svg = select(svgElement);
        this.hierarchy = hierarchy;
        this.selectionHandler = selectionHandler;
        this.callbacks = callbacks;
        this.trueRootId = hierarchy.roots.length > 0 ? hierarchy.roots[0].record.employeeId : "";

        this.viewState = {
            viewRootId: this.trueRootId,
            collapsedIds: new Set<string>(),
            selectedId: null
        };

        let zoomLayer = this.svg.select<SVGGElement>("g.otv-zoom-layer");
        if (zoomLayer.empty()) {
            zoomLayer = this.svg.append("g").attr("class", "otv-zoom-layer");
        }
        this.zoomLayer = zoomLayer;

        this.zoomBehavior = zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.1, 3])
            .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
                this.zoomLayer.attr("transform", event.transform.toString());
            });

        this.svg.call(this.zoomBehavior);
    }

    /** Replaces the in-memory hierarchy (called on every Power BI update()). */
    public setHierarchy(hierarchy: HierarchyResult, preserveViewState: boolean): void {
        this.hierarchy = hierarchy;
        const newTrueRootId = hierarchy.roots.length > 0 ? hierarchy.roots[0].record.employeeId : "";

        const viewRootStillValid = preserveViewState && hierarchy.nodesById.has(this.viewState.viewRootId);

        this.viewState = {
            viewRootId: viewRootStillValid ? this.viewState.viewRootId : newTrueRootId,
            // Collapsed/selected ids that no longer exist in the new hierarchy are
            // harmless (layout.ts simply won't find them), but we prune them so
            // the Set doesn't grow unboundedly across many filter changes.
            collapsedIds: preserveViewState
                ? new Set([...this.viewState.collapsedIds].filter((id) => hierarchy.nodesById.has(id)))
                : new Set<string>(),
            selectedId:
                preserveViewState && this.viewState.selectedId && hierarchy.nodesById.has(this.viewState.selectedId)
                    ? this.viewState.selectedId
                    : null
        };
    }

    public applyDefaultAutoExpand(autoExpandLevels: number, maxInitialNodes: number): void {
        const root = this.hierarchy.nodesById.get(this.viewState.viewRootId);
        if (!root) {
            return;
        }
        // Collapse every node beyond autoExpandLevels from the current view root,
        // then, if that still exceeds maxInitialNodes, collapse more aggressively
        // level-by-level until under budget. This is the Phase 2G scale strategy:
        // default to root + a few levels, never dump 1000 nodes into the DOM at once.
        const collapsed = new Set<string>();

        const queue: { id: string; depth: number; childrenIds: string[] }[] = [];
        const nodesByDepthFromViewRoot: Map<number, string[]> = new Map();

        const bfs: { id: string; depth: number }[] = [{ id: root.record.employeeId, depth: 0 }];
        let head = 0;
        let count = 0;
        while (head < bfs.length) {
            const { id, depth } = bfs[head++];
            count++;
            const arr = nodesByDepthFromViewRoot.get(depth) ?? [];
            arr.push(id);
            nodesByDepthFromViewRoot.set(depth, arr);

            if (depth >= autoExpandLevels) {
                collapsed.add(id);
                continue; // do not descend further from an auto-collapsed node
            }
            const node = this.hierarchy.nodesById.get(id);
            if (!node) continue;
            for (const child of node.children) {
                bfs.push({ id: child.record.employeeId, depth: depth + 1 });
            }
        }

        // If still too many nodes were queued (before the depth cutoff even
        // applies), progressively collapse the deepest included level first.
        let totalIncluded = count;
        let cutoffDepth = autoExpandLevels;
        while (totalIncluded > maxInitialNodes && cutoffDepth > 0) {
            const levelIds = nodesByDepthFromViewRoot.get(cutoffDepth) ?? [];
            levelIds.forEach((id) => collapsed.add(id));
            // Recompute how many nodes remain visible after collapsing this level.
            totalIncluded = 0;
            for (let d = 0; d <= cutoffDepth; d++) {
                totalIncluded += (nodesByDepthFromViewRoot.get(d) ?? []).length;
            }
            cutoffDepth--;
        }

        this.viewState.collapsedIds = collapsed;
    }

    public getViewState(): ViewState {
        return this.viewState;
    }

    public isAtTrueRoot(): boolean {
        return this.viewState.viewRootId === this.trueRootId;
    }

    public getTrueRootId(): string {
        return this.trueRootId;
    }

    public renderCurrentState(config: LayoutConfig, renderOptions: Omit<RenderOptions, "config" | "selectedEmployeeId">): void {
        const viewRoot = getSubtreeRoot(this.hierarchy, this.viewState.viewRootId);
        if (!viewRoot) {
            this.zoomLayer.selectAll("*").remove();
            return;
        }

        const layout = computeLayout(viewRoot, this.viewState.collapsedIds, config);

        const fullOptions: RenderOptions = {
            ...renderOptions,
            config,
            selectedEmployeeId: this.viewState.selectedId
        };

        const nodeSelection = render(this.zoomLayer, layout, fullOptions);

        nodeSelection.on("click", (event: MouseEvent, d) => {
            event.stopPropagation();
            const employeeId = d.node.record.employeeId;

            const target = event.target as Element;
            if (target && target.closest(".otv-expand-glyph")) {
                this.toggleCollapse(employeeId);
                return;
            }
            void this.selectEmployee(employeeId);
        });

        nodeSelection.on("dblclick", (event: MouseEvent, d) => {
            event.stopPropagation();
            this.setAsTopNode(d.node.record.employeeId);
        });
    }

    public toggleCollapse(employeeId: string): void {
        const node = this.hierarchy.nodesById.get(employeeId);
        if (!node || node.children.length === 0) {
            return;
        }
        if (this.viewState.collapsedIds.has(employeeId)) {
            this.viewState.collapsedIds.delete(employeeId);
        } else {
            this.viewState.collapsedIds.add(employeeId);
        }
        this.callbacks.onStateChanged(this.viewState);
    }

    public async selectEmployee(employeeId: string): Promise<void> {
        this.viewState.selectedId = employeeId;
        await this.selectionHandler.select(employeeId, false);
        this.callbacks.onStateChanged(this.viewState);
    }

    /** "Set as Top Node": re-root the rendered view only. Does not mutate this.hierarchy. */
    public setAsTopNode(employeeId: string): void {
        if (!this.hierarchy.nodesById.has(employeeId)) {
            return;
        }
        this.viewState.viewRootId = employeeId;
        this.resetZoom();
        this.callbacks.onStateChanged(this.viewState);
    }

    /** "Back to Top Node": restores the ORIGINAL org root, not just one level up. */
    public backToTopNode(): void {
        this.viewState.viewRootId = this.trueRootId;
        this.resetZoom();
        this.callbacks.onStateChanged(this.viewState);
    }

    private resetZoom(): void {
        this.svg.transition().duration(200).call(this.zoomBehavior.transform, zoomIdentity);
    }

    public destroy(): void {
        this.svg.on(".zoom", null);
    }
}
