/**
 * CustomBuilding & BuildingRegistry — Extendable Prototype (Knowledge Database)
 *
 * Designed against shipped Steam Trafficity (trafficity@1.0.0+34b3cf6d3f).
 * Target runtime: browser window + TrafficityMods API (`runtime/loader.js`).
 *
 * NOTE: This is a documented architectural prototype saved in the temporary KB;
 * it is NOT wired as an active example mod.
 */

export const VALID_CATEGORIES = Object.freeze(["residential", "commercial", "office", "industrial"]);
export const VALID_POLLUTION_OUTPUTS = Object.freeze(["none", "low", "medium", "high"]);
export const VALID_RESOURCES = Object.freeze(["food", "copper", "iron", "steel", "cpg"]);
export const VALID_TERRAINS = Object.freeze([
  "water",
  "land",
  "mountain",
  "void",
  "sand",
  "grass",
  "wasteland",
  "deepwasteland",
]);
export const VALID_MINE_TERRAINS = Object.freeze(["mountain", "water"]);

const DEFAULT_COLOR_BY_CATEGORY = {
  residential: "#78CC51",
  commercial: "#3997e4",
  office: "#9b59d0",
  industrial: "#e8bd2c",
};

const overrideExport = (mod, exportName, value) => {
  Object.defineProperty(mod, exportName, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
};

const simpleBoxExtrusion = (width, depth, colorIndex = 0, height = 35, padding = 4) => [
  {
    points: [
      { x: padding, y: Math.min(20, depth * 0.25), height },
      { x: padding, y: depth - padding, height },
      { x: width - padding, y: depth - padding, height },
      { x: width - padding, y: Math.min(20, depth * 0.25), height },
    ],
    roofDarkness: 0,
    colorIndex,
  },
];

/**
 * Loads a URL/data-URL image into an HTMLImageElement for PixiJS CanvasSource/Sprite creation.
 */
const loadImageElement = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });

/**
 * Declarative definition + extensible hooks for a custom Trafficity building type.
 */
