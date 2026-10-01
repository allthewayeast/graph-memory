/** Producer identity used by DSH's durable Session V4 messages. */
export const DSH_MEMORY_SOURCE_KIND = "plugin:graph-memory";
export function dshMemorySource() {
    return { kind: DSH_MEMORY_SOURCE_KIND };
}
/** Read both migrated V4 messages and historical V3 attribution. */
export function isDshMemorySource(source) {
    if (!source || typeof source !== "object")
        return false;
    const value = source;
    return value.kind === DSH_MEMORY_SOURCE_KIND
        || value.kind === "plugin" && value.plugin === "graph-memory";
}
