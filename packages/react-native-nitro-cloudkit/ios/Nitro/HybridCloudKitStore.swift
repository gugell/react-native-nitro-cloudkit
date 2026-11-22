import Foundation
import NitroModules

/// The JS-facing store: maps Nitro's structs to the core's and back. Queueing, timeouts and
/// error codes are `CloudKitStoreCore`'s.
@available(iOS 17.0, macOS 14.0, *)
final class HybridCloudKitStore: HybridCloudKitStoreSpec {
  private let core: CloudKitStoreCore

  init(core: CloudKitStoreCore) {
    self.core = core
    super.init()
  }

  var containerIdentifier: String { core.containerIdentifier }
  var zoneName: String { core.zoneName }

  func getAccount() throws -> Promise<CloudKitAccount> {
    run { try await $0.getAccount().nitro }
  }

  func addOnAccountChangeListener(listener: @escaping (_ change: CloudKitAccountChange) -> Void)
    throws -> ListenerSubscription
  {
    let remove = core.addAccountChangeListener { listener($0.nitro) }
    return ListenerSubscription(remove: remove)
  }

  func addOnRemoteChangeListener(listener: @escaping () -> Void) throws -> ListenerSubscription {
    ListenerSubscription(remove: core.addRemoteChangeListener(listener))
  }

  func fetchChanges(token: String?) throws -> Promise<CloudKitChanges> {
    run { try await $0.fetchChanges(token: token).nitro }
  }

  func fetchRecord(recordType: String, recordName: String) throws -> Promise<CloudKitRecord?> {
    run { try await $0.fetchRecord(recordType: recordType, recordName: recordName)?.nitro }
  }

  func sendChanges(changes: CloudKitChangeSet) throws -> Promise<CloudKitSendResult> {
    let input = CoreChangeSet(changes)
    return run { try await $0.sendChanges(input).nitro }
  }

  func putAsset(name: String, fileUri: String) throws -> Promise<Void> {
    run { try await $0.putAsset(name: name, fileUri: fileUri) }
  }

  func getAsset(name: String, fileUri: String) throws -> Promise<Void> {
    run { try await $0.getAsset(name: name, fileUri: fileUri) }
  }

  func removeAsset(name: String) throws -> Promise<Void> {
    run { try await $0.removeAsset(name: name) }
  }

  func reset() throws -> Promise<Void> {
    run { try await $0.reset() }
  }

  func deleteAllData() throws -> Promise<Void> {
    run { try await $0.deleteAllData() }
  }

  private func run<T>(_ body: @escaping (CloudKitStoreCore) async throws -> T) -> Promise<T> {
    let core = core
    return Promise.async { try await body(core) }
  }
}