export class CustomBuilding {
  constructor(config) {
    if (!config || typeof config.type !== "string" || !config.type.trim()) {
      throw new Error("CustomBuilding requires a unique non-empty `type` string.");
    }
    if (!VALID_CATEGORIES.includes(config.buildingCategory)) {
      throw new Error(`Invalid buildingCategory "${config.buildingCategory}". Must be one of: ${VALID_CATEGORIES.join(", ")}`);
    }

    const pollutionOutput = config.pollutionOutput ?? "none";
    if (!VALID_POLLUTION_OUTPUTS.includes(pollutionOutput)) {
      throw new Error(`Invalid pollutionOutput "${pollutionOutput}". Must be one of: ${VALID_POLLUTION_OUTPUTS.join(", ")}`);
    }

    const width = Number(config.width ?? 110);
    const depth = Number(config.depth ?? 90);
    if (!(width > 0 && depth > 0)) {
      throw new Error("Building `width` and `depth` must be positive numbers.");
    }

    if (config.requiredTerrain && !VALID_TERRAINS.includes(config.requiredTerrain)) {
      throw new Error(`Invalid requiredTerrain "${config.requiredTerrain}".`);
    }
    if (config.forbiddenTerrain && !VALID_TERRAINS.includes(config.forbiddenTerrain)) {
      throw new Error(`Invalid forbiddenTerrain "${config.forbiddenTerrain}".`);
    }
    if (config.mineTerrain && !VALID_MINE_TERRAINS.includes(config.mineTerrain)) {
      throw new Error(`Invalid mineTerrain "${config.mineTerrain}". Must be "mountain" or "water".`);
    }

    const inputs = [...(config.inputs ?? [])];
    const outputs = [...(config.outputs ?? [])];
    for (const r of [...inputs, ...outputs]) {
      if (!VALID_RESOURCES.includes(r)) {
        throw new Error(`Invalid resource "${r}". Valid resources: ${VALID_RESOURCES.join(", ")}`);
      }
    }

    if (config.garage) {
      if (
        typeof config.garage.entrance !== "number" ||
        typeof config.garage.exit !== "number" ||
        !(config.garage.effectiveCapacity > 0)
      ) {
        throw new Error("`garage` requires numeric `{ entrance, exit, effectiveCapacity > 0 }`.");
      }
    }

    this.type = config.type.trim();
    this.name = config.name ?? this.type;
    this.localizedNames = config.localizedNames ?? null; // { en: "...", es: "..." }
    this.buildingCategory = config.buildingCategory;
    this.buildingColors =
      Array.isArray(config.buildingColors) && config.buildingColors.length > 0
        ? [...config.buildingColors]
        : [DEFAULT_COLOR_BY_CATEGORY[this.buildingCategory]];

    this.width = width;
    this.depth = depth;
    this.pollutionOutput = pollutionOutput;
    this.pollutionAffectsHappiness = Boolean(
      config.pollutionAffectsHappiness ?? this.buildingCategory === "residential",
    );

    // Road access / Parking (garage vs outdoor spaces are mutually exclusive in vanilla)
    this.garage = config.garage ? { ...config.garage } : null;
    this.parkingSpaces = this.garage
      ? []
      : Array.isArray(config.parkingSpaces)
        ? [...config.parkingSpaces]
        : [Math.round(width / 2)];

    this.inputs = inputs;
    this.outputs = outputs;
    this.vanCapacity = typeof config.vanCapacity === "number" ? config.vanCapacity : undefined;
    this.truckCapacity = config.truckCapacity ? { ...config.truckCapacity } : undefined;
    this.requiredTerrain = config.requiredTerrain;
    this.forbiddenTerrain = config.forbiddenTerrain;
    this.mineTerrain = config.mineTerrain;
    this.labelY = config.labelY;

    // Visuals: procedural extrusions and/or injected 2D image URL (e.g., /mods-runtime/mods/<folder>/...)
    this.spriteUrl = config.spriteUrl ?? null;
    this.spritePadding = config.spritePadding ?? 0;
    this.spriteFlipY = Boolean(config.spriteFlipY);
    this._extrusionFactory =
      typeof config.getExtrusions === "function"
        ? config.getExtrusions
        : (w, d) => simpleBoxExtrusion(w, d, 0, config.extrusionHeight ?? 35);

    // Simulation specs
    this.vehicles = config.vehicles ?? null; // { cars: N } | { vans: { [res]: N } } | { trucks: { [res]: N } }
    this.needsVisited =
      typeof config.needsVisited === "boolean"
        ? config.needsVisited
        : this.buildingCategory !== "residential";
    this.satisfactionWeight =
      typeof config.satisfactionWeight === "number"
        ? config.satisfactionWeight
        : this.buildingCategory === "industrial"
          ? 20
          : 15;
    this.defaultQuota = typeof config.defaultQuota === "number" ? config.defaultQuota : 0;

    // Extensible lifecycle hooks (override in subclasses or pass via config)
    this._hooks = {
      onPlace: config.onPlace ?? null,
      onDelete: config.onDelete ?? null,
      onSelect: config.onSelect ?? null,
      onRenderWorld: config.onRenderWorld ?? null,
    };

    this._cachedSpriteCanvas = null;
    this._spriteLoadPromise = null;
  }

  /**
   * Produces the plain JSON-serializable definition entry compatible with both
   * main-thread `BUILDING_DEFINITIONS` and isolated Web Workers.
   */
  toWorkerSafeDefinition() {
    const def = {
      type: this.type,
      buildingCategory: this.buildingCategory,
      buildingColors: [...this.buildingColors],
      pollutionOutput: this.pollutionOutput,
      width: this.width,
      depth: this.depth,
      parkingSpaces: [...this.parkingSpaces],
      inputs: [...this.inputs],
      outputs: [...this.outputs],
    };
    if (this.pollutionAffectsHappiness) def.pollutionAffectsHappiness = true;
    if (this.garage) {
      def.parkingGarageEntrance = this.garage.entrance;
      def.parkingGarageExit = this.garage.exit;
      def.parkingGarageEffectiveCapacity = this.garage.effectiveCapacity;
    }
    if (this.vanCapacity !== undefined) def.vanCapacity = this.vanCapacity;
    if (this.truckCapacity !== undefined) def.truckCapacity = { ...this.truckCapacity };
    if (this.requiredTerrain !== undefined) def.requiredTerrain = this.requiredTerrain;
    if (this.forbiddenTerrain !== undefined) def.forbiddenTerrain = this.forbiddenTerrain;
    if (this.mineTerrain !== undefined) def.mineTerrain = this.mineTerrain;
    if (this.labelY !== undefined) def.labelY = this.labelY;
    return def;
  }

