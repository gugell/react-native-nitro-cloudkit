import Foundation

/// A coded failure. Bridges turn it into a JavaScript `Error` whose message is `description`
/// (Nitro does so for thrown Swift errors), so the code travels in a fixed prefix the TypeScript
/// layer parses: `[nitro-cloudkit:<code>;retryAfter=<s>] message`.
struct CloudKitFailure: Error, CustomStringConvertible {
  enum Code: String {
    case unsupportedPlatform = "unsupported_platform"
    case unsupportedOS = "unsupported_os"
    case notAuthenticated = "not_authenticated"
    case accountTemporarilyUnavailable = "account_temporarily_unavailable"
    case network
    case serviceUnavailable = "service_unavailable"
    case rateLimited = "rate_limited"
    case quotaExceeded = "quota_exceeded"
    case zoneNotFound = "zone_not_found"
    case notFound = "not_found"
    case conflict
    case recordTooLarge = "record_too_large"
    case limitExceeded = "limit_exceeded"
    case permissionDenied = "permission_denied"
    case misconfigured
    case assetNotFound = "asset_not_found"
    case fileError = "file_error"
    case invalidArgument = "invalid_argument"
    case timeout
    case cancelled
    case serverRejected = "server_rejected"
    case unknown
  }

  let code: Code
  let message: String
  /// Seconds CloudKit asks to wait before retrying (rate limits, busy zones).
  var retryAfter: Double?

  init(_ code: Code, _ message: String, retryAfter: Double? = nil) {
    self.code = code
    self.message = message
    self.retryAfter = retryAfter
  }

  var description: String {
    let retry = retryAfter.map { ";retryAfter=\($0)" } ?? ""
    return "[nitro-cloudkit:\(code.rawValue)\(retry)] \(message)"
  }
}
