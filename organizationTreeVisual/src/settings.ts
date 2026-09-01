/*
 *  Organization Tree Visual — formatting pane settings.
 *
 *  Replaces the scaffolded demo "dataPoint" card with real cards for this
 *  visual. Each `name` below must match the corresponding object/property
 *  names declared in capabilities.json's "objects" section exactly, or the
 *  formatting pane will not round-trip values.
 */

"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

/** Card layout: dimensions and spacing of employee cards. */
class CardLayoutSettings extends FormattingSettingsCard {
    cardWidth = new formattingSettings.NumUpDown({
        name: "cardWidth",
        displayName: "Card width",
        value: 180
    });

    cardHeight = new formattingSettings.NumUpDown({
        name: "cardHeight",
        displayName: "Card height",
        value: 74
    });

    horizontalSpacing = new formattingSettings.NumUpDown({
        name: "horizontalSpacing",
        displayName: "Horizontal spacing",
        value: 32
    });

    verticalSpacing = new formattingSettings.NumUpDown({
        name: "verticalSpacing",
        displayName: "Vertical spacing",
        value: 56
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Font size",
        value: 11
    });

    name: string = "cardLayout";
    displayName: string = "Card layout";
    slices: Array<FormattingSettingsSlice> = [
        this.cardWidth,
        this.cardHeight,
        this.horizontalSpacing,
        this.verticalSpacing,
        this.fontSize
    ];
}

/** Connector (link line) style. */
class ConnectorSettings extends FormattingSettingsCard {
    style = new formattingSettings.ItemDropdown({
        name: "style",
        displayName: "Connector style",
        items: [
            { value: "curved", displayName: "Curved" },
            { value: "orthogonal", displayName: "Orthogonal" }
        ],
        value: { value: "curved", displayName: "Curved" }
    });

    color = new formattingSettings.ColorPicker({
        name: "color",
        displayName: "Connector color",
        value: { value: "#B0B7C3" }
    });

    name: string = "connector";
    displayName: string = "Connectors";
    slices: Array<FormattingSettingsSlice> = [this.style, this.color];
}

/** Show/hide toggles for each of the up-to-8 bound "Metrics" measures, by slot order. */
class MetricsDisplaySettings extends FormattingSettingsCard {
    showMetric1 = new formattingSettings.ToggleSwitch({
        name: "showMetric1",
        displayName: "Show 1st metric",
        value: true
    });

    showMetric2 = new formattingSettings.ToggleSwitch({
        name: "showMetric2",
        displayName: "Show 2nd metric",
        value: false
    });

    showDesignation = new formattingSettings.ToggleSwitch({
        name: "showDesignation",
        displayName: "Show designation",
        value: true
    });

    showDirectReportsCount = new formattingSettings.ToggleSwitch({
        name: "showDirectReportsCount",
        displayName: "Show direct reports count",
        value: true
    });

    name: string = "metricsDisplay";
    displayName: string = "Metrics display";
    slices: Array<FormattingSettingsSlice> = [
        this.showDesignation,
        this.showMetric1,
        this.showMetric2,
        this.showDirectReportsCount
    ];
}

/** Root-navigation behavior: default auto-expand depth and max initial node count. */
class NavigationSettings extends FormattingSettingsCard {
    autoExpandLevels = new formattingSettings.NumUpDown({
        name: "autoExpandLevels",
        displayName: "Auto-expand levels from root",
        value: 2
    });

    maxInitialNodes = new formattingSettings.NumUpDown({
        name: "maxInitialNodes",
        displayName: "Max nodes shown before collapsing",
        value: 50
    });

    name: string = "navigation";
    displayName: string = "Root navigation";
    slices: Array<FormattingSettingsSlice> = [this.autoExpandLevels, this.maxInitialNodes];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    cardLayoutCard = new CardLayoutSettings();
    connectorCard = new ConnectorSettings();
    metricsDisplayCard = new MetricsDisplaySettings();
    navigationCard = new NavigationSettings();

    cards = [this.cardLayoutCard, this.connectorCard, this.metricsDisplayCard, this.navigationCard];
}
