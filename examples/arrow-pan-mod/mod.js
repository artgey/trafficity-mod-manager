// Example scripted control mod using the TrafficityMods.game facade.
const mods = window.TrafficityMods;

if (mods && mods.game) {
    mods.bindKey("Space", () => {
        mods.game.cancel();
    });

    console.log("[arrow-pan-mod] Loaded control bindings.");
}
