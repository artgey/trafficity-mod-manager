export {};

declare global {
    interface TrafficityGameFacade {
        /** Attach or update a numbered corner badge (`.tmod-slot-badge`) on a toolbelt slot button. */
        addSlotBadge(slotBtn: Element, label: string | number): void;
    }
}
