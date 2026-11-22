@preconcurrency import CloudKit

/// Collects CKSyncEngine's send events for one `sendChanges` call.
@available(iOS 17.0, macOS 14.0, *)
struct SendCollector {
  /// Every record of this send, with its type (deletion events only carry ids).
  let types: [CKRecord.ID: String]
  private(set) var saved: [CoreRecord] = []
  private(set) var deleted: [CoreRecordID] = []
  private(set) var conflicts: [CoreRecord] = []
  private(set) var failed: [CKRecord.ID: CloudKitFailure] = [:]
  private(set) var settled: Set<CKRecord.ID> = []
  /// Saves that failed because the zone was missing: sent again after the zone is saved.
  var retryAfterZone: Set<CKRecord.ID> = []
  /// Saves whose cached change tag points at a record the server no longer has: sent as new.
  var retryAsNew: Set<CKRecord.ID> = []
  /// Saving the zone itself failed: the whole send fails with this.
  var zoneError: CKError?

  init(types: [CKRecord.ID: String]) { self.types = types }

  func contains(_ id: CKRecord.ID) -> Bool { types[id] != nil }

  mutating func save(_ record: CKRecord) {
    saved.append(record.toCore())
    settle(record.recordID)
  }

  mutating func conflict(_ serverRecord: CKRecord) {
    conflicts.append(serverRecord.toCore())
    settle(serverRecord.recordID)
  }

  mutating func delete(_ id: CKRecord.ID) {
    deleted.append(CoreRecordID(recordType: types[id] ?? "", recordName: id.recordName))
    settle(id)
  }

  mutating func fail(_ id: CKRecord.ID, _ failure: CloudKitFailure) {
    failed[id] = failure
    settled.insert(id)
  }

  private mutating func settle(_ id: CKRecord.ID) {
    failed[id] = nil
    settled.insert(id)
  }

  /// The result; changes CloudKit never confirmed are reported failed, never silently dropped.
  func result() -> CoreSendResult {
    var failures = failed
    for id in types.keys where !settled.contains(id) {
      failures[id] = CloudKitFailure(.unknown, "CloudKit did not confirm this change")
    }
    return CoreSendResult(
      saved: saved,
      deleted: deleted,
      conflicts: conflicts,
      failed: failures.map { id, failure in
        CoreRecordFailure(
          recordType: types[id] ?? "",
          recordName: id.recordName,
          code: failure.code.rawValue,
          message: failure.message
        )
      }
    )
  }
}
