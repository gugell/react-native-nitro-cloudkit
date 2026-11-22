import Foundation
import NitroModules

/// Opens stores, one per container for the app's lifetime (one CKSyncEngine per database).
final class HybridCloudKit: HybridCloudKitSpec {
  private static let lock = NSLock()
  private static var stores: [String: AnyObject] = [:]

  var isSupported: Bool {
    if #available(iOS 17.0, macOS 14.0, *) { return true }
    return false
  }

  func openStore(options: CloudKitStoreOptions) throws -> Promise<any HybridCloudKitStoreSpec> {
    guard #available(iOS 17.0, macOS 14.0, *) else {
      return .rejected(
        withError: CloudKitFailure(.unsupportedOS, "CloudKit sync needs iOS 17 or later"))
    }
    if let problem = Self.problem(with: options) {
      return .rejected(withError: CloudKitFailure(.invalidArgument, problem))
    }
    return Self.lock.locked {
      if let existing = Self.stores[options.containerIdentifier] as? HybridCloudKitStore {
        guard existing.zoneName == options.zoneName else {
          return .rejected(
            withError: CloudKitFailure(
              .invalidArgument,
              "\(options.containerIdentifier) is already open with zone \(existing.zoneName)"))
        }
        return .resolved(withResult: existing)
      }
      let store = HybridCloudKitStore(options: options)
      Self.stores[options.containerIdentifier] = store
      return .resolved(withResult: store)
    }
  }

  private static func problem(with options: CloudKitStoreOptions) -> String? {
    if !options.containerIdentifier.hasPrefix("iCloud.") {
      return "containerIdentifier must start with iCloud."
    }
    let zone = options.zoneName
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-"))
    if zone.isEmpty || zone.count > 64 || zone.hasPrefix("_")
      || zone.unicodeScalars.contains(where: { !allowed.contains($0) || !$0.isASCII })
    {
      return "zoneName must be 1–64 ASCII letters, digits, _ or -, not starting with _"
    }
    if !(options.timeoutSeconds > 0) { return "timeoutSeconds must be positive" }
    return nil
  }
}
