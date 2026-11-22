@preconcurrency import CloudKit

extension CKAccountStatus {
  func toCore() -> CoreAccountStatus {
    switch self {
    case .available: return .available
    case .noAccount: return .noAccount
    case .restricted: return .restricted
    case .temporarilyUnavailable: return .temporarilyUnavailable
    case .couldNotDetermine: return .couldNotDetermine
    @unknown default: return .couldNotDetermine
    }
  }
}
