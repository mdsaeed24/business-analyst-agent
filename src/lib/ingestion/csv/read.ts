import { parse } from "csv-parse/sync";

export type CsvRow = { row: number; data: Record<string, string>; error?: string };
export type CsvFile = { rows: CsvRow[]; errors: { row: number; message: string }[] };

export function readCsv(content: string, expectedHeaders: string[]): CsvFile {
  // Unequal field counts can be recovered. Broken quoting makes record boundaries
  // ambiguous, so reject that file, report its location, and continue other files.
  let records: { record: string[]; info: { lines: number; error?: Error } }[];
  try {
    records = parse(content, { bom: true, info: true, record_delimiter: ["\r\n", "\n", "\r"], relax_column_count: true, skip_empty_lines: true }) as unknown as typeof records;
  } catch (error) {
    const e = error as { lines?: number; code?: string };
    return { rows: [], errors: [{ row: e.lines ?? 1, message: `CSV syntax error (${e.code ?? "parse failed"})` }] };
  }
  const headers = records.shift()?.record ?? [];
  if (headers.length !== expectedHeaders.length || new Set(headers).size !== headers.length || expectedHeaders.some((header) => !headers.includes(header))) {
    return { rows: [], errors: [{ row: 1, message: `Header mismatch. Expected: ${expectedHeaders.join(", ")}; received: ${headers.join(", ")}` }] };
  }
  return {
    errors: [],
    rows: records.map(({ record, info }) => ({
      // Physical ending line is unambiguous even for quoted multiline fields.
      row: info.lines,
      data: Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])),
      ...(record.length !== headers.length ? { error: `Expected ${headers.length} columns, received ${record.length}` } : {}),
    })),
  };
}
