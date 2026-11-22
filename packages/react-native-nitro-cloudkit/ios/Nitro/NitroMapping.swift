import Foundation
import NitroModules

// One-to-one mapping between the core's value types and the structs nitrogen generates from the
// TypeScript specs. Nothing but field copies lives here.

extension CoreStoreOptions {
  init(_ options: CloudKitStoreOptions) {
    self.init(
      containerIdentifier: options.containerIdentifier,
      zoneName: options.zoneName,
      timeoutSeconds: options.timeoutSeconds,
      automaticallySync: options.automaticallySync)
  }
}

extension CoreChangeSet {
  init(_ changes: CloudKitChangeSet) {
    self.init(
      recordsToSave: changes.recordsToSave.map {
        CoreRecordToSave(
          recordType: $0.recordType, recordName: $0.recordName, encryptedFields: $0.encryptedFields)
      },
      recordsToDelete: changes.recordsToDelete.map(CoreRecordID.init))
  }
}

extension CoreRecordID {
  init(_ id: CloudKitRecordID) {
    self.init(recordType: id.recordType, recordName: id.recordName)
  }

  var nitro: CloudKitRecordID { CloudKitRecordID(recordType: recordType, recordName: recordName) }
}

extension CoreRecord {
  var nitro: CloudKitRecord {
    CloudKitRecord(
      recordType: recordType, recordName: recordName, encryptedFields: encryptedFields,
      modifiedAt: modifiedAt)
  }
}

extension CoreAccount {
  var nitro: CloudKitAccount {
    CloudKitAccount(
      status: CloudKitAccountStatus(fromString: status.rawValue) ?? .couldnotdetermine,
      identity: identity)
  }
}

extension CoreAccountChange {
  var nitro: CloudKitAccountChange {
    CloudKitAccountChange(type: CloudKitAccountChangeType(fromString: type.rawValue) ?? .signout)
  }
}

extension CoreChanges {
  var nitro: CloudKitChanges {
    CloudKitChanges(
      modified: modified.map(\.nitro), deleted: deleted.map(\.nitro), token: token,
      zoneWasDeleted: zoneWasDeleted)
  }
}

extension CoreSendResult {
  var nitro: CloudKitSendResult {
    CloudKitSendResult(
      saved: saved.map(\.nitro),
      deleted: deleted.map(\.nitro),
      conflicts: conflicts.map(\.nitro),
      failed: failed.map {
        CloudKitRecordFailure(
          recordType: $0.recordType, recordName: $0.recordName, code: $0.code, message: $0.message)
      })
  }
}
