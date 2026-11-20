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

    /** Internal undo module handles captured from Trafficity's bundle. */
    interface TrafficityUndoApi {
        undoModule: unknown;
        undoHistory: unknown;
        gameState: unknown;
        undoDeps: unknown;
    }

    /** Internal snap module handle captured from Trafficity's bundle. */
    interface TrafficitySnapApi {
        snapModule: unknown;
    }

    /** High-level lifecycle event handlers supported by `TrafficityMods.game.on()`. */
    interface TrafficityGameEventMap {
        ready: () => void;
        cursorModeChange: (mode: string | null, prevMode: string | null) => void;
        worldChange: (worldRevision: number, prevRevision: number) => void;
        roadPlaced: (info: { entriesCount: number; worldRevision: number | null }) => void;
    }

    /**
     * Extensible game facade exposed at `window.TrafficityMods.game`.
     * Mods calling `extendGame()` can augment this interface in their own `types.d.ts`.
     */
    interface TrafficityGameFacade {
        /** Subscribe to a high-level game lifecycle event. Returns an unsubscribe function. */
        on<K extends keyof TrafficityGameEventMap>(event: K, handler: TrafficityGameEventMap[K]): () => void;
        /** Require an internal webpack/router module by its bundle chunk ID. */
        requireRouterModule<T = unknown>(id: string): T | null;

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

        /** Return `true` when the player is idle (no tool or placement active). */
        isIdle(): boolean;

        /** Dispatch a synthetic mouse event onto the game canvas without re-triggering `mods.onMouse` listeners. */
        sendSyntheticMouse(type: string, init?: MouseEventInit): void;

        /** Dispatch a synthetic wheel event onto the game canvas without re-triggering `mods.onMouse` listeners. */
        sendSyntheticWheel(init?: WheelEventInit): void;

        /** Observe toolbelt DOM updates via `MutationObserver` and invoke `callback` with the current slots. Returns a stop function. */
        watchToolbelt(callback: (slots: HTMLButtonElement[]) => void): () => void;

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

        /** Return the detected Trafficity game release/version string, or `null`. */
        getGameRelease(): string | null;
    }

    /** Configuration for `TrafficityMods.buildings.register()`. */
    interface TrafficityCustomBuildingConfig {
        type: string;
        buildingCategory: "residential" | "commercial" | "office" | "industrial";
        name?: string;
        localizedNames?: Record<string, string>;
        buildingColors?: string[];
        width?: number;
        depth?: number;
        parkingSpaces?: number[];
        garage?: { entrance: number; exit: number; effectiveCapacity: number } | null;
        inputs?: Array<"food" | "copper" | "iron" | "steel" | "cpg">;
        outputs?: Array<"food" | "copper" | "iron" | "steel" | "cpg">;
        vanCapacity?: number;
        truckCapacity?: Partial<Record<"food" | "copper" | "iron" | "steel" | "cpg", number>>;
        pollutionOutput?: "none" | "low" | "medium" | "high";
        pollutionAffectsHappiness?: boolean;
        requiredTerrain?: "water" | "land" | "mountain" | "void" | "sand" | "grass" | "wasteland" | "deepwasteland";
        forbiddenTerrain?: "water" | "land" | "mountain" | "void" | "sand" | "grass" | "wasteland" | "deepwasteland";
        mineTerrain?: "mountain" | "water";
        labelY?: number;
        extrusionHeight?: number;
        getExtrusions?: (width: number, depth: number, building: TrafficityCustomBuilding) => Array<{
            points: Array<{ x: number; y: number; height: number; nextEdgeOffsetOverride?: number }>;
            roofDarkness: number;
            colorIndex?: number;
            roofDirectionOverride?: number;
            skipRoofOutline?: boolean;
        }>;
        vehicles?: { cars: number } | { trucks: Record<string, number> } | { vans: Record<string, number> } | null;
        needsVisited?: boolean;
        satisfactionWeight?: number;
        defaultQuota?: number;
        onPlace?: (gameState: any, buildingRecord: any, context: { placementDeps: any }, building: TrafficityCustomBuilding) => void;
        onDelete?: (gameState: any, buildingRecord: any, building: TrafficityCustomBuilding) => void;
        onSelect?: (gameState: any, buildingRecord: any, building: TrafficityCustomBuilding) => void;
        onRenderWorld?: (parts: { object: any; ground: any; groundSidewalk: any; shadow: any }, buildingRecord: any, gameState: any, pixi: any, building: TrafficityCustomBuilding) => void;
    }

    /** Registered custom building instance. */
    interface TrafficityCustomBuilding {
        readonly type: string;
        readonly name: string;
        readonly buildingCategory: "residential" | "commercial" | "office" | "industrial";
        readonly width: number;
        readonly depth: number;
        defaultQuota: number;
        toWorkerSafeDefinition(): Record<string, unknown>;
        toMainDefinition(): Record<string, unknown>;
        getDisplayName(lang?: string): string;
        getTotalVehicleCount(): number;
    }

    /** Custom building registry exposed at `TrafficityMods.buildings`. */
    interface TrafficityBuildingsApi {
        CustomBuilding: new (config: TrafficityCustomBuildingConfig) => TrafficityCustomBuilding;
        register(configOrInstance: TrafficityCustomBuildingConfig | TrafficityCustomBuilding): TrafficityCustomBuilding;
        get(type: string): TrafficityCustomBuilding | null;
        list(): TrafficityCustomBuilding[];
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
         */
        bindKey(combo: string, handler: (event: KeyboardEvent) => boolean | void): void;

        /** Dispatch a synthetic `keydown` event on `window` without re-triggering `bindKey` handlers. */
        sendSyntheticKey(
            code: string,
            key?: string,
            keyCode?: number,
            modifiers?: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean },
        ): void;

        /** Register a capture-phase window mouse/wheel/contextmenu listener (ignores synthetic events). */
        onMouse(
            type: string,
            handler: (event: MouseEvent | WheelEvent) => void,
            options?: boolean | AddEventListenerOptions,
        ): void;

        /** Read persisted JSON/`settings.toml` configuration for `modId`, merged over optional `defaults`. */
        getConfig<T extends Record<string, unknown> = Record<string, unknown>>(modId: string, defaults?: Partial<T>): T;

        /** Helper for `export default TrafficityMods.defineMod((modApi, game) => { ... })`. */
        defineMod(setupMod: (modApi: TrafficityModsApi, game: TrafficityGameFacade) => void | Promise<void>): (modApi: TrafficityModsApi, game: TrafficityGameFacade) => void | Promise<void>;

        /** Persist JSON configuration for `modId` to `mods-config.json`. */
        setConfig(modId: string, config: Record<string, unknown>): Promise<void>;

        /** Mount or update an isolated HUD/overlay container (`#tmod-overlay-<id>`) that blocks click/wheel bleed into the canvas. */
        addOverlay(id: string, content: string | Node): void;
    }

    interface Window {
        TrafficityMods?: TrafficityModsApi;
    }
}
