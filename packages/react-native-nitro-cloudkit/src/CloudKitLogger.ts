/** Attribute values the client logs: operation names, counts, durations, error codes. */
export type CloudKitLogAttributes = Readonly<Record<string, string | number | boolean>>;

/**
 * Where the client reports what it does. Structural, so a `react-native-nitro-loggerkit` logger,
 * `console`, or anything with these methods fits. Record contents, tokens and file paths are never
 * logged.
 */
export interface CloudKitLogger {
  debug?(message: string, attributes?: CloudKitLogAttributes): unknown;
  info?(message: string, attributes?: CloudKitLogAttributes): unknown;
  warn?(message: string, attributes?: CloudKitLogAttributes): unknown;
  error?(message: string, attributes?: CloudKitLogAttributes): unknown;
}
