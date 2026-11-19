export {};

declare global {
    interface TrafficityServices {
        redo: {
            /** Re-apply the most recently undone action. Returns true if an entry was redone. */
            redo(): boolean;
            /** Whether there is at least one action on the redo stack. */
            canRedo(): boolean;
            /** Clear the redo stack. */
            clear(): void;
        };
    }
}
