// Stable error codes are safe for sync history. Never persist provider bodies,
// request headers, credentials, or complete customer records in error reports.
export class SyncError extends Error {
  constructor(public code: string, public retryable = false) { super(code); }
}
