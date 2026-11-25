export {};

declare global {
    /**
     * Extensible registry of inter-mod services registered via `TrafficityMods.provide()`
     * and retrieved via `TrafficityMods.use()`.
     *
     * Subsequent mods can augment this interface in their own `types.d.ts`
     * (avoid naming it `mod.d.ts` if your entry is `mod.js`, as same-stem `.d.ts`
     * files shadow `.js` files in TypeScript/JS LSP):
     * ```ts
     * declare global {
     *   interface TrafficityServices {
     *     myService: { doThing(): void };
     *   }
     * }
     * export {};
     * ```
     */
    interface TrafficityServices {}

    /** Original mod provenance recorded when a mod is forked. */
    interface TrafficityModForkOrigin {
        id: string;
        name: string;
        version: string;
        author?: string;
        downloadUrl?: string;
        codeHash?: string;
        forkedAt?: string;
    }

    /** Mod manifest stored in `mod.json`. */
    interface TrafficityModManifest {
        id: string;
        name: string;
        version: string;
        author?: string;
        description?: string;
        entry?: string;
        styles?: string[];
        dependencies?: string[];
        optionalDependencies?: string[];
        types?: string;
        modloaderVersion?: string;
        forkedFrom?: TrafficityModForkOrigin;
        lineage?: TrafficityModForkOrigin[];
    }

    /** Runtime mod entry returned by `TrafficityMods.getMods()`. */
    interface TrafficityCatalogMod extends TrafficityModManifest {
        folder: string;
        enabled: boolean;
        error?: string | null;
        hasSettings?: boolean;
        config?: Record<string, unknown>;
    }

    /** Current map container position, zoom, and viewport dimensions. */
    interface TrafficityCameraState {
        x: number;
        y: number;
        zoom: number;
        width: number;
        height: number;
    }

    /** World unit constants exposed by Trafficity's road geometry module. */
    interface TrafficityGameConstants {
        laneWidth: number;
        lanePointSpacing: number;
    }

    /** Road definition descriptor passed into road-snapping and placement helpers. */
    interface TrafficityRoadDefinition {
        /** Display/internal name of the road type. */
        name?: string;
        /** Number of lanes in the road definition. */
        lanesWide?: number;
        [key: string]: unknown;
    }

    /** Single undo/redo sub-record entry stored in Trafficity's undo journal. */
    interface TrafficityUndoSubRecord {
        /** Sub-record kind (e.g. `"confirm"`, `"buildings placed"`). */
        kind: string;
        /** Payload for `"confirm"` road/junction/intersection mutations. */
        record?: {
            createdLaneSections?: Array<{ id: number | string; links?: unknown; coords?: unknown }>;
            removedLaneSections?: Array<{ id: number | string; links?: unknown; points?: { coords?: unknown; withoutLocks?: () => unknown } }>;
            createdJunctions?: Array<{ id: number | string; [key: string]: unknown }>;
            removedJunctions?: Array<{ id: number | string; [key: string]: unknown }>;
            createdIntersections?: Array<{ id: number | string; [key: string]: unknown }>;
            removedIntersections?: Array<{ id: number | string; [key: string]: unknown }>;
            changedLaneSections?: Array<{ before: unknown; after: unknown; [key: string]: unknown }>;
            changedJunctions?: Array<{ before: unknown; after: unknown; [key: string]: unknown }>;
            changedIntersections?: Array<{ before: unknown; after: unknown; [key: string]: unknown }>;
            changedBuildingTargets?: Array<{ before: unknown; after: unknown; [key: string]: unknown }>;
            [key: string]: unknown;
        };
        [key: string]: unknown;
    }

    /** Top-level recorded player action entry in Trafficity's undo stack. */
    interface TrafficityUndoEntry {
        /** Sub-records comprising this undoable action. */
        subRecords?: TrafficityUndoSubRecord[];
        /** Net money delta applied by this action. */
        moneyDelta?: number;
        [key: string]: unknown;
    }

    /** Per-save undo history object returned by `undoHistory.getUndoHistory(saveState)`. */
    interface TrafficityUndoHistory {
        /** Active open transaction group, or `null` when idle. */
        openGroup: unknown;
        /** Stack of recorded undo entries. */
        entries: TrafficityUndoEntry[];
        /** ID rename maps maintained across undo/redo replays. */
        renames?: {
            laneSection?: Map<number | string, number | string>;
            crossable?: Map<number | string, number | string>;
            building?: Map<number | string, number | string>;
        };
        [key: string]: unknown;
    }

    /** Trafficity's internal undo action module (`undoLastAction`, `applyUndoSubRecord`). */
    interface TrafficityUndoModule {
        /** Revert the most recent player action. Returns `"undone"` on success. */
        undoLastAction: (gameState: TrafficityGameState, deps: Record<string, unknown>) => string;
        /** Apply a single undo/redo sub-record directly to `gameState`. */
        applyUndoSubRecord: (
            gameState: TrafficityGameState,
            history: TrafficityUndoHistory,
            subRecord: TrafficityUndoSubRecord,
            deps: Record<string, unknown>,
        ) => void;
        [key: string]: unknown;
    }

    /** Trafficity's per-save undo history module. */
    interface TrafficityUndoHistoryModule {
        /** Look up the undo history for `saveState`. */
        getUndoHistory: (saveState: TrafficitySaveState) => TrafficityUndoHistory | null;
        [key: string]: unknown;
    }

    /** Internal undo module handles captured from Trafficity's bundle. */
    interface TrafficityUndoApi {
        /** Undo/redo action module (`undoLastAction`, `applyUndoSubRecord`). */
        undoModule: TrafficityUndoModule | null;
        /** Per-save undo history registry (`getUndoHistory(saveState)`). */
        undoHistory: TrafficityUndoHistoryModule | null;
        /** Live Trafficity `gameState` object when available. */
        gameState: TrafficityGameState | null;
        /** Internal undo dependency bundle captured on undo calls. */
        undoDeps: Record<string, unknown> | null;
    }

    /** Active cursor / placement tool state from `gameState.cursorMode`. */
    interface TrafficityCursorState {
        /** Active cursor mode name (e.g. `"default"`, `"road placement"`, `"grid"`, `"building placement"`). */
        mode: string;
        /** Start point for 2-point road placement, when active. */
        startPoint?: TrafficityRoadPointRef | null;
        /** First anchor point for 3-point grid placement, when active. */
        firstPoint?: TrafficityRoadPointRef | null;
        /** Second anchor point for 3-point grid placement, when active. */
        secondPoint?: TrafficityRoadPointRef | null;
        /** Active building type slug during `"building placement"`. */
        buildingDefinitionName?: string;
        /** Highlighted building IDs during hover/delete previews. */
        highlightedBuildingIds?: Set<number>;
        [key: string]: unknown;
    }

    /** Trafficity's internal road-snapping module (`getNearestLaneCreationPoint`). */
    interface TrafficitySnapModule {
        /** Resolve the nearest road snap/creation point for world coordinates `(worldX, worldY)`. */
        getNearestLaneCreationPoint: (
            gameState: TrafficityGameState,
            worldX: number,
            worldY: number,
            roadDefinition?: TrafficityRoadDefinition,
            startPoint?: TrafficityRoadPointRef | null,
        ) => TrafficityRoadPointRef | null;
        [key: string]: unknown;
    }

    /** Internal snap module handle captured from Trafficity's bundle. */
    interface TrafficitySnapApi {
        /** Road snapping module (`getNearestLaneCreationPoint`). */
        snapModule: TrafficitySnapModule | null;
    }

    /** High-level lifecycle event handlers supported by `TrafficityMods.game.on()`. */
    interface TrafficityGameEventMap {
        ready: () => void;
        cursorModeChange: (mode: string | null, prevMode: string | null) => void;
        worldChange: (worldRevision: number, prevRevision: number) => void;
        roadPlaced: (info: { entriesCount: number; worldRevision: number | null }) => void;
    }

    /** PixiJS v8 graphics drawing primitive used for world overlays and radius rings. */
    interface TrafficityPixiGraphics {
        /** Move drawing cursor to `(x, y)` in world space. */
        moveTo(x: number, y: number): this;
        /** Draw a line segment from the current cursor to `(x, y)`. */
        lineTo(x: number, y: number): this;
        /** Queue a circle path centered at `(x, y)` with `radius`. */
        circle(x: number, y: number, radius: number): this;
        /** Queue a rectangle path at `(x, y)` with `width` and `height`. */
        rect(x: number, y: number, width: number, height: number): this;
        /** Queue a closed polygon from flat `[x0, y0, x1, y1, ...]` coordinates. */
        poly(points: number[]): this;
        /** Fill queued paths with a color and optional alpha. */
        fill(color: number | string | Record<string, unknown>, alpha?: number): this;
        /** Stroke queued paths with width, color, and alpha. */
        stroke(options: { width?: number; color?: number | string; alpha?: number }): this;
        /** Clear all queued geometry on this graphics object. */
        clear(): this;
        /** Whether this graphics object has been destroyed. */
        destroyed?: boolean;
        /** Destroy this graphic and optionally its GPU context/children. */
        destroy(options?: boolean | { children?: boolean; context?: boolean }): void;
    }

    /** PixiJS v8 container primitive for world rendering layers. */
    interface TrafficityPixiContainer {
        /** `true` once this container has been destroyed. */
        readonly destroyed?: boolean;
        /** Child display objects attached to this container. */
        readonly children: unknown[];
        /** Append one or more child display objects. */
        addChild(...children: unknown[]): unknown;
        /** Remove one or more child display objects. */
        removeChild(...children: unknown[]): unknown;
        /** Remove children in `[beginIndex, endIndex)` and return them. */
        removeChildren(beginIndex?: number, endIndex?: number): unknown[];
        /** Destroy this container and optionally its children/GPU context. */
        destroy(options?: boolean | { children?: boolean; context?: boolean }): void;
    }

    /** Building mesh containers passed to `onRenderWorld` and `createBuildingGraphicsParts`. */
    interface TrafficityBuildingGraphicsParts {
        /** Main building extrusion/sprite container (`layers.buildingsObject`). */
        object: TrafficityPixiContainer;
        /** Ground asphalt/parking pad container (`layers.buildingsGround`). */
        ground: TrafficityPixiContainer;
        /** Sidewalk cutout container (`layers.buildingsGroundSidewalk`). */
        groundSidewalk: TrafficityPixiContainer;
        /** Extruded ground shadow container (`layers.shadows`). */
        shadow: TrafficityPixiContainer;
        /** `true` when `buildingCategory === "industrial"`. */
        isIndustrial?: boolean;
    }

    /** Placed building footprint geometry in world coordinates. */
    interface TrafficityBuildingFootprint {
        /** Placement validity state (`"valid"`, `"notAlongRoad"`, `"wrongTerrain"`, etc.). */
        validity: string;
        /** Plot frontage width in world units. */
        width: number;
        /** Plot depth perpendicular to frontage in world units. */
        depth: number;
        /** World X center coordinate of the plot. */
        centerX: number;
        /** World Y center coordinate of the plot. */
        centerY: number;
        /** Plot rotation in radians. */
        rotation: number;
        /** Side of the road frontage (`"left"` or `"right"`). */
        direction?: "left" | "right";
        /** Leftmost road lane point targeted by this building's frontage. */
        leftTargetPoint?: { laneSectionId: number; pointIndex: number };
        /** Rightmost road lane point targeted by this building's frontage. */
        rightTargetPoint?: { laneSectionId: number; pointIndex: number };
    }

    /** Live building instance stored in `saveState.buildings[id]`. */
    interface TrafficityBuildingRecord {
        /** Unique numeric building ID allocated by `saveState`. */
        id: number;
        /** Building definition slug (e.g. `"small-residential"` or `"eco-scrubber"`). */
        type: string;
        /** Primary hex color from `buildingColors[0]`. */
        color: string;
        /** Resolved world footprint geometry and road target points. */
        footprint: TrafficityBuildingFootprint;
        /** Computed lane wait points for vehicles entering/exiting this plot. */
        waitPoints: Array<{ laneSectionId: number; pointIndex: number }>;
        /** Precomputed garage entry options when using an internal parking garage. */
        garageEntryOptions: unknown[];
        /** Lock holder IDs for each outdoor parking space (`null` when free). */
        parkingSpaceLockHolders: Array<unknown | null>;
    }

    /** Pollution grid buffer & query helpers stored on `saveState.pollutionGrid`. */
    interface TrafficityPollutionGrid {
        /** Flat `Float32Array` of underlying pollution values (`0..1`) per grid cell. */
        pollutionValues: Float32Array;
        /** Total number of cells in the pollution grid. */
        getCellCount(): number;
        /** Number of grid columns. */
        getGridWidth?(): number;
        /** Number of grid rows. */
        getGridHeight?(): number;
        /** Grid column index (`x`) for flat cell `index`. */
        getCellXFromIndex(index: number): number;
        /** Grid row index (`y`) for flat cell `index`. */
        getCellYFromIndex(index: number): number;
        /** Clamp and set underlying pollution at world `(x, y)`. */
        setPollutionAtMapPoint(x: number, y: number, value: number): void;
        /** Sample normalized overlay intensity (`0..1`) at world `(x, y)` between `startCutoff` and `fullCutoff`. */
        getDrivedATMapPoint?(x: number, y: number, startCutoff: number, fullCutoff: number): number;
        /** Read raw underlying pollution at world `(x, y)`. */
        getUnderlyingPollutionAtMapPoint(x: number, y: number): number;
        /** Raise pollution at world `(x, y)` to at least `value`. */
        raisePollutionToAtLeast(x: number, y: number, value: number): void;
    }

    /** Vanilla or custom building definition entry stored in `BUILDING_DEFINITIONS`. */
    interface TrafficityBuildingDefinition {
        /** Unique building definition slug. */
        type: string;
        /** Simulation category (`"residential"`, `"commercial"`, `"office"`, or `"industrial"`). */
        buildingCategory: "residential" | "commercial" | "office" | "industrial";
        /** Hex color palette (`buildingColors[0]` is primary color). */
        buildingColors: string[];
        /** Static pollution emission level. */
        pollutionOutput: "none" | "low" | "medium" | "high";
        /** Whether nearby air pollution reduces this building's happiness. */
        pollutionAffectsHappiness?: boolean;
        /** Plot frontage width in world units. */
        width: number;
        /** Plot depth in world units. */
        depth: number;
        /** Outdoor frontage parking stall X-offsets along `[0, width]`. */
        parkingSpaces: number[];
        /** Internal garage entrance X-offset along frontage. */
        parkingGarageEntrance?: number;
        /** Internal garage exit X-offset along frontage. */
        parkingGarageExit?: number;
        /** Maximum visitor capacity for internal garage buildings. */
        parkingGarageEffectiveCapacity?: number;
        /** Cargo resource IDs consumed by this building. */
        inputs: Array<"food" | "copper" | "iron" | "steel" | "cpg">;
        /** Cargo resource IDs produced by this building. */
        outputs: Array<"food" | "copper" | "iron" | "steel" | "cpg">;
        /** Maximum simultaneous incoming delivery vans. */
        vanCapacity?: number;
        /** Per-resource simultaneous incoming supply truck capacity. */
        truckCapacity?: Partial<Record<"food" | "copper" | "iron" | "steel" | "cpg", number>>;
        /** Terrain type required under the plot footprint. */
        requiredTerrain?: string;
        /** Terrain type forbidden under the plot footprint. */
        forbiddenTerrain?: string;
        /** Rear-edge terrain requirement (`"mountain"` or `"water"`). */
        mineTerrain?: "mountain" | "water";
        /** Y-offset for the toolbar resource badge arrow. */
        labelY?: number;
        /** Procedural 2.5D polygon extrusions generator for `(width, depth)`. */
        getExtrusions?: (width: number, depth: number) => Array<{
            points: Array<{ x: number; y: number; height: number; nextEdgeOffsetOverride?: number }>;
            roofDarkness: number;
            colorIndex?: number;
            roofDirectionOverride?: number;
            skipRoofOutline?: boolean;
        }>;
    }

    /** Serialized & live simulation world state (`gameState.saveState`). */
    interface TrafficitySaveState {
        /** Monotonic counter incremented whenever roads, junctions, or buildings mutate. */
        worldRevision?: number;
        /** Current camera zoom scale factor. */
        cameraZoom: number;
        /** Player road-construction budget. */
        money: number;
        /** Remaining land tile unlocks available to claim. */
        tileUnlockCount: number;
        /** Traffic driving side (`"left"` or `"right"`). */
        drivingSide: "left" | "right";
        /** Active difficulty mode (`"chill"`, `"normal"`, or `"expert"`). */
        difficultyMode: "chill" | "normal" | "expert";
        /** Active road elevation tier for new road placement. */
        roadPlacementElevation: number;
        /** Active road placement geometry mode (`"straight"`, `"curvy"`, etc.). */
        roadPlacementMode: string;
        /** Whether angle snapping is enabled during road/roundabout placement. */
        angleSnappingEnabled?: boolean;
        /** Map of placed buildings keyed by stringified building ID. */
        buildings: Record<string, TrafficityBuildingRecord>;
        /** Map of active resident vehicles keyed by resident ID. */
        residents: Record<string, unknown>;
        /** Map of road lane sections keyed by section ID. */
        laneSections: Record<string, { id?: number | string; points?: { coords?: unknown; withoutLocks?: () => unknown }; [key: string]: unknown }>;
        /** Map of road junctions keyed by junction ID. */
        junctions: Record<string, Record<string, unknown>>;
        /** Map of multi-road intersections keyed by intersection ID. */
        intersections: Record<string, Record<string, unknown>>;
        /** Total unlocked placement quota per building type. */
        cumulativeBuildingCount: Record<string, number>;
        /** Active air pollution grid buffer (`undefined` on menus). */
        pollutionGrid?: TrafficityPollutionGrid;
        /** SharedArrayBuffer resident metadata store. */
        parallelResidentMetadata?: unknown;
    }

    /** Top-level Trafficity renderer & simulation coordinator state. */
    interface TrafficityGameState {
        /** Current save/simulation world state. */
        saveState: TrafficitySaveState;
        /** Active cursor tool mode and placement draft state. */
        cursorMode?: TrafficityCursorState;
        /** Active UI mode (e.g. `"building viewing"` with `buildingId`). */
        uiMode?: { mode: string; buildingId?: number; [key: string]: unknown };
        /** Currently selected world entity (building, car, intersection, etc.). */
        worldSelection?: { type: string; buildingId?: number; selectedResidentCarId?: number | null };
        /** Root PixiJS map container holding world-space layers. */
        mapContainer?: { position: { x: number; y: number } };
        /** Active PixiJS WebGL/WebGPU renderer instance. */
        renderer?: { screen?: { width: number; height: number } };
        /** Named PixiJS world scene layers (`buildingsGround`, `buildingsObject`, `shadows`, etc.). */
        layers?: Record<string, TrafficityPixiContainer>;
        /** Per-building PixiJS graphic containers keyed by building ID. */
        buildingGraphics?: {
            ground: Map<number, TrafficityPixiContainer>;
            groundSidewalk: Map<number, TrafficityPixiContainer>;
            object: Map<number, TrafficityPixiContainer>;
            shadow: Map<number, TrafficityPixiContainer>;
        };
        /** Whether a mouse button is currently pressed on the map canvas. */
        mouseIsDown?: boolean;
        /** Whether a modal dialog is currently blocking world interaction. */
        isModalDialogOpen?: boolean;
        /** Currently held modifier/shortcut keys. */
        keysPressed?: Set<string>;
        /** Internal flag indicating 90-degree midpoint-to-midpoint snap is active. */
        draftMidpointToMidpointNinetySnapActive?: boolean;
        /** Replace the active world-space selection overlay graphic (e.g. radius ring). */
        setWorldSelectionGraphic(graphic: TrafficityPixiGraphics | null): void;
        /** Schedule a React HUD re-render on the next frame. */
        requestUiRefresh?(): void;
    }

    /** Road creation / snap point descriptor used by `getNearestLaneCreationPoint` and placement hooks. */
    interface TrafficityRoadPointRef {
        /** Point kind (`"absolute"`, `"glued point"`, `"midpoint"`, `"snapped intersection center"`, etc.). */
        type: string;
        /** World X coordinate (when absolute/snapped). */
        x?: number;
        /** World Y coordinate (when absolute/snapped). */
        y?: number;
        /** Elevation tier for new lane creation. */
        elevation?: number;
        /** Road lane count width. */
        lanesWide?: number;
        /** Glued lane point locator when attached to an existing lane. */
        locator?: { laneSectionId: number; pointIndex: number };
        /** Optional glue target locator key when snapped along an existing lane. */
        _gluedToLocatorOn?: string;
        /** Span end locators when snapping to a road midpoint. */
        spanEndLocators?: Array<{ laneSectionId: number; pointIndex: number }>;
    }

    /** Result returned by `getRoadConstructionActionWithPlacement`. */
    interface TrafficityRoadConstructionResult {
        /** Computed road construction steps and validity (`exists`, `why`). */
        constructionAction: { exists: boolean; why?: string; steps?: unknown[] };
        /** Placement validation result (`isPlacementBlocked`, tooltip label, conflicting buildings). */
        draftRoadPlacement: { isPlacementBlocked: boolean; blockedReasonLabel?: string | null; buildingConflictIds?: number[] };
    }

    /** Result returned by `getPlaceRoundaboutResultForSize`. */
    interface TrafficityRoundaboutResult {
        /** Roundabout construction action and affected lane sections. */
        result: {
            constructionAction: { exists: boolean; why?: string };
            uniqueLocatorKeys?: unknown;
            pointIndexesBySection?: unknown;
            sectionRanges?: unknown;
        };
        /** Outer radius of the evaluated roundabout in world units. */
        radius: number;
    }

    /** Typed exports for each official Trafficity module key in `TrafficityMods.game.MODULES`. */
    interface TrafficityModuleMap {
        BUILDING_DEFINITIONS: {
            BUILDING_DEFINITIONS: TrafficityBuildingDefinition[];
            getBuildingDefaultColor(type: string): string;
            getBuildingDefinition(type: string): TrafficityBuildingDefinition;
        };
        BUILDING_DISPLAY_NAMES: {
            buildingDisplayName(type: string): string;
            roadDisplayName(name: string): string;
            resourceDisplayName(id: string): string;
            terrainDisplayName(id: string): string;
        };
        BUILDING_VEHICLE_SPECS: {
            getBuildingCarCountSpec(type: string): { cars?: number; trucks?: Record<string, number>; vans?: Record<string, number> } | null;
            getResidentCarCountForResidentialBuildingType(type: string): number;
            getTotalVehicleCountForBuildingType(type: string): number;
        };
        BUILDING_VISITED_NEEDS: { buildingHasGetVisitedNeed(type: string): boolean };
        BUILDING_SATISFACTION_WEIGHTS: {
            getSatisfactionWeightForBuildingType(type: string): number;
            getSatisfactionWeightForPackNumber(packNumber: number, getter: unknown): number;
        };
        BUILDING_PLACEMENT: {
            placeBuildingAtFootprint(gameState: TrafficityGameState, def: TrafficityBuildingDefinition, footprint: TrafficityBuildingFootprint, deps: Record<string, unknown>): number;
            restoreBuildingsAtFootprints(gameState: TrafficityGameState, items: Array<{ definition: TrafficityBuildingDefinition; footprint: TrafficityBuildingFootprint }>, deps: Record<string, unknown>): number[];
            placeBuildingsFromFootprints(gameState: TrafficityGameState, type: string, footprints: TrafficityBuildingFootprint[], deps: Record<string, unknown>, playSfx?: boolean): void;
        };
        BUILDING_DELETION: { deleteBuildingsFromGameState(gameState: TrafficityGameState, ids: number[]): void };
        BUILDING_GRAPHICS: {
            createBuildingGraphicsParts(gameState: TrafficityGameState, building: TrafficityBuildingRecord, opts?: Record<string, unknown>): TrafficityBuildingGraphicsParts;
            applyBuildingDisplayColors(gameState: TrafficityGameState, building: TrafficityBuildingRecord): void;
            updateBuildingGraphics(gameState: TrafficityGameState, building: TrafficityBuildingRecord, opts?: Record<string, unknown>): void;
        };
        BUILDING_PREVIEW_UI: { BuildingPreview: unknown; prebakeAllBuildingPreviewIcons(): Promise<void>; getDefaultBuildingPreviewShadowColor(): string };
        BUILDING_TOOLTIP_UI: { BuildingTypeTooltip: (props: { buildingDefinition: TrafficityBuildingDefinition }) => { props?: { children?: unknown } } };
        BUILDING_VIEW_PANEL_UI: { BuildingViewPanel: unknown };
        BUILDING_HAPPINESS: { getOverallHappinessForBuilding(meta: unknown, buildingId: number, buildingType: string): number };
        ROAD_CONSTANTS: { LANE_WIDTH: number; LANE_POINT_SPACING: number; MINIMUM_TURN_RADIUS: number; SIDEWALK_WIDTH: number };
        ROAD_SNAP: TrafficitySnapModule;
        ROAD_PLACEMENT: { getRoadConstructionActionWithPlacement(gameState: TrafficityGameState, startPoint: TrafficityRoadPointRef, endPoint: TrafficityRoadPointRef): TrafficityRoadConstructionResult };
        ROAD_CONSTRUCTION: { getRoadConstructionAction(gameState: TrafficityGameState, startPoint: TrafficityRoadPointRef, endPoint: TrafficityRoadPointRef): TrafficityRoadConstructionResult["constructionAction"] };
        ROUNDABOUT_PLACEMENT: {
            getPlaceRoundaboutResultForSize(gameState: TrafficityGameState, center: { x: number; y: number }, size: string): TrafficityRoundaboutResult;
            evaluatePlaceRoundaboutDraftPlacement(...args: unknown[]): { isPlacementBlocked: boolean; blockedReasonLabel?: string | null };
        };
        POLLUTION_FROM_BUILDINGS: { MINIMUM_POLLUTION_BY_OUTPUT: Record<string, number>; updatePollutionFromBuildings(saveState: TrafficitySaveState): void };
        POLLUTION_GRID: { POLLUTION_CELL_SIZE: number };
        POLLUTION_DIFFUSION: { updatePollutionDiffusion(pollutionGrid: TrafficityPollutionGrid): void };
        POLLUTION_RADIUS_UI: {
            createPollutionRadiusPreviewGraphics(cx: number, cy: number, radius: number, zoom: number): TrafficityPixiGraphics;
            setBuildingPollutionRadiusSelectionGraphic(gameState: TrafficityGameState, buildingId: number): void;
        };
        LEVEL_PROGRESSION: {
            setPendingDevelopmentPackUnlockIfEligible(saveState: TrafficitySaveState, totalSatisfaction: number, flowPercent: number): boolean;
            claimPendingDevelopmentPackUnlock(saveState: TrafficitySaveState, trafficFlow: unknown): void;
            getTileUnlocksForPack(packNumber: number, difficultyMode: string): number;
        };
        SCENARIOS: { SCENARIOS: Array<{ id: string; developmentPackGetter: (packNumber: number, terrainType: string) => Record<string, unknown> }> };
        DIFFICULTY_MODES: {
            DIFFICULTY_MODES: string[];
            getUnlockMetricThresholdPercent(difficulty: string, level: number): number | null;
            scaleBudgetForDifficulty(level: number, difficulty: string): number;
        };
        CAMERA: {
            CAMERA_ZOOM_FACTOR: number;
            CAMERA_MAX_ZOOM: number;
            getZoomAwareStrokeWidth(zoom: number): number;
        };
        UI_SFX: { playUiSfx(name: string): void };
        SOUND_LIBRARY: { sound: { exists(alias: string): boolean; add(alias: string, opts: Record<string, unknown>): void; remove(alias: string): void; play(alias: string, opts?: Record<string, unknown>): unknown } };
        MUSIC_CONTROLLER: { createGameMusicController(): { playMenuMusic(): void; playGamePlaylist(): void; stopImmediate(): void; fadeToSilence(ms: number): void } };
        I18N: { t(key: string, vars?: Record<string, unknown>): string; getLocalisationLanguage(): string };
        PIXI_CONTAINER: { Container: new () => TrafficityPixiContainer };
        PIXI_GRAPHICS: { Graphics: new () => TrafficityPixiGraphics };
        PIXI_SPRITE: { Sprite: new (opts?: Record<string, unknown>) => Record<string, unknown> };
        PIXI_TEXTURE: { Texture: new (opts?: Record<string, unknown>) => Record<string, unknown> };
        PIXI_CANVAS_SOURCE: { CanvasSource: new (opts: { resource: HTMLCanvasElement }) => Record<string, unknown> };
        REACT_JSX: { jsx(type: unknown, props: Record<string, unknown>, key?: unknown): { props?: Record<string, unknown> }; jsxs(type: unknown, props: Record<string, unknown>, key?: unknown): { props?: Record<string, unknown> }; Fragment: symbol };
    }

    /** Official human-readable Trafficity module keys mapped in `TrafficityMods.game.MODULES`. */
    type TrafficityModuleName = keyof TrafficityModuleMap;

    /**
     * Extensible game facade exposed at `window.TrafficityMods.game`.
     * Mods calling `extendGame()` can augment this interface in their own `types.d.ts`.
     */
    interface TrafficityGameFacade {
        /** Official map of human-readable module names to Trafficity Parcel module IDs. */
        readonly MODULES: Readonly<Record<TrafficityModuleName, string>>;
        /** Subscribe to a high-level game lifecycle event. Returns an unsubscribe function. */
        on<K extends keyof TrafficityGameEventMap>(event: K, handler: TrafficityGameEventMap[K]): () => void;
        /** Resolve a typed internal Trafficity module by official `game.MODULES` name. */
        requireModule<K extends TrafficityModuleName>(name: K): TrafficityModuleMap[K] | null;
        /** Resolve an internal Trafficity module by arbitrary name or raw Parcel ID. */
        requireModule<T = Record<string, unknown>>(nameOrId: string): T | null;
        /** Require an internal webpack/router module by its raw Parcel bundle chunk ID. */
        requireRouterModule<T = Record<string, unknown>>(id: string): T | null;

        /** Click a toolbar or control button matching `[data-tutorial-target="<target>"]`. */
        pressButton(target: string): boolean;

        /** Check whether `[data-tutorial-target="<target>"]` is currently selected. */
        isButtonSelected(target: string): boolean;

        /** Return all visible toolbelt slot button elements in order. */
        getToolbeltSlots(): HTMLButtonElement[];

        /** Click the toolbelt slot at `index` (0-based). */
        selectToolbeltSlot(index: number): boolean;

        /** Cycle to the next (`delta >= 0`) or previous (`delta < 0`) available toolbelt slot, skipping disabled/exhausted items. */
        cycleToolbeltSlot(delta: number): boolean;

        /** Return the active cursor mode (e.g. `"default"`, `"road placement"`, `"grid"`), or `null` if unavailable. */
        getCursorMode(): string | null;

        /** Return the full active `gameState.cursorMode` object (mode, `startPoint`, `firstPoint`, etc.), or `null` if unavailable. */
        getCursorState(): TrafficityCursorState | null;

        /** Return `true` when the player is idle (no tool or placement active). */
        isIdle(): boolean;

        /** Dispatch a synthetic mouse event onto the game canvas without re-triggering `mods.onMouse` listeners. */
        sendSyntheticMouse(type: string, init?: MouseEventInit): void;

        /** Dispatch a synthetic wheel event onto the game canvas without re-triggering `mods.onMouse` listeners. */
        sendSyntheticWheel(init?: WheelEventInit): void;

        /** Observe toolbelt DOM updates via `MutationObserver` and invoke `callback` with the current slots. Returns a stop function. */
        watchToolbelt(callback: (slots: HTMLButtonElement[]) => void): () => void;

        /** Attach or update a numbered corner badge (`.tmod-slot-badge`) on a toolbelt slot button. */
        addSlotBadge(slotBtn: Element, label: string | number): void;

        /** Attach or update a small corner hint badge (`.tmod-hint-badge`) on `[data-tutorial-target="<target>"]`. */
        addButtonHint(target: string, label: string): void;

        /** Play a built-in Trafficity UI sound effect by name (e.g. `"placeRoad"`). */
        playSfx(name: string): boolean;

        /** Set simulation speed (`"pause"`, `"stop"`, `"normal"`, or `"fast"`). */
        setSpeed(mode: "pause" | "stop" | "normal" | "fast"): void;

        /** Trigger Trafficity's native Undo (`Ctrl+Z`). */
        undo(): void;

        /** Trigger Trafficity's native Cancel (`Escape`). */
        cancel(): void;

        /** Access captured Trafficity undo module, history stack, and gameState references. */
        getUndoApi(): TrafficityUndoApi;

        /** Access captured Trafficity road-snap module reference. */
        getSnapApi(): TrafficitySnapApi;

        /** Configure midpoint-overlap snap search bounds and debug log suppression. */
        configureSnapSearch(options?: { maxSteps?: number; stride?: number; suppressLog?: boolean }): {
            maxSteps: number;
            stride: number;
            suppressLog: boolean;
        };

        /** Read current camera position, zoom, and renderer dimensions, or `null` if not ready. */
        getCameraState(): TrafficityCameraState | null;

        /** Convert world coordinates to screen pixel coordinates, or `null` if the camera is not ready. */
        worldToScreen(worldX: number, worldY: number): { x: number; y: number } | null;

        /** Convert screen pixel coordinates to world coordinates, or `null` if the camera is not ready. */
        screenToWorld(screenX: number, screenY: number): { x: number; y: number } | null;

        /** Read Trafficity road geometry constants (`laneWidth`, `lanePointSpacing`). */
        getConstants(): TrafficityGameConstants;

        /** Return Trafficity's zoom-compensated stroke width for world overlays at `zoom` (defaults to current camera zoom). */
        getZoomAwareStrokeWidth(zoom?: number): number;

        /** Create a PixiJS dashed circle `Graphics` object for world preview/selection rings. */
        createDashedCircle(
            cx: number,
            cy: number,
            radius: number,
            options?: { color?: number; alpha?: number; strokeWidth?: number; dashLength?: number; gapLength?: number },
        ): TrafficityPixiGraphics | null;

        /** Look up a vanilla or custom building definition record by `type`, or `null` if unavailable. */
        getBuildingDefinition(type: string): TrafficityBuildingDefinition | null;

        /** Read Trafficity's pollution grid configuration (`{ cellSize }`). */
        getPollutionConfig(): { cellSize: number };

        /** Display a colored dashed radius ring whenever a building of `buildingType` is selected in-world. */
        setSelectionRadiusRing(buildingType: string, options: { radius: number; color?: number; alpha?: number }): void;

        /** Append a custom description line to the toolbar hover tooltip for `buildingType`. */
        addBuildingTooltipLine(
            buildingType: string,
            textOrProvider: string | ((buildingDefinition: TrafficityBuildingDefinition) => string),
            style?: Record<string, string>,
        ): void;

        /** Append custom info lines or structured telemetry tables to the clicked building inspection panel (`BuildingViewPanel`). Returns an unsubscribe function. */
        addBuildingViewPanelSection(
            provider: (context: {
                building: TrafficityBuildingRecord;
                buildingDefinition: TrafficityBuildingDefinition | null;
                saveState: TrafficitySaveState;
                gameState: TrafficityGameState;
            }) => string | TrafficityBuildingViewPanelSection | Array<string | TrafficityBuildingViewPanelSection> | null | undefined,
        ): () => void;

        /** Read live overall satisfaction and per-factor breakdown (`current`, `target`, `velocity`) for `buildingId`. */
        getBuildingSatisfaction(buildingId: number, saveState?: TrafficitySaveState): TrafficityBuildingSatisfactionReport | null;

        /** Return the live game state object when a city is active. */
        getGameState(): TrafficityGameState | null;

        /** Redraw the pollution overlay bitmap from `saveState.pollutionGrid` immediately if active. */
        refreshPollutionOverlay(): void;

        /** Create a fresh PixiJS `Graphics` object for world-space overlays. */
        createGraphics(): TrafficityPixiGraphics | null;

        /** Create a smooth bilinearly-interpolated 1px-per-cell `Canvas` + `Sprite` overlay (matching `pollutionOverlayBitmap`). */
        createGridOverlaySprite(
            gridWidth: number,
            gridHeight: number,
            cellSize: number,
        ): {
            canvas: HTMLCanvasElement;
            context: CanvasRenderingContext2D;
            imageData: ImageData;
            sprite: TrafficityPixiContainer & { destroyed?: boolean; x: number; y: number; width: number; height: number; texture?: { source?: { scaleMode?: string; update?: () => void } } };
            update(): void;
        } | null;

        /** Subscribe a callback that runs right after each pollution diffusion step. Returns an unsubscribe function. */
        onPollutionDiffusion(
            handler: (
                pollutionGrid: TrafficityPollutionGrid,
                context: { saveState: TrafficitySaveState; cellSize: number; getBuildingDefinition: (type: string) => TrafficityBuildingDefinition | null },
            ) => void,
        ): () => void;

        /** Wrap road snapping (`getNearestLaneCreationPoint`) with a composable wrapper factory. Returns an unsubscribe function. */
        hookRoadSnap(
            wrapperFactory: (
                orig: (
                    gameState: TrafficityGameState,
                    worldX: number,
                    worldY: number,
                    roadDefinition?: TrafficityRoadDefinition,
                    startPoint?: TrafficityRoadPointRef | null,
                ) => TrafficityRoadPointRef | null,
            ) => (
                gameState: TrafficityGameState,
                worldX: number,
                worldY: number,
                roadDefinition?: TrafficityRoadDefinition,
                startPoint?: TrafficityRoadPointRef | null,
            ) => TrafficityRoadPointRef | null,
        ): () => void;

        /** Wrap roundabout placement evaluation (`getPlaceRoundaboutResultForSize`) with a composable wrapper factory. Returns an unsubscribe function. */
        hookRoundaboutPlacement(
            wrapperFactory: (
                orig: (gameState: TrafficityGameState, center: { x: number; y: number }, size: string) => TrafficityRoundaboutResult,
            ) => (gameState: TrafficityGameState, center: { x: number; y: number }, size: string) => TrafficityRoundaboutResult,
        ): () => void;

        /** Wrap road placement evaluation (`getRoadConstructionActionWithPlacement`) with a composable wrapper factory. Returns an unsubscribe function. */
        hookRoadPlacement(
            wrapperFactory: (
                orig: (gameState: TrafficityGameState, startPoint: TrafficityRoadPointRef, endPoint: TrafficityRoadPointRef) => TrafficityRoadConstructionResult,
            ) => (gameState: TrafficityGameState, startPoint: TrafficityRoadPointRef, endPoint: TrafficityRoadPointRef) => TrafficityRoadConstructionResult,
        ): () => void;

        /** Return the detected Trafficity game release/version string, or `null`. */
        getGameRelease(): string | null;
    }

    /** Configuration for `TrafficityMods.buildings.register()`. */
    interface TrafficityCustomBuildingConfig {
        /** Unique building type slug (e.g. `"my-mod:cafe"`), stored in saves and worker lookup tables. */
        type: string;
        /** Simulation category controlling Trafficity role, `BuildingViewPanel` layout, and satisfaction type. */
        buildingCategory: "residential" | "commercial" | "office" | "industrial";
        /** Fallback display name shown in toolbar tooltips and building panels. Defaults to `type`. */
        name?: string;
        /** Optional localized names keyed by language code (`"en"`, `"fr"`, `"de"`, `"es"`, `"ru"`, `"ptbr"`, `"zhs"`, `"ja"`, `"ko"`). */
        localizedNames?: Record<string, string>;
        /** Hex color palette (`"#RRGGBB"`). Index `0` is the primary roof/body color; extrusions use `colorIndex`. */
        buildingColors?: string[];
        /** Plot frontage width in world units along the road edge. Defaults to `110`. */
        width?: number;
        /** Plot depth in world units extending away from the road edge. Defaults to `90`. */
        depth?: number;
        /** X-offsets along `[0, width]` for outdoor frontage parking stalls (mutually exclusive with `garage`). */
        parkingSpaces?: number[];
        /** Internal drive-in garage entrance/exit X-offsets and effective visitor capacity (mutually exclusive with `parkingSpaces`). */
        garage?: { entrance: number; exit: number; effectiveCapacity: number } | null;
        /** Cargo resource IDs consumed by this building. */
        inputs?: Array<"food" | "copper" | "iron" | "steel" | "cpg">;
        /** Cargo resource IDs produced by this building. */
        outputs?: Array<"food" | "copper" | "iron" | "steel" | "cpg">;
        /** Maximum simultaneous incoming delivery vans (also subtracted from `parkingSpaces.length` for visitor capacity). */
        vanCapacity?: number;
        /** Per-resource simultaneous incoming supply truck slots. */
        truckCapacity?: Partial<Record<"food" | "copper" | "iron" | "steel" | "cpg", number>>;
        /** Static pollution emitted at the plot center (`0` / `0.55` / `0.65` / `0.75`). Defaults to `"none"`. */
        pollutionOutput?: "none" | "low" | "medium" | "high";
        /** Whether nearby air pollution reduces this building's happiness. Defaults to `true` for `"residential"`. */
        pollutionAffectsHappiness?: boolean;
        /** Terrain type that the footprint must intersect when placing. */
        requiredTerrain?: "water" | "land" | "mountain" | "void" | "sand" | "grass" | "wasteland" | "deepwasteland";
        /** Terrain type that blocks placement if intersected by the footprint. */
        forbiddenTerrain?: "water" | "land" | "mountain" | "void" | "sand" | "grass" | "wasteland" | "deepwasteland";
        /** Rear-edge terrain constraint (`"mountain"` for mines, `"water"` for fisheries). */
        mineTerrain?: "mountain" | "water";
        /** Y-offset inside `[0, depth]` for the resource badge in toolbar icons. */
        labelY?: number;
        /** Default height used by the fallback box extrusion when `getExtrusions` is omitted. Defaults to `35`. */
        extrusionHeight?: number;
        /** Returns procedural 2.5D polygon extrusions for world rendering, drop shadows, and toolbar SVG previews. */
        getExtrusions?: (width: number, depth: number, building: TrafficityCustomBuilding) => Array<{
            points: Array<{ x: number; y: number; height: number; nextEdgeOffsetOverride?: number }>;
            roofDarkness: number;
            colorIndex?: number;
            roofDirectionOverride?: number;
            skipRoofOutline?: boolean;
        }>;
        /** Owned vehicles spawned by this building (`{ cars }`, `{ trucks }`, or `{ vans }`). */
        vehicles?: { cars: number } | { trucks: Record<string, number> } | { vans: Record<string, number> } | null;
        /** Whether this building tracks visitor arrivals for satisfaction. Defaults to `false` for `"residential"`, `true` otherwise. */
        needsVisited?: boolean;
        /** Weight used in city-wide building satisfaction calculations. Defaults to `20` for `"industrial"`, `15` otherwise. */
        satisfactionWeight?: number;
        /** Initial toolbar placement quota granted automatically when a world loads (`> 0`). Defaults to `0`. */
        defaultQuota?: number;
        /** Called after buildings of this type are placed or restored via undo. */
        onPlace?: (gameState: TrafficityGameState, buildingRecord: TrafficityBuildingRecord, context: { placementDeps: Record<string, unknown> }, building: TrafficityCustomBuilding) => void;
        /** Called after a building of this type is demolished. */
        onDelete?: (gameState: TrafficityGameState, buildingRecord: TrafficityBuildingRecord, building: TrafficityCustomBuilding) => void;
        /** Called when the player clicks/selects a placed building of this type. */
        onSelect?: (gameState: TrafficityGameState, buildingRecord: TrafficityBuildingRecord, building: TrafficityCustomBuilding) => void;
        /** Called when PixiJS graphics parts are created or updated (draft preview, world load, hover, view mode). */
        onRenderWorld?: (
            parts: TrafficityBuildingGraphicsParts,
            buildingRecord: TrafficityBuildingRecord,
            gameState: TrafficityGameState,
            pixi: { Container?: unknown; Graphics?: unknown; Sprite?: unknown; Texture?: unknown; CanvasSource?: unknown },
            building: TrafficityCustomBuilding,
        ) => void;
    }

    /** Registered custom building instance. */
    interface TrafficityCustomBuilding {
        /** Unique building type slug. */
        readonly type: string;
        /** Fallback display name. */
        readonly name: string;
        /** Simulation category. */
        readonly buildingCategory: "residential" | "commercial" | "office" | "industrial";
        /** Plot frontage width in world units. */
        readonly width: number;
        /** Plot depth in world units. */
        readonly depth: number;
        /** Initial toolbar placement quota granted when a world loads. */
        defaultQuota: number;
        /** Returns a JSON-serializable definition suitable for isolated Web Workers. */
        toWorkerSafeDefinition(): Record<string, unknown>;
        /** Returns the full main-thread `BUILDING_DEFINITIONS` entry including `getExtrusions`. */
        toMainDefinition(): Record<string, unknown>;
        /** Resolves the display name for `lang`, falling back to `"en"` and `name`. */
        getDisplayName(lang?: string): string;
        /** Returns the total number of resident cars, trucks, or vans owned by this building. */
        getTotalVehicleCount(): number;
    }

    /** Custom building registry exposed at `TrafficityMods.buildings`. */
    interface TrafficityBuildingsApi {
        /** Validated `CustomBuilding` class constructor. */
        CustomBuilding: new (config: TrafficityCustomBuildingConfig) => TrafficityCustomBuilding;
        /** Validates and registers a custom building into main-thread modules and simulation Web Workers. */
        register(configOrInstance: TrafficityCustomBuildingConfig | TrafficityCustomBuilding): TrafficityCustomBuilding;
        /** Retrieves a registered custom building by `type`, or `null` if not found. */
        get(type: string): TrafficityCustomBuilding | null;
        /** Returns all currently registered custom buildings. */
        list(): TrafficityCustomBuilding[];
    }

    /** Structured metric row rendered inside `BuildingViewPanel` via `game.addBuildingViewPanelSection()`. */
    interface TrafficityBuildingViewPanelRow {
        /** Metric label (left column). */
        label: string;
        /** Formatted primary value (e.g. `"72.9%"`). */
        value: string;
        /** Optional secondary target/hint text (e.g. `"→ 76.3%"`). */
        target?: string;
        /** Optional velocity/delta text (e.g. `"+0.3%/s"`). */
        delta?: string;
        /** Optional normalized `0..1` bar fill fraction. */
        progress?: number;
        /** Optional CSS accent color for value/bar/delta. */
        color?: string;
    }

    /** Section item accepted by `game.addBuildingViewPanelSection()`. */
    interface TrafficityBuildingViewPanelSection {
        /** Optional section header title. */
        title?: string;
        /** Plain text line (when not using `rows`). */
        text?: string;
        /** Structured telemetry rows with optional progress bars and targets. */
        rows?: TrafficityBuildingViewPanelRow[];
        /** Optional container CSS style overrides. */
        style?: Record<string, string>;
    }

    /** Single happiness factor snapshot (`current`, `target`, `velocity` in `0..1`). */
    interface TrafficityHappinessFactor {
        current: number;
        target: number;
        velocity: number;
    }

    /** Live satisfaction & factor breakdown returned by `game.getBuildingSatisfaction()`. */
    interface TrafficityBuildingSatisfactionReport {
        /** Overall building satisfaction (`0..1`), or `null` if unavailable. */
        overall: number | null;
        /** Individual happiness factor readings keyed by factor name. */
        factors: Record<string, TrafficityHappinessFactor>;
    }

    /** Primary mod loader API exposed on `window.TrafficityMods`. */
    interface TrafficityModsApi {
        /** Mod loader API version string. */
        readonly version: string;

        /** High-level game interaction facade. */
        readonly game: TrafficityGameFacade;

        /** Custom building registration API (main thread + simulation workers). */
        readonly buildings: TrafficityBuildingsApi;

        /** Merge additional helper methods onto `TrafficityMods.game` at runtime. */
        extendGame<T extends Record<string, unknown>>(methods: T): TrafficityGameFacade & T;

        /** Return a shallow copy of the loaded mod catalog. */
        getMods(): TrafficityCatalogMod[];

        /** Return the resolved path to the active mods directory. */
        getModsDir(): string;

        /** Register a named service for other mods to consume via `use()`. */
        provide<K extends keyof TrafficityServices>(name: K, serviceApi: TrafficityServices[K]): void;
        provide(name: string, serviceApi: unknown): void;

        /** Retrieve a service previously registered via `provide()`, or `null` if unavailable. */
        use<K extends keyof TrafficityServices>(name: K): TrafficityServices[K] | null;
        use<T = unknown>(name: string): T | null;

        /**
         * Bind a capture-phase keyboard shortcut (e.g. `"Alt+1"`, `"Shift+Delete"`, `"q"`).
         * Return `false` from `handler` to let the event pass through to Trafficity.
         * Returns an unsubscribe function.
         */
        bindKey(combo: string, handler: (event: KeyboardEvent) => boolean | void): () => void;

        /** Dispatch a synthetic `keydown` event on `window` without re-triggering `bindKey` handlers. */
        sendSyntheticKey(
            code: string,
            key?: string,
            keyCode?: number,
            modifiers?: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean },
        ): void;

        /** Register a capture-phase window wheel listener (ignores synthetic events). Returns an unsubscribe function. */
        onMouse(
            type: "wheel",
            handler: (event: WheelEvent) => void,
            options?: boolean | AddEventListenerOptions,
        ): () => void;
        /** Register a capture-phase window mouse/contextmenu listener (ignores synthetic events). Returns an unsubscribe function. */
        onMouse(
            type: "mousedown" | "mousemove" | "mouseup" | "click" | "dblclick" | "contextmenu",
            handler: (event: MouseEvent) => void,
            options?: boolean | AddEventListenerOptions,
        ): () => void;
        /** Register a capture-phase window pointer/mouse/wheel listener (ignores synthetic events). Returns an unsubscribe function. */
        onMouse(
            type: string,
            handler: (event: MouseEvent | WheelEvent) => void,
            options?: boolean | AddEventListenerOptions,
        ): () => void;

        /** Read persisted JSON/`settings.toml` configuration for `modId`, merged over optional `defaults`. */
        getConfig<T extends Record<string, unknown> = Record<string, unknown>>(modId: string, defaults?: Partial<T>): T;

        /** Helper for `export default TrafficityMods.defineMod((modApi, game) => { ... })`. */
        defineMod(setupMod: (modApi: TrafficityModsApi, game: TrafficityGameFacade) => void | Promise<void>): (modApi: TrafficityModsApi, game: TrafficityGameFacade) => void | Promise<void>;

        /** Persist JSON configuration for `modId` to `mods-config.json`. */
        setConfig(modId: string, config: Record<string, unknown>): Promise<void>;

        /** Mount or update an isolated HUD/overlay container (`#tmod-overlay-<id>`) that blocks click/wheel bleed into the canvas. Returns the host element when mounted synchronously, or `null` if deferred until `DOMContentLoaded`. */
        addOverlay(id: string, content: string | Node): HTMLDivElement | null;
    }

    interface Window {
        TrafficityMods?: TrafficityModsApi;
        trafficityDesktop?: {
            openModsFolder?: () => Promise<{ ok?: boolean; wine?: boolean; hostPath?: string; modsDir?: string; error?: string }>;
            reloadGame?: () => void;
            copyText?: (text: string) => Promise<void>;
            [key: string]: unknown;
        };
    }
}
