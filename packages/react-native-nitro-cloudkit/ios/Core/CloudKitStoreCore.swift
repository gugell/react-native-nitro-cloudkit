import Foundation
#if os(macOS)
  import Security
#endif

/// The store as any bridge uses it: every call is queued (one at a time), bounded by the timeout
/// and its errors coded as `CloudKitFailure`. The work itself happens in `SyncStore`. Open stores
/// with `CloudKitStoreCore.open`, one per container for the process's lifetime (one CKSyncEngine
/// per database).
@available(iOS 17.0, macOS 14.0, *)
final class CloudKitStoreCore: @unchecked Sendable {
  private let store: SyncStore
  private let queue = SerialQueue()
  let timeoutSeconds: Double

  private init(options: CoreStoreOptions) {
    store = SyncStore(options: options)
    timeoutSeconds = options.timeoutSeconds
    let store = store
    Task { await store.observeAccountChanges() }
  }

  var containerIdentifier: String { store.containerIdentifier }
  var zoneName: String { store.zoneName }

  // MARK: Opening

  private static let lock = NSLock()
  private static var stores: [String: CloudKitStoreCore] = [:]

  /// The store of `options.containerIdentifier`, opened once; the same container with another
  /// zone is refused. Throws `invalid_argument` or `misconfigured`.
  static func open(_ options: CoreStoreOptions) throws -> CloudKitStoreCore {
    if let problem = problem(with: options) { throw CloudKitFailure(.invalidArgument, problem) }
    return try lock.locked {
      if let existing = stores[options.containerIdentifier] {
        guard existing.zoneName == options.zoneName else {
          throw CloudKitFailure(
            .invalidArgument,
            "\(options.containerIdentifier) is already open with zone \(existing.zoneName)")
        }
        return existing
      }
      // CKContainer traps (ends the process) when the container is not in the entitlements.
      if let missing = missingEntitlement(options.containerIdentifier) {
        throw CloudKitFailure(.misconfigured, missing)
      }
      let store = CloudKitStoreCore(options: options)
      stores[options.containerIdentifier] = store
      return store
    }
  }

  static func problem(with options: CoreStoreOptions) -> String? {
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

  /// On macOS the signed process's entitlements can be read: say what is missing instead of
  /// letting CKContainer trap. iOS offers no public way to read them; builds there get the
  /// entitlements from the Expo plugin.
  static func missingEntitlement(_ container: String) -> String? {
    #if os(macOS)
      guard let task = SecTaskCreateFromSelf(nil) else { return nil }
      let services =
        SecTaskCopyValueForEntitlement(task, "com.apple.developer.icloud-services" as CFString, nil)
        as? [String] ?? []
      let containers =
        SecTaskCopyValueForEntitlement(
          task, "com.apple.developer.icloud-container-identifiers" as CFString, nil)
        as? [String] ?? []
      if !services.contains("CloudKit") || !containers.contains(container) {
        return "This process is not signed with the CloudKit entitlement for \(container)"
      }
    #endif
    return nil
  }

  // MARK: Calls

  func getAccount() async throws -> CoreAccount {
    try await run("Reading the iCloud account") { try await $0.account() }
  }

  /// Called on any thread when the account signs in, out or switches; returns a remover.
  func addAccountChangeListener(_ listener: @escaping (CoreAccountChange) -> Void) -> () -> Void {
    let listeners = store.accountListeners
    let id = listeners.add(listener)
    return { listeners.remove(id) }
  }

  /// Called on any thread when CKSyncEngine fetched changes on its own; returns a remover.
  func addRemoteChangeListener(_ listener: @escaping () -> Void) -> () -> Void {
    let listeners = store.remoteChangeListeners
    let id = listeners.add { _ in listener() }
    return { listeners.remove(id) }
  }

  func fetchChanges(token: String?) async throws -> CoreChanges {
    try await run("Fetching changes") { try await $0.fetch(token: token) }
  }

  func fetchRecord(recordType: String, recordName: String) async throws -> CoreRecord? {
    try await run("Fetching a record") { try await $0.fetchRecord(type: recordType, name: recordName) }
  }

  func sendChanges(_ changes: CoreChangeSet) async throws -> CoreSendResult {
    try await run("Sending changes") { try await $0.send(changes) }
  }

  func putAsset(name: String, fileUri: String) async throws {
    try await run("Uploading an asset", seconds: assetTimeout) {
      try await $0.putAsset(name: name, fileUri: fileUri)
    }
  }

  func getAsset(name: String, fileUri: String) async throws {
    try await run("Downloading an asset", seconds: assetTimeout) {
      try await $0.getAsset(name: name, fileUri: fileUri)
    }
  }

  func removeAsset(name: String) async throws {
    try await run("Removing an asset") { try await $0.removeAsset(name: name) }
  }

  func reset() async throws {
    try await run("Resetting sync state") { await $0.reset() }
  }

  func deleteAllData() async throws {
    try await run("Deleting iCloud data") { try await $0.deleteAllData() }
  }

  /// Files may be large: at least five minutes, whatever the record timeout is.
  private var assetTimeout: Double { max(timeoutSeconds, 300) }

  private func run<T: Sendable>(
    _ what: String,
    seconds: Double? = nil,
    _ body: @escaping @Sendable (SyncStore) async throws -> T
  ) async throws -> T {
    let store = store
    let limit = seconds ?? timeoutSeconds
    do {
      return try await queue.run {
        try await withTimeout(seconds: limit, what) { try await body(store) }
      }
    } catch {
      throw CloudKitFailure.from(error)
    }
  }
}
