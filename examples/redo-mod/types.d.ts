export {};

declare global {
    interface TrafficityServices {
        redo: {
            /** Re-apply the most recently undone action. Returns `"redone"` on success or a status reason. */
            redo(): "unavailable" | "busy" | "nothing" | "redone" | "failed";
            /** Whether there is at least one action on the redo stack. */
            canRedo(): boolean;
            /** Clear the redo stack. */
            clear(): void;
        };
    }
}