  /**
   * Returns the full main-thread BUILDING_DEFINITIONS entry including getExtrusions().
   */
  toMainDefinition() {
    return {
      ...this.toWorkerSafeDefinition(),
      getExtrusions: (w, d) => this._extrusionFactory(w, d, this),
    };
  }

  getDisplayName(lang = "en") {
    if (this.localizedNames) {
      return this.localizedNames[lang] ?? this.localizedNames.en ?? this.name;
    }
    return this.name;
  }

  getTotalVehicleCount() {
    if (!this.vehicles) return 0;
    if ("cars" in this.vehicles) return this.vehicles.cars || 0;
    let total = 0;
    if (this.vehicles.trucks) {
      for (const n of Object.values(this.vehicles.trucks)) total += n;
    }
    if (this.vehicles.vans) {
      for (const n of Object.values(this.vehicles.vans)) total += n;
    }
    return total;
  }

  /** Preloads sprite image into an offscreen HTMLCanvasElement for PixiJS v8 Texture/Sprite. */
  ensureSpriteCanvas() {
    if (!this.spriteUrl) return Promise.resolve(null);
    if (this._cachedSpriteCanvas) return Promise.resolve(this._cachedSpriteCanvas);
    if (!this._spriteLoadPromise) {
      this._spriteLoadPromise = loadImageElement(this.spriteUrl).then((img) => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width || 128;
        canvas.height = img.naturalHeight || img.height || 128;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        this._cachedSpriteCanvas = canvas;
        return canvas;
      });
    }
    return this._spriteLoadPromise;
  }

  // Overridable subclass hooks (or delegated from config._hooks)
  onPlace(gameState, buildingRecord, context) {
    this._hooks.onPlace?.(gameState, buildingRecord, context, this);
  }
  onDelete(gameState, buildingRecord) {
    this._hooks.onDelete?.(gameState, buildingRecord, this);
  }
  onSelect(gameState, buildingRecord) {
    this._hooks.onSelect?.(gameState, buildingRecord, this);
  }
  onRenderWorld(parts, buildingRecord, gameState, pixi) {
    this._hooks.onRenderWorld?.(parts, buildingRecord, gameState, pixi, this);
  }
}

/**
 * Coordinates registration of one or more CustomBuilding instances across:
 * 1) Main-thread Parcel modules (`4nkf2`, `aUbb1`, `fFJcz`, `jnB0a`, `2cbpn`, `6whda`, `gh1Od`, `XfMqf`, `iPOHp`)
 * 2) Isolated Web Workers (`car-worker`, `happiness-worker`, `pathfinding-worker`) via window.Worker wrapping
 * 3) Placement quotas (`cumulativeBuildingCount`) & selection hooks
 */
export class BuildingRegistry {
  constructor() {
    /** @type {Map<string, CustomBuilding>} */
    this.buildings = new Map();
    this._mainPatched = false;
    this._workerHookInstalled = false;
    this._lastSelectedBuildingId = null;
  }

  register(building) {
    if (!(building instanceof CustomBuilding)) {
      building = new CustomBuilding(building);
    }
    this.buildings.set(building.type, building);
    if (building.spriteUrl) {
      building.ensureSpriteCanvas().catch((err) => {
        console.warn(`[BuildingRegistry] Failed to preload sprite for ${building.type}:`, err);
      });
    }
    if (this._mainPatched && this._defsMod) {
      this._upsertMainDefinition(building);
    }
    return building;
  }

