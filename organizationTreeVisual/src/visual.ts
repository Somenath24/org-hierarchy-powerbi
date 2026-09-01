/*
 *  Organization Tree Visual
 *
 *  Thin orchestrator: wires the Power BI visual lifecycle (constructor /
 *  update / getFormattingModel) to the modules that hold the actual logic —
 *  dataMapping.ts (DataView -> EmployeeRecord[]), hierarchy.ts (tree
 *  construction + diagnostics), interaction.ts (view state + zoom/click),
 *  and rendering.ts (SVG drawing, invoked indirectly via interaction.ts).
 */

"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { select, Selection } from "d3-selection";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;

import { VisualFormattingSettingsModel } from "./settings";
import { parseDataView } from "./dataMapping";
import { buildHierarchy } from "./hierarchy";
import { HierarchyResult } from "./types";
import { SelectionHandler } from "./selectionManager";
import { TreeInteractionController } from "./interaction";

export class Visual implements IVisual {
    private events: IVisualEventService;
    private host: IVisualHost;
    private target: HTMLElement;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    private svgRoot: Selection<SVGSVGElement, unknown, null, undefined>;
    private backToTopButton: HTMLButtonElement;
    private statusBanner: HTMLDivElement;

    private selectionHandler: SelectionHandler;
    private interactionController: TreeInteractionController | null = null;
    private hierarchy: HierarchyResult | null = null;
    private currentWidth: number = 0;
    private currentHeight: number = 0;
    private boundMetricNames: string[] = [];

    constructor(options: VisualConstructorOptions) {
        this.events = options.host.eventService;
        this.host = options.host;
        this.formattingSettingsService = new FormattingSettingsService();
        this.target = options.element;
        this.target.classList.add("otv-root");

        this.selectionHandler = new SelectionHandler(this.host);

        // Status banner for empty-state / diagnostic messages (no data bound,
        // required roles missing, etc.) — visible above the SVG canvas.
        this.statusBanner = document.createElement("div");
        this.statusBanner.className = "otv-status-banner";
        this.statusBanner.style.display = "none";
        this.target.appendChild(this.statusBanner);

        const svgElement = document.createElementNS("http://www.w3.org/2000/svg", "svg") as unknown as SVGSVGElement;
        svgElement.setAttribute("class", "otv-svg");
        this.target.appendChild(svgElement);
        this.svgRoot = select(svgElement);

        this.backToTopButton = document.createElement("button");
        this.backToTopButton.className = "otv-back-to-top";
        this.backToTopButton.textContent = "↑ Back to Top Node";
        this.backToTopButton.style.display = "none";
        this.backToTopButton.addEventListener("click", () => {
            this.interactionController?.backToTopNode();
            this.renderFrame();
        });
        this.target.appendChild(this.backToTopButton);
    }

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);
        try {
            this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
                VisualFormattingSettingsModel,
                options.dataViews && options.dataViews[0]
            );

            this.currentWidth = options.viewport.width;
            this.currentHeight = options.viewport.height;
            this.svgRoot.attr("width", this.currentWidth).attr("height", this.currentHeight);

            const dataView = options.dataViews && options.dataViews[0];
            const parsed = parseDataView(dataView);

            if (!parsed.hasRequiredRoles || parsed.records.length === 0) {
                this.showStatus(
                    !dataView
                        ? "Add Employee ID, Employee Name and Manager ID fields to display the organization tree."
                        : "No employee rows to display for the current filters."
                );
                this.interactionController = null;
                this.svgRoot.selectAll("*").remove();
                this.backToTopButton.style.display = "none";
                this.events.renderingFinished(options);
                return;
            }

            this.hideStatus();
            this.boundMetricNames = parsed.metricNames;

            const hierarchy = buildHierarchy(parsed.records);
            this.hierarchy = hierarchy;

            if (dataView) {
                this.selectionHandler.rebuild(dataView, parsed.records);
            }

            const isFirstBuild = !this.interactionController;

            if (!this.interactionController) {
                this.interactionController = new TreeInteractionController(
                    this.svgRoot.node() as SVGSVGElement,
                    hierarchy,
                    this.selectionHandler,
                    {
                        onStateChanged: () => this.renderFrame()
                    }
                );
                const nav = this.formattingSettings.navigationCard;
                this.interactionController.applyDefaultAutoExpand(nav.autoExpandLevels.value, nav.maxInitialNodes.value);
            } else {
                // Preserve view state (root pointer / collapsed set / selection)
                // across normal re-renders (e.g. resize, formatting change). A
                // dataView rebuild caused by an external filter still attempts to
                // preserve it where the ids still exist; ids that vanished from
                // the filtered set are pruned automatically (see interaction.ts).
                this.interactionController.setHierarchy(hierarchy, /* preserveViewState */ true);
            }

            if (hierarchy.roots.length === 0) {
                this.showStatus("No root employee found (every row has a manager reference). Check the data for cycles.");
                this.svgRoot.selectAll("*").remove();
                this.events.renderingFinished(options);
                return;
            }

            this.renderFrame();
            void isFirstBuild; // reserved for future first-build-only behavior
            this.events.renderingFinished(options);
        } catch (error) {
            console.error("Organization Tree Visual: error in update()", error);
            this.events.renderingFailed(options, String(error));
        }
    }

    private renderFrame(): void {
        if (!this.interactionController) {
            return;
        }
        const layoutCard = this.formattingSettings.cardLayoutCard;
        const connectorCard = this.formattingSettings.connectorCard;
        const metricsCard = this.formattingSettings.metricsDisplayCard;

        const metricKeys: string[] = [];
        // First bound metric name is resolved at render time by rendering.ts
        // via record.metrics; here we just decide which slots are enabled.
        const boundMetricNames = this.getBoundMetricNames();
        if (metricsCard.showMetric1.value && boundMetricNames[0]) {
            metricKeys.push(boundMetricNames[0]);
        }
        if (metricsCard.showMetric2.value && boundMetricNames[1]) {
            metricKeys.push(boundMetricNames[1]);
        }

        this.interactionController.renderCurrentState(
            {
                cardWidth: layoutCard.cardWidth.value,
                cardHeight: layoutCard.cardHeight.value,
                horizontalSpacing: layoutCard.horizontalSpacing.value,
                verticalSpacing: layoutCard.verticalSpacing.value
            },
            {
                connectorStyle: (connectorCard.style.value.value as "curved" | "orthogonal") ?? "curved",
                connectorColor: connectorCard.color.value.value ?? "#B0B7C3",
                showDesignation: metricsCard.showDesignation.value,
                metricKeys,
                fontSize: layoutCard.fontSize.value
            }
        );

        const atRoot = this.interactionController.isAtTrueRoot();
        this.backToTopButton.style.display = atRoot ? "none" : "block";
    }

    private getBoundMetricNames(): string[] {
        return this.boundMetricNames;
    }

    private showStatus(message: string): void {
        this.statusBanner.textContent = message;
        this.statusBanner.style.display = "block";
    }

    private hideStatus(): void {
        this.statusBanner.style.display = "none";
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
