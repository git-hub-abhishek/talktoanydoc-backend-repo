/**
 * Structured JSON logger for all Lambda functions.
 *
 * Every log entry includes level, message, timestamp, and the current Lambda
 * requestId so entries from a single invocation can be correlated in CloudWatch.
 * Call setRequestId() at the top of each handler with context.awsRequestId.
 */

let _requestId: string | undefined;

/** Store the Lambda requestId for the current invocation. */
export function setRequestId(id: string) {
  _requestId = id;
}

/**
 * Serialise a meta value to a plain object suitable for JSON.stringify.
 * Errors are expanded into { name, message, stack } so the stack trace
 * is not lost — by default JSON.stringify(error) produces "{}".
 */
function serialise(meta: unknown): unknown {
  if (meta instanceof Error) {
    return { name: meta.name, message: meta.message, stack: meta.stack, ...(meta as any) };
  }
  return meta;
}

function entry(level: string, message: string, meta?: unknown) {
  return JSON.stringify({
    level,
    message,
    requestId: _requestId,
    timestamp: new Date().toISOString(),
    ...(meta !== undefined ? { meta: serialise(meta) } : {})
  });
}

export const logger = {
  info:  (message: string, meta?: unknown) => console.log(entry('INFO', message, meta)),
  warn:  (message: string, meta?: unknown) => console.warn(entry('WARN', message, meta)),
  error: (message: string, meta?: unknown) => console.error(entry('ERROR', message, meta)),
};
