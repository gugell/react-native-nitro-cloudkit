@preconcurrency import CloudKit
import Foundation

extension CloudKitFailure {
  /// Maps any error (CloudKit, file system, cancellation) to a coded failure.
  static func from(_ error: Error) -> CloudKitFailure {
    if let failure = error as? CloudKitFailure { return failure }
    if error is CancellationError { return CloudKitFailure(.cancelled, "The operation was cancelled") }
    // NSErrors in CKErrorDomain bridge to CKError here.
    if let ckError = error as? CKError { return from(ckError) }
    let nsError = error as NSError
    if nsError.domain == NSCocoaErrorDomain || nsError.domain == NSPOSIXErrorDomain {
      return CloudKitFailure(.fileError, nsError.localizedDescription)
    }
    return CloudKitFailure(.unknown, error.localizedDescription)
  }

  static func from(_ error: CKError) -> CloudKitFailure {
    if error.code == .partialFailure,
      let first = error.partialErrorsByItemID?.values.first
    {
      return from(first)
    }
    return CloudKitFailure(code(of: error), error.localizedDescription, retryAfter: error.retryAfterSeconds)
  }

  private static func code(of error: CKError) -> Code {
    switch error.code {
    case .notAuthenticated: return .notAuthenticated
    case .accountTemporarilyUnavailable: return .accountTemporarilyUnavailable
    case .networkUnavailable, .networkFailure, .serverResponseLost: return .network
    case .serviceUnavailable, .zoneBusy: return .serviceUnavailable
    case .requestRateLimited: return .rateLimited
    case .quotaExceeded: return .quotaExceeded
    case .zoneNotFound, .userDeletedZone: return .zoneNotFound
    case .unknownItem: return .notFound
    case .serverRecordChanged: return .conflict
    case .limitExceeded: return .limitExceeded
    case .permissionFailure, .managedAccountRestricted: return .permissionDenied
    case .badContainer, .missingEntitlement, .badDatabase, .incompatibleVersion: return .misconfigured
    case .assetFileNotFound, .assetFileModified: return .fileError
    case .operationCancelled: return .cancelled
    case .invalidArguments, .serverRejectedRequest, .constraintViolation: return .serverRejected
    default: return .unknown
    }
  }
}
