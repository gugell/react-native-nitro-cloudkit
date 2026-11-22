@preconcurrency import CloudKit

extension CKAccountStatus {
  func toNitro() -> CloudKitAccountStatus {
    switch self {
    case .available: return .available
    case .noAccount: return .noaccount
    case .restricted: return .restricted
    case .temporarilyUnavailable: return .temporarilyunavailable
    case .couldNotDetermine: return .couldnotdetermine
    @unknown default: return .couldnotdetermine
    }
  }
}
