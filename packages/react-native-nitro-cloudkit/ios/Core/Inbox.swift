@preconcurrency import CloudKit

/// Changes CKSyncEngine fetched that the caller has not received yet. Only `fetchChanges` hands
/// them out, together with the token that covers them, so nothing fetched in the background is
/// lost: until the caller persists that token, the next launch fetches the same changes again.
@available(iOS 17.0, macOS 14.0, *)
struct Inbox {
  private(set) var modified: [CKRecord.ID: CKRecord] = [:]
  private(set) var deleted: [CKRecord.ID: CKRecord.RecordType] = [:]
  private(set) var zoneWasDeleted = false

  var isEmpty: Bool { modified.isEmpty && deleted.isEmpty && !zoneWasDeleted }

  mutating func modify(_ record: CKRecord) {
    deleted[record.recordID] = nil
    modified[record.recordID] = record
  }

  mutating func delete(_ id: CKRecord.ID, type: CKRecord.RecordType) {
    modified[id] = nil
    deleted[id] = type
  }

  /// The zone is gone: whatever was fetched before belongs to the deleted zone.
  mutating func deleteZone() {
    modified = [:]
    deleted = [:]
    zoneWasDeleted = true
  }

  func changes(token: String) -> CoreChanges {
    CoreChanges(
      modified: modified.values.map { $0.toCore() },
      deleted: deleted.map { CoreRecordID(recordType: $0.value, recordName: $0.key.recordName) },
      token: token,
      zoneWasDeleted: zoneWasDeleted
    )
  }
}
