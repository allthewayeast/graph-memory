import { describe, expect, it } from "vitest";
import { assertV4RowAdmission } from "@deepseek-ai/dsh-session-format-v3-to-v4";
import { dshMemorySource, isDshMemorySource } from "../src/format/dsh-source.ts";

describe("DSH durable producer attribution", () => {
  it("uses the host V4 validator to reproduce and reject the retired source", () => {
    const row = {
      type: "user/message", seq: 1, time: Date.now(), surfaceOp: "append",
      data: { id: "memory", role: "user", content: [{ type: "text", text: "memory" }],
        source: { kind: "plugin", plugin: "graph-memory" } },
    };
    expect(() => assertV4RowAdmission(row)).toThrow(/producer-owned source kind/);
    expect(() => assertV4RowAdmission({ ...row, data: { ...row.data, source: dshMemorySource() } })).not.toThrow();
  });

  it("recognizes current and historical memory without claiming other producers", () => {
    expect(isDshMemorySource(dshMemorySource())).toBe(true);
    expect(isDshMemorySource({ kind: "plugin", plugin: "graph-memory" })).toBe(true);
    expect(isDshMemorySource({ kind: "plugin", plugin: "other" })).toBe(false);
    expect(isDshMemorySource({ kind: "plugin:other" })).toBe(false);
    expect(isDshMemorySource(undefined)).toBe(false);
  });
});
