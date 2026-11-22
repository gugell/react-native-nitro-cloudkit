@preconcurrency import CloudKit
import CryptoKit
import Foundation

@available(iOS 17.0, macOS 14.0, *)
extension SyncStore {
  func account() async throws -> CloudKitAccount {
    let status = try await container.accountStatus()
    guard status == .available else {
      if !identityLoaded { remember(nil) }
      return CloudKitAccount(status: status.toNitro(), identity: nil)
    }
    let identity = try await currentIdentity()
    if !identityLoaded { remember(identity) }
    return CloudKitAccount(status: .available, identity: identity)
  }

  /// A hash of the user record id: stable per Apple ID and container, never the raw id.
  private func currentIdentity() async throws -> String {
    let userID = try await container.userRecordID()
    let digest = SHA256.hash(data: Data("\(containerIdentifier)\n\(userID.recordName)".utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
  }

  private func remember(_ identity: String?) {
    knownIdentity = identity
    identityLoaded = true
  }

  /// Listens for `CKAccountChanged`; CKSyncEngine's `.accountChange` events come here too.
  func observeAccountChanges() {
    guard accountObserver == nil else { return }
    accountObserver = NotificationCenter.default.addObserver(
      forName: .CKAccountChanged, object: nil, queue: nil
    ) { [weak self] _ in
      guard let self else { return }
      Task { await self.accountMayHaveChanged() }
    }
  }

  /// Compares the account with the one last seen; on a sign-out or switch, forgets local state
  /// (never mix two accounts' change tags) and tells JS.
  func accountMayHaveChanged() async {
    let wasLoaded = identityLoaded
    let before = knownIdentity
    let after: String?
    do {
      let status = try await container.accountStatus()
      after = status == .available ? try await currentIdentity() : nil
    } catch {
      return  // Unknown right now (offline): the next check decides.
    }
    remember(after)
    guard wasLoaded, before != after else { return }
    let type: CloudKitAccountChangeType =
      before == nil ? .signin : after == nil ? .signout : .switchaccounts
    if type != .signin { await reset() }
    accountListeners.emit(CloudKitAccountChange(type: type))
  }
}
