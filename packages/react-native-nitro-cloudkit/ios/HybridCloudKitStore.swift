import Foundation
import NitroModules

/// The JS-facing store: every call is queued (one at a time), bounded by the timeout and its
/// errors coded. The work itself happens in `SyncStore`.
@available(iOS 17.0, macOS 14.0, *)
final class HybridCloudKitStore: HybridCloudKitStoreSpec {
  private let store: SyncStore
  private let queue = SerialQueue()
  private let timeoutSeconds: Double

  init(options: CloudKitStoreOptions) {
    store = SyncStore(options: options)
    timeoutSeconds = options.timeoutSeconds
    super.init()
    let store = store
    Task { await store.observeAccountChanges() }
  }

  var containerIdentifier: String { store.containerIdentifier }
  var zoneName: String { store.zoneName }

  func getAccount() throws -> Promise<CloudKitAccount> {
    run("Reading the iCloud account") { try await $0.account() }
  }

  func addOnAccountChangeListener(listener: @escaping (_ change: CloudKitAccountChange) -> Void)
    throws -> ListenerSubscription
  {
    let listeners = store.accountListeners
    let id = listeners.add(listener)
    return ListenerSubscription(remove: { listeners.remove(id) })
  }

  func addOnRemoteChangeListener(listener: @escaping () -> Void) throws -> ListenerSubscription {
    let listeners = store.remoteChangeListeners
    let id = listeners.add { _ in listener() }
    return ListenerSubscription(remove: { listeners.remove(id) })
  }

  func fetchChanges(token: String?) throws -> Promise<CloudKitChanges> {
    run("Fetching changes") { try await $0.fetch(token: token) }
  }

  func fetchRecord(recordType: String, recordName: String) throws -> Promise<CloudKitRecord?> {
    run("Fetching a record") { try await $0.fetchRecord(type: recordType, name: recordName) }
  }

  func sendChanges(changes: CloudKitChangeSet) throws -> Promise<CloudKitSendResult> {
    run("Sending changes") { try await $0.send(changes) }
  }

  func putAsset(name: String, fileUri: String) throws -> Promise<Void> {
    run("Uploading an asset", seconds: assetTimeout) {
      try await $0.putAsset(name: name, fileUri: fileUri)
    }
  }

  func getAsset(name: String, fileUri: String) throws -> Promise<Void> {
    run("Downloading an asset", seconds: assetTimeout) {
      try await $0.getAsset(name: name, fileUri: fileUri)
    }
  }

  func removeAsset(name: String) throws -> Promise<Void> {
    run("Removing an asset") { try await $0.removeAsset(name: name) }
  }

  func reset() throws -> Promise<Void> {
    run("Resetting sync state") { await $0.reset() }
  }

  func deleteAllData() throws -> Promise<Void> {
    run("Deleting iCloud data") { try await $0.deleteAllData() }
  }

  /// Files may be large: at least five minutes, whatever the record timeout is.
  private var assetTimeout: Double { max(timeoutSeconds, 300) }

  private func run<T>(
    _ what: String,
    seconds: Double? = nil,
    _ body: @escaping @Sendable (SyncStore) async throws -> T
  ) -> Promise<T> {
    let store = store
    let queue = queue
    let limit = seconds ?? timeoutSeconds
    return Promise.async {
      do {
        return try await queue.run {
          try await withTimeout(seconds: limit, what) { try await body(store) }
        }
      } catch {
        throw CloudKitFailure.from(error)
      }
    }
  }
}
