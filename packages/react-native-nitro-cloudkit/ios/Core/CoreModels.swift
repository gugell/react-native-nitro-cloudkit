import Foundation

// The store's own value types, free of any bridge. They mirror the TypeScript specs field for
// field (and encode to the same JSON), so the Nitro layer maps them one to one and other hosts
// (a Node-API addon on macOS) can pass them as JSON.

/// Options of one store: a container's private database and one record zone.
struct CoreStoreOptions: Codable, Sendable {
  var containerIdentifier: String
  var zoneName: String
  var timeoutSeconds: Double
  var automaticallySync: Bool
}

/// The iCloud account's state on this device (`CKAccountStatus`).
enum CoreAccountStatus: String, Codable, Sendable {
  case available
  case noAccount
  case restricted
  case couldNotDetermine
  case temporarilyUnavailable
}

struct CoreAccount: Codable, Sendable {
  var status: CoreAccountStatus
  /// Hash of the user record id for this container; nil unless available.
  var identity: String?
}

enum CoreAccountChangeType: String, Codable, Sendable {
  case signIn
  case signOut
  case switchAccounts
}

struct CoreAccountChange: Codable, Sendable {
  var type: CoreAccountChangeType
}

struct CoreRecordID: Codable, Sendable {
  var recordType: String
  var recordName: String
}

/// A record as the server has it: encrypted string fields and the server modification time (ms).
struct CoreRecord: Codable, Sendable {
  var recordType: String
  var recordName: String
  var encryptedFields: [String: String]
  var modifiedAt: Double
}

struct CoreRecordToSave: Codable, Sendable {
  var recordType: String
  var recordName: String
  var encryptedFields: [String: String]
}

struct CoreRecordFailure: Codable, Sendable {
  var recordType: String
  var recordName: String
  var code: String
  var message: String
}

struct CoreChanges: Codable, Sendable {
  var modified: [CoreRecord]
  var deleted: [CoreRecordID]
  var token: String
  var zoneWasDeleted: Bool
}

struct CoreChangeSet: Codable, Sendable {
  var recordsToSave: [CoreRecordToSave]
  var recordsToDelete: [CoreRecordID]
}

struct CoreSendResult: Codable, Sendable {
  var saved: [CoreRecord]
  var deleted: [CoreRecordID]
  var conflicts: [CoreRecord]
  var failed: [CoreRecordFailure]

  static let empty = CoreSendResult(saved: [], deleted: [], conflicts: [], failed: [])
}
