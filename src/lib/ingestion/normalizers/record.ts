export type RecordData = Record<string, unknown>;
export const SYNTHETIC_DATASET = "business-analyst-synthetic-v1";

export function camelCaseRecord(row: RecordData): RecordData {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]));
}

export function normalize(model: string, row: RecordData, now: Date, organizationId?: string): RecordData {
  const data = { ...camelCaseRecord(row), syntheticDataset: SYNTHETIC_DATASET };
  if (model === "Organization") {
    const { organizationId: id, organizationName: name, ...rest } = data as RecordData;
    return { ...rest, id, name, slug: `synthetic-${id}`, sourceSystem: "synthetic", sourceRecordId: id, sourceUpdatedAt: null, ingestedAt: now, normalizedAt: now };
  }
  if (model === "MetricDefinition") {
    const { metricKey: key, metricName: name, ...rest } = data as RecordData;
    return { ...rest, key, name, organizationId, sourceSystem: "synthetic", sourceRecordId: `${key}:${row.version}`, sourceUpdatedAt: null, ingestedAt: now, normalizedAt: now };
  }
  return data;
}
