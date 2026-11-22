@preconcurrency import CloudKit
import Foundation

@available(iOS 17.0, macOS 14.0, *)
extension SyncStore: CKSyncEngineDelegate {
  func handleEvent(_ event: CKSyncEngine.Event, syncEngine: CKSyncEngine) async {
    // Events of an engine replaced by a newer token belong to state nobody holds any more.
    guard syncEngine === engine else { return }
    switch event {
    case .stateUpdate(let update):
      latestState = update.stateSerialization

    case .accountChange:
      await accountMayHaveChanged()

    case .fetchedDatabaseChanges(let changes):
      for deletion in changes.deletions {
        if deletion.zoneID == zoneID {
          inbox.deleteZone()
          cache.removeAll()
          zoneSaved = false
        } else if deletion.zoneID == assetZoneID {
          assetZoneSaved = false
        }
      }

    case .fetchedRecordZoneChanges(let changes):
      for modification in changes.modifications where modification.record.recordID.zoneID == zoneID {
        inbox.modify(modification.record)
        cache.store(modification.record)
      }
      for deletion in changes.deletions where deletion.recordID.zoneID == zoneID {
        inbox.delete(deletion.recordID, type: deletion.recordType)
        cache.remove(deletion.recordID.recordName)
      }

    case .didFetchRecordZoneChanges(let result):
      guard result.zoneID == zoneID, let error = result.error else { break }
      switch error.code {
      case .zoneNotFound:
        // Nothing saved yet on this account: no changes, not a failure.
        zoneSaved = false
      case .userDeletedZone:
        inbox.deleteZone()
        cache.removeAll()
        zoneSaved = false
      default:
        fetchError = error
      }

    case .didFetchChanges:
      cache.flush()
      // Fetched on its own (push, launch): tell JS there is something to pull.
      if !fetching && !inbox.isEmpty { remoteChangeListeners.emit(()) }

    case .sentDatabaseChanges(let changes):
      if changes.savedZones.contains(where: { $0.zoneID == zoneID }) { zoneSaved = true }
      if changes.savedZones.contains(where: { $0.zoneID == assetZoneID }) { assetZoneSaved = true }
      if let failure = changes.failedZoneSaves.first(where: { $0.zone.zoneID == zoneID }) {
        collector?.zoneError = failure.error
      }

    case .sentRecordZoneChanges(let changes):
      handleSent(changes)

    case .willFetchChanges, .willFetchRecordZoneChanges, .willSendChanges, .didSendChanges:
      break

    @unknown default:
      break
    }
  }

  func nextRecordZoneChangeBatch(
    _ context: CKSyncEngine.SendChangesContext, syncEngine: CKSyncEngine
  ) async -> CKSyncEngine.RecordZoneChangeBatch? {
    guard syncEngine === engine else { return nil }
    let pending = syncEngine.state.pendingRecordZoneChanges.filter {
      context.options.scope.contains($0)
    }
    let records = outbox
    return await CKSyncEngine.RecordZoneChangeBatch(pendingChanges: pending) { id in
      if let record = records[id] { return record }
      // Not part of a send in progress (a leftover): drop it rather than send stale data.
      syncEngine.state.remove(pendingRecordZoneChanges: [.saveRecord(id)])
      return nil
    }
  }

  func nextFetchChangesOptions(
    _ context: CKSyncEngine.FetchChangesContext, syncEngine: CKSyncEngine
  ) async -> CKSyncEngine.FetchChangesOptions {
    fetchOptions
  }
}
