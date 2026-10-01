export interface DshExtractionRoute {
  provider: string;
  model: string;
}

export interface DshModelInfoService {
  resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<{
    reasoning?: { efforts: ReadonlyArray<{ id: string }> };
  }>;
}

/** Provider/configuration failures do not make the durable Q/A invalid. */
export class DshExtractionUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DshExtractionUnavailableError";
  }
}

/** Select only an effort advertised by the exact host route, without inference calls. */
export async function resolveDshExtractionReasoning(
  llm: DshModelInfoService,
  route: DshExtractionRoute,
  requested: string | undefined,
  signal: AbortSignal,
): Promise<string | undefined> {
  // Older hosts cannot advertise capabilities. Inherit their route default
  // unless the user deliberately supplied a control.
  if (!llm.resolveModelInfo) return requested;
  let info;
  try {
    info = await llm.resolveModelInfo(route.provider, route.model, signal);
  } catch (cause) {
    throw new DshExtractionUnavailableError(
      `[graph-memory] cannot resolve extraction route ${route.provider}/${route.model}: ${String(cause)}`,
      { cause },
    );
  }
  const efforts = info.reasoning?.efforts ?? [];
  if (requested !== undefined) {
    if (!efforts.some(effort => effort.id === requested)) {
      throw new DshExtractionUnavailableError(
        `[graph-memory] extraction route ${route.provider}/${route.model} does not support reasoning effort ` +
        `${JSON.stringify(requested)}; supported: ${efforts.map(effort => effort.id).join(", ") || "none (omit llmReasoningEffort)"}`,
      );
    }
    return requested;
  }
  // Effort IDs are owned by the provider, not a plugin-maintained enum.
  // Prefer off when offered, otherwise the adapter's first advertised level.
  return efforts.find(effort => effort.id === "off")?.id ?? efforts[0]?.id;
}
