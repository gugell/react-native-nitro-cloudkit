import Foundation
import NitroModules
#if canImport(UIKit)
  import UIKit
#elseif canImport(AppKit)
  import AppKit
#endif

/// Opens stores, one per container for the app's lifetime (`CloudKitStoreCore.open`).
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
        withError: CloudKitFailure(.unsupportedOS, "CloudKit sync needs iOS 17 or macOS 14 or later"))
    }
    do {
      let core = try CloudKitStoreCore.open(CoreStoreOptions(options))
      let store: HybridCloudKitStore = Self.lock.locked {
        if let existing = Self.stores[options.containerIdentifier] as? HybridCloudKitStore {
          return existing
        }
        let created = HybridCloudKitStore(core: core)
        Self.stores[options.containerIdentifier] = created
        return created
      }
      Self.registerForPushes()
      return .resolved(withResult: store)
    } catch {
      return .rejected(withError: CloudKitFailure.from(error))
    }
  }

  /// CKSyncEngine fetches on CloudKit's silent pushes once the app is registered for them (the
  /// Expo plugin adds `aps-environment` and the `remote-notification` background mode).
  private static func registerForPushes() {
    #if canImport(UIKit) && !os(watchOS)
      DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
    #elseif canImport(AppKit)
      DispatchQueue.main.async { NSApplication.shared.registerForRemoteNotifications() }
    #endif
  }
}