  /**
   * Must be installed before the user starts/loads a city (so worker creation passes through it).
   * Wraps `window.Worker` to splice custom definitions into classic bundled Trafficity workers.
   */
  installWorkerHook() {
    if (this._workerHookInstalled || typeof window === "undefined" || typeof window.Worker !== "function") {
      return;
    }
    this._workerHookInstalled = true;
    const NativeWorker = window.Worker;
    const registry = this;

    window.Worker = function PatchedTrafficityWorker(scriptURL, options) {
      const urlStr = String(scriptURL);
      const isGameWorker =
        !options?.type &&
        (urlStr.includes("car-worker") ||
          urlStr.includes("happiness-worker") ||
          urlStr.includes("pathfinding-worker"));

      if (!isGameWorker || registry.buildings.size === 0) {
        return new NativeWorker(scriptURL, options);
      }

      try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", urlStr, false);
        xhr.send(null);
        if (xhr.status >= 200 && xhr.status < 300) {
          const payload = [];
          for (const b of registry.buildings.values()) {
            payload.push({
              def: b.toWorkerSafeDefinition(),
              vehicles: b.vehicles,
              needsVisited: b.needsVisited,
            });
          }
          const patchedSource = BuildingRegistry._injectIntoWorkerSource(xhr.responseText, payload);
          const blobUrl = URL.createObjectURL(new Blob([patchedSource], { type: "application/javascript" }));
          return new NativeWorker(blobUrl, options);
        }
      } catch (err) {
        console.warn("[BuildingRegistry] Worker patch fallback triggered:", err);
      }

      return new NativeWorker(scriptURL, options);
    };
    window.Worker.prototype = NativeWorker.prototype;
  }

  /**
   * Injects custom building definitions right before the worker's final bootstrap `l("fHJ87")` call,
   * using Parcel's internal `l` require and `Object.defineProperty` (matching Router patching).
   */
  static _injectIntoWorkerSource(source, entries) {
    const bootAnchor = ',l("fHJ87")';
    const idx = source.lastIndexOf(bootAnchor);
    if (idx === -1) {
      return source;
    }

    const injection = `,(() => {
      const __customEntries = ${JSON.stringify(entries)};
      const __byType = new Map(__customEntries.map((x) => [x.def.type, x]));
      const __override = (mod, k, v) => Object.defineProperty(mod, k, { value: v, writable: true, configurable: true, enumerable: true });

      const defMod = l("aS4Aq");
      const origGetDef = defMod.getBuildingDefinition;
      __override(defMod, "getBuildingDefinition", (type) => {
        const hit = __byType.get(type);
        return hit ? hit.def : origGetDef(type);
      });

      try {
        const visitedMod = l("6hect");
        const origVisited = visitedMod.buildingHasGetVisitedNeed;
        __override(visitedMod, "buildingHasGetVisitedNeed", (type) => {
          const hit = __byType.get(type);
          return hit ? Boolean(hit.needsVisited) : origVisited(type);
        });
      } catch {}

      try {
        const carMod = l("3baQI");
        if (carMod && typeof carMod.getBuildingCarCountSpec === "function") {
          const origSpec = carMod.getBuildingCarCountSpec;
          const origRes = carMod.getResidentCarCountForResidentialBuildingType;
          const origTotal = carMod.getTotalVehicleCountForBuildingType;
          __override(carMod, "getBuildingCarCountSpec", (type) => {
            const hit = __byType.get(type);
            return hit ? hit.vehicles : origSpec(type);
          });
          __override(carMod, "getResidentCarCountForResidentialBuildingType", (type) => {
            const hit = __byType.get(type);
            if (!hit) return origRes(type);
            return hit.vehicles && "cars" in hit.vehicles ? hit.vehicles.cars : 0;
          });
          __override(carMod, "getTotalVehicleCountForBuildingType", (type) => {
            const hit = __byType.get(type);
            if (!hit) return origTotal(type);
            const v = hit.vehicles;
            if (!v) return 0;
            if ("cars" in v) return v.cars || 0;
            let n = 0;
            for (const o of [v.trucks, v.vans]) if (o) for (const c of Object.values(o)) n += c;
            return n;
          });
        }
      } catch {}
    })()`;

    return source.slice(0, idx) + injection + source.slice(idx);
  }

  /**
   * Connects this registry into live main-thread Trafficity Parcel modules.
   * Call during `game.on("ready", ...)` (or inside `export default function (mods, game)`).
   */
  attach(mods, game) {
    this.installWorkerHook();
    if (this._mainPatched) return;
    this._mainPatched = true;

    const req = (id) => game.requireRouterModule(id);

    this._defsMod = req("4nkf2");
    this._displayMod = req("aUbb1");
    this._i18nMod = req("9nNmt");
    this._carSpecMod = req("fFJcz");
    this._visitedMod = req("jnB0a");
    this._satWeightMod = req("2cbpn");
    this._placementMod = req("6whda");
    this._deletionMod = req("gh1Od");
    this._graphicsMod = req("XfMqf");
    this._previewMod = req("iPOHp");
    this._pixiMod = {
      Sprite: req("4rhnu").Sprite,
      Texture: req("bLlTJ").Texture,
      CanvasSource: req("8xl7d").CanvasSource,
    };

    for (const b of this.buildings.values()) {
      this._upsertMainDefinition(b);
    }

    this._patchDefinitionLookups();
    this._patchLocalization();
    this._patchSimulationTables();
    this._patchPlacementAndDeletion();
    this._patchRendering();
    this._patchPreviewUi(mods, game);
    this._bindWorldEvents(game);
  }

  _upsertMainDefinition(custom) {
    const arr = this._defsMod.BUILDING_DEFINITIONS;
    const def = custom.toMainDefinition();
    const existingIdx = arr.findIndex((d) => d.type === custom.type);
    if (existingIdx !== -1) arr[existingIdx] = def;
    else arr.push(def);
  }

  _patchDefinitionLookups() {
    const origGetDef = this._defsMod.getBuildingDefinition;
    const origGetColor = this._defsMod.getBuildingDefaultColor;

    overrideExport(this._defsMod, "getBuildingDefinition", (type) => {
      const custom = this.buildings.get(type);
      return custom ? custom.toMainDefinition() : origGetDef(type);
    });
    overrideExport(this._defsMod, "getBuildingDefaultColor", (type) => {
      const custom = this.buildings.get(type);
      return custom ? custom.buildingColors[0] : origGetColor(type);
    });
  }

  _patchLocalization() {
    const origName = this._displayMod.buildingDisplayName;
    overrideExport(this._displayMod, "buildingDisplayName", (type) => {
      const custom = this.buildings.get(type);
      if (!custom) return origName(type);
      const lang = typeof this._i18nMod?.getLocalisationLanguage === "function"
        ? this._i18nMod.getLocalisationLanguage()
        : "en";
      return custom.getDisplayName(lang);
    });
  }

  _patchSimulationTables() {
    const origSpec = this._carSpecMod.getBuildingCarCountSpec;
    const origRes = this._carSpecMod.getResidentCarCountForResidentialBuildingType;
    const origTotal = this._carSpecMod.getTotalVehicleCountForBuildingType;

    overrideExport(this._carSpecMod, "getBuildingCarCountSpec", (type) => {
      const custom = this.buildings.get(type);
      return custom ? custom.vehicles : origSpec(type);
    });
    overrideExport(this._carSpecMod, "getResidentCarCountForResidentialBuildingType", (type) => {
      const custom = this.buildings.get(type);
      if (!custom) return origRes(type);
      return custom.vehicles && "cars" in custom.vehicles ? custom.vehicles.cars : 0;
    });
    overrideExport(this._carSpecMod, "getTotalVehicleCountForBuildingType", (type) => {
      const custom = this.buildings.get(type);
      return custom ? custom.getTotalVehicleCount() : origTotal(type);
    });

    const origVisited = this._visitedMod.buildingHasGetVisitedNeed;
    overrideExport(this._visitedMod, "buildingHasGetVisitedNeed", (type) => {
      const custom = this.buildings.get(type);
      return custom ? custom.needsVisited : origVisited(type);
    });

    const origSatWeight = this._satWeightMod.getSatisfactionWeightForBuildingType;
    overrideExport(this._satWeightMod, "getSatisfactionWeightForBuildingType", (type) => {
      const custom = this.buildings.get(type);
      return custom ? custom.satisfactionWeight : origSatWeight(type);
    });
  }

  _patchPlacementAndDeletion() {
    const origPlaceFromFootprints = this._placementMod.placeBuildingsFromFootprints;
    const origRestoreAtFootprints = this._placementMod.restoreBuildingsAtFootprints;
    const origDelete = this._deletionMod.deleteBuildingsFromGameState;

    const finalizePlacedCustomBuildings = (gameState, previousIds, placementDeps) => {
      for (const [id, record] of Object.entries(gameState.saveState.buildings)) {
        if (previousIds.has(id)) continue;
        const custom = this.buildings.get(record.type);
        if (!custom) continue;

        // Vanilla 6whda only spawns residential cars for literal "small-/medium-/large-residential"
        const spec = custom.vehicles;
        if (custom.buildingCategory === "residential" && spec && "cars" in spec && spec.cars > 0) {
          if (custom.garage) {
            for (let idx = 0; idx < spec.cars; idx++) {
              const residentId = gameState.saveState.parallelResidentMetadata.allocateResidentId();
              gameState.saveState.residents[residentId] = { residentId, homeBuildingId: record.id, awaitsFirstTrip: true };
              placementDeps.createResidentCarInWorker?.(
                residentId,
                Math.floor(Math.random() * 6),
                { maxSpeed: 100 },
                record.id,
                null,
                gameState,
                record.id,
                [{ type: "rest at home", timeRemainingIfKnown: 2 + idx * 0.5 }],
              );
            }
          } else {
            for (let i = 0; i < Math.min(spec.cars, custom.parkingSpaces.length); i++) {
              placementDeps.spawnOutdoorResidentialCar?.(record.id, record.type, record.footprint, i, gameState);
            }
          }
        }

        custom.onPlace(gameState, record, { placementDeps });
      }
    };

    overrideExport(this._placementMod, "placeBuildingsFromFootprints", (gameState, typeName, footprints, placementDeps, playSfx) => {
      const prevIds = new Set(Object.keys(gameState.saveState.buildings));
      const res = origPlaceFromFootprints(gameState, typeName, footprints, placementDeps, playSfx);
      finalizePlacedCustomBuildings(gameState, prevIds, placementDeps);
      return res;
    });

    overrideExport(this._placementMod, "restoreBuildingsAtFootprints", (gameState, items, placementDeps) => {
      const prevIds = new Set(Object.keys(gameState.saveState.buildings));
      const res = origRestoreAtFootprints(gameState, items, placementDeps);
      finalizePlacedCustomBuildings(gameState, prevIds, placementDeps);
      return res;
    });

    overrideExport(this._deletionMod, "deleteBuildingsFromGameState", (gameState, buildingIds) => {
      const deleting = [];
      for (const id of buildingIds) {
        const rec = gameState.saveState.buildings[id];
        const custom = rec ? this.buildings.get(rec.type) : null;
        if (rec && custom) deleting.push([rec, custom]);
      }
      const res = origDelete(gameState, buildingIds);
      for (const [rec, custom] of deleting) {
        custom.onDelete(gameState, rec);
      }
      return res;
    });
  }

  _patchRendering() {
    const origCreateParts = this._graphicsMod.createBuildingGraphicsParts;
    const origUpdate = this._graphicsMod.updateBuildingGraphics;

    const attachCustomWorldVisuals = (parts, gameState, building) => {
      const custom = this.buildings.get(building.type);
      if (!custom) return parts;

      if (custom.spriteUrl) {
        const applySprite = (canvas) => {
          if (!canvas || parts.object.destroyed) return;
          parts.object.removeChildren().forEach((c) => c.destroy?.());

          const source = new this._pixiMod.CanvasSource({ resource: canvas });
          const texture = new this._pixiMod.Texture({ source });
          const sprite = new this._pixiMod.Sprite({ texture });
          const pad = custom.spritePadding;
          sprite.anchor.set(0.5);
          sprite.position.set(building.footprint.centerX, building.footprint.centerY);
          sprite.width = Math.max(1, building.footprint.width - pad * 2);
          sprite.height = Math.max(1, building.footprint.depth - pad * 2);
          sprite.rotation = building.footprint.rotation + Math.PI;
          if (custom.spriteFlipY) sprite.scale.y *= -1;
          parts.object.addChild(sprite);
        };

        if (custom._cachedSpriteCanvas) {
          applySprite(custom._cachedSpriteCanvas);
        } else {
          custom.ensureSpriteCanvas().then(applySprite).catch(() => {});
        }
      }

      custom.onRenderWorld(parts, building, gameState, this._pixiMod);
      return parts;
    };

    overrideExport(this._graphicsMod, "createBuildingGraphicsParts", (gameState, building, opts) => {
      const parts = origCreateParts(gameState, building, opts);
      return attachCustomWorldVisuals(parts, gameState, building);
    });

    // Note: updateBuildingGraphics in XfMqf calls local createBuildingGraphicsParts directly,
    // so we also enhance the mounted object container after origUpdate runs.
    overrideExport(this._graphicsMod, "updateBuildingGraphics", (gameState, building, opts) => {
      origUpdate(gameState, building, opts);
      const custom = this.buildings.get(building.type);
      if (!custom) return;
      const obj = gameState.buildingGraphics.object.get(building.id);
      if (obj) {
        attachCustomWorldVisuals(
          {
            object: obj,
            ground: gameState.buildingGraphics.ground.get(building.id),
            groundSidewalk: gameState.buildingGraphics.groundSidewalk.get(building.id),
            shadow: gameState.buildingGraphics.shadow.get(building.id),
          },
          gameState,
          building,
        );
      }
    });
  }

  _patchPreviewUi(_mods, game) {
    const jsxMod = game.requireRouterModule("ayMG0");
    const origPreview = this._previewMod.BuildingPreview;
    if (!origPreview || !origPreview.type || !jsxMod?.jsx) return;

    const origInner = origPreview.type;
    const registry = this;
    origPreview.type = function PatchedBuildingPreview(props) {
      const custom = registry.buildings.get(props.buildingType);
      if (custom && custom.spriteUrl) {
        return jsxMod.jsx("img", {
          className: "building-count-preview",
          src: custom.spriteUrl,
          width: props.width,
          height: props.height,
          alt: custom.name,
          draggable: false,
          style: { objectFit: "contain" },
        });
      }
      return origInner(props);
    };
  }

  _bindWorldEvents(game) {
    const reqStateCheck = () => {
      const st = globalThis.__trafficityGameState;
      if (!st || !st.worldSelection) return;
      const selId = st.worldSelection.type === "building" ? st.worldSelection.buildingId : null;
      if (selId !== this._lastSelectedBuildingId) {
        this._lastSelectedBuildingId = selId;
        if (selId !== null) {
          const rec = st.saveState?.buildings?.[selId];
          const custom = rec ? this.buildings.get(rec.type) : null;
          custom?.onSelect(st, rec);
        }
      }
    };

    window.addEventListener("click", () => queueMicrotask(reqStateCheck), true);

    game.on("worldChange", () => {
      const st = globalThis.__trafficityGameState;
      if (!st?.saveState?.cumulativeBuildingCount) return;
      let granted = false;
      for (const custom of this.buildings.values()) {
        if (custom.defaultQuota > 0 && st.saveState.cumulativeBuildingCount[custom.type] === undefined) {
          st.saveState.cumulativeBuildingCount[custom.type] = custom.defaultQuota;
          granted = true;
        }
      }
      if (granted) st.requestUiRefresh?.();
    });
  }
}
