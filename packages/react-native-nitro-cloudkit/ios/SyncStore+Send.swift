@preconcurrency import CloudKit
import Foundation

@available(iOS 17.0, macOS 14.0, *)
extension SyncStore {
  /// Saves and deletes records through CKSyncEngine and reports each one's outcome. Only this
  /// send's changes go out: leftovers of earlier sends are dropped (the caller sends them again).
  func send(_ changes: CloudKitChangeSet) async throws -> CloudKitSendResult {
    let engine = currentEngine()
    var inputs: [CKRecord.ID: CloudKitRecordToSave] = [:]
    var types: [CKRecord.ID: String] = [:]
    var saves: [CKRecord.ID] = []
    var deletes: [CKRecord.ID] = []
    outbox = [:]
    for input in changes.recordsToSave {
      let id = CKRecord.ID(recordName: input.recordName, zoneID: zoneID)
      inputs[id] = input
      types[id] = input.recordType
      outbox[id] = makeRecord(input, id: id, reuseSystemFields: true)
      saves.append(id)
    }
    for ref in changes.recordsToDelete {
      let id = CKRecord.ID(recordName: ref.recordName, zoneID: zoneID)
      guard inputs[id] == nil else {
        throw CloudKitFailure(.invalidArgument, "\(ref.recordName) is both saved and deleted")
      }
      types[id] = ref.recordType
      deletes.append(id)
    }
    if saves.isEmpty && deletes.isEmpty {
      return CloudKitSendResult(saved: [], deleted: [], conflicts: [], failed: [])
    }

    dropPendingChanges(of: engine, except: Set(types.keys))
    collector = SendCollector(types: types)
    defer {
      dropPendingChanges(of: engine, except: [])
      outbox = [:]
      collector = nil
      cache.flush()
    }

    var toSave = saves
    var toDelete = deletes
    for attempt in 0..<3 {
      if !zoneSaved {
        engine.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: zoneID))])
      }
      engine.state.add(
        pendingRecordZoneChanges: toSave.map { .saveRecord($0) } + toDelete.map { .deleteRecord($0) })
      // Default scope: the zone save (a database change) goes first, then exactly the record
      // changes above (leftovers were dropped).
      try await engine.sendChanges()

      guard var current = collector else { break }
      if let zoneError = current.zoneError { throw CloudKitFailure.from(zoneError) }
      let again = current.retryAfterZone.union(current.retryAsNew)
      if again.isEmpty { break }
      for id in current.retryAsNew {
        if let input = inputs[id] { outbox[id] = makeRecord(input, id: id, reuseSystemFields: false) }
      }
      current.retryAfterZone = []
      current.retryAsNew = []
      if attempt == 2 {
        for id in again {
          current.fail(id, CloudKitFailure(.zoneNotFound, "The record zone could not be created"))
        }
      }
      collector = current
      toSave = Array(again)
      toDelete = []
    }
    return collector?.result() ?? CloudKitSendResult(saved: [], deleted: [], conflicts: [], failed: [])
  }

  /// A record to save: over the cached server version when there is one, else a new record.
  func makeRecord(_ input: CloudKitRecordToSave, id: CKRecord.ID, reuseSystemFields: Bool)
    -> CKRecord
  {
    let record =
      (reuseSystemFields ? cache.record(for: id, type: input.recordType) : nil)
      ?? CKRecord(recordType: input.recordType, recordID: id)
    for (key, value) in input.encryptedFields {
      record.encryptedValues[key] = value
    }
    return record
  }

  private func dropPendingChanges(of engine: CKSyncEngine, except keep: Set<CKRecord.ID>) {
    let stale = engine.state.pendingRecordZoneChanges.filter { change in
      switch change {
      case .saveRecord(let id), .deleteRecord(let id): return !keep.contains(id)
      @unknown default: return false
      }
    }
    if !stale.isEmpty { engine.state.remove(pendingRecordZoneChanges: stale) }
  }

  /// Applies one `.sentRecordZoneChanges` event: caches new change tags, sorts outcomes.
  func handleSent(_ event: CKSyncEngine.Event.SentRecordZoneChanges) {
    for record in event.savedRecords where record.recordID.zoneID == zoneID {
      cache.store(record)
      if collector?.contains(record.recordID) == true { collector?.save(record) }
    }
    for failure in event.failedRecordSaves where failure.record.recordID.zoneID == zoneID {
      let id = failure.record.recordID
      switch failure.error.code {
      case .serverRecordChanged:
        if let server = failure.error.serverRecord {
          cache.store(server)
          collector?.conflict(server)
        } else {
          collector?.fail(id, CloudKitFailure.from(failure.error))
        }
      case .zoneNotFound, .userDeletedZone:
        zoneSaved = false
        collector?.retryAfterZone.insert(id)
      case .unknownItem:
        cache.remove(id.recordName)
        collector?.retryAsNew.insert(id)
      default:
        collector?.fail(id, CloudKitFailure.from(failure.error))
      }
    }
    for id in event.deletedRecordIDs where id.zoneID == zoneID {
      cache.remove(id.recordName)
      if collector?.contains(id) == true { collector?.delete(id) }
    }
    for (id, error) in event.failedRecordDeletes where id.zoneID == zoneID {
      switch error.code {
      case .unknownItem, .zoneNotFound, .userDeletedZone:
        // Already gone: what a delete wants.
        cache.remove(id.recordName)
        if collector?.contains(id) == true { collector?.delete(id) }
      default:
        collector?.fail(id, CloudKitFailure.from(error))
      }
    }
  }
}
