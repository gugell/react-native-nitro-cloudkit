@preconcurrency import CloudKit
import Foundation

/// One container's private database and one record zone, driven by CKSyncEngine (WWDC23
/// "Sync to iCloud with CKSyncEngine"). The caller owns persistence: the engine state travels to
/// the caller as the token returned by `fetch`, and the engine is rebuilt from whatever token comes back.
/// Calls are serialized by the hybrid object; engine events arrive re-entrantly while a fetch or
/// send is awaited.
@available(iOS 17.0, macOS 14.0, *)
actor SyncStore {
  nonisolated let containerIdentifier: String
  nonisolated let zoneName: String
  nonisolated let accountListeners = ListenerSet<CoreAccountChange>()
  nonisolated let remoteChangeListeners = ListenerSet<Void>()

  let container: CKContainer
  let database: CKDatabase
  let zoneID: CKRecordZone.ID
  let assetZoneID: CKRecordZone.ID
  let timeoutSeconds: Double
  let automaticallySync: Bool
  let cache: SystemFieldsCache

  /// The engine, rebuilt when the caller's token is not the one it continues from.
  var engine: CKSyncEngine?
  /// The token the engine and `inbox` continue from (nil: from the beginning).
  var engineBaseToken: String?
  /// The engine's latest state (from `.stateUpdate`), handed out as the next token.
  var latestState: CKSyncEngine.State.Serialization?
  var inbox = Inbox()
  var fetching = false
  var fetchError: CKError?

  /// Records of the send in progress, by id (CKSyncEngine asks for them in batches).
  var outbox: [CKRecord.ID: CKRecord] = [:]
  var collector: SendCollector?
  var zoneSaved = false
  var assetZoneSaved = false

  /// Account fingerprint last seen (nil: signed out); unknown until first loaded.
  var knownIdentity: String?
  var identityLoaded = false
  var accountObserver: NSObjectProtocol?

  init(options: CoreStoreOptions) {
    containerIdentifier = options.containerIdentifier
    zoneName = options.zoneName
    container = CKContainer(identifier: options.containerIdentifier)
    database = container.privateCloudDatabase
    zoneID = CKRecordZone.ID(zoneName: options.zoneName, ownerName: CKCurrentUserDefaultName)
    assetZoneID = CKRecordZone.ID(
      zoneName: "\(options.zoneName)_assets", ownerName: CKCurrentUserDefaultName)
    timeoutSeconds = options.timeoutSeconds
    automaticallySync = options.automaticallySync
    cache = SystemFieldsCache(
      containerIdentifier: options.containerIdentifier, zoneName: options.zoneName)
  }

  // MARK: Engine

  /// The engine continuing from `token`; a different token rebuilds it from that state.
  func engine(continuingFrom token: String?) throws -> CKSyncEngine {
    if let engine, engineBaseToken == token { return engine }
    let state: CKSyncEngine.State.Serialization?
    if let token {
      guard let data = Data(base64Encoded: token),
        let decoded = try? JSONDecoder().decode(CKSyncEngine.State.Serialization.self, from: data)
      else { throw CloudKitFailure(.invalidArgument, "The sync token is not one this module issued") }
      state = decoded
    } else {
      state = nil
    }
    return makeEngine(state: state, base: token)
  }

  /// The current engine, or one starting from the beginning (a send before any fetch).
  func currentEngine() -> CKSyncEngine {
    engine ?? makeEngine(state: nil, base: nil)
  }

  private func makeEngine(state: CKSyncEngine.State.Serialization?, base: String?) -> CKSyncEngine {
    if let old = engine { Task { await old.cancelOperations() } }
    var configuration = CKSyncEngine.Configuration(
      database: database, stateSerialization: state, delegate: self)
    configuration.automaticallySync = automaticallySync
    let created = CKSyncEngine(configuration)
    engine = created
    engineBaseToken = base
    latestState = state
    inbox = Inbox()
    return created
  }

  func encode(_ state: CKSyncEngine.State.Serialization) throws -> String {
    try JSONEncoder().encode(state).base64EncodedString()
  }

  /// Fetches only the record zone; the asset zone is downloaded per file, never in bulk.
  var fetchOptions: CKSyncEngine.FetchChangesOptions {
    CKSyncEngine.FetchChangesOptions(scope: .allExcluding([assetZoneID]))
  }

  // MARK: Records

  func fetch(token rawToken: String?) async throws -> CoreChanges {
    let token = rawToken.flatMap { $0.isEmpty ? nil : $0 }
    let engine = try engine(continuingFrom: token)
    fetching = true
    fetchError = nil
    defer { fetching = false }
    try await engine.fetchChanges(fetchOptions)
    if let fetchError { throw CloudKitFailure.from(fetchError) }

    let next = try latestState.map(encode) ?? token ?? ""
    let changes = inbox.changes(token: next)
    inbox = Inbox()
    engineBaseToken = next.isEmpty ? nil : next
    cache.flush()
    return changes
  }

  func fetchRecord(type: String, name: String) async throws -> CoreRecord? {
    let id = CKRecord.ID(recordName: name, zoneID: zoneID)
    guard let record = try await lookup(id, desiredKeys: nil), record.recordType == type else {
      return nil
    }
    cache.store(record)
    cache.flush()
    return record.toCore()
  }

  /// One record by id; nil when it or its zone does not exist.
  func lookup(_ id: CKRecord.ID, desiredKeys: [CKRecord.FieldKey]?) async throws -> CKRecord? {
    do {
      let results = try await database.configuredWith(configuration: operationConfiguration) {
        try await $0.records(for: [id], desiredKeys: desiredKeys)
      }
      switch results[id] {
      case .success(let record): return record
      case .failure(let error): throw error
      case nil: return nil
      }
    } catch let error as CKError where error.code == .unknownItem {
      return nil
    } catch let error as CKError where error.code == .zoneNotFound || error.code == .userDeletedZone {
      if id.zoneID == assetZoneID { assetZoneSaved = false } else { zoneSaved = false }
      return nil
    }
  }

  /// Direct database calls fail fast when offline instead of waiting for the network.
  var operationConfiguration: CKOperation.Configuration {
    let configuration = CKOperation.Configuration()
    configuration.qualityOfService = .userInitiated
    configuration.timeoutIntervalForRequest = timeoutSeconds
    configuration.timeoutIntervalForResource = timeoutSeconds
    return configuration
  }

  // MARK: Reset

  /// Forgets everything local: engine state, fetched changes, change tags. Server data stays.
  func reset() async {
    if let old = engine { await old.cancelOperations() }
    engine = nil
    engineBaseToken = nil
    latestState = nil
    inbox = Inbox()
    outbox = [:]
    collector = nil
    zoneSaved = false
    assetZoneSaved = false
    cache.removeAll()
  }

  func deleteAllData() async throws {
    let zones = [zoneID, assetZoneID]
    let (_, results) = try await database.configuredWith(configuration: operationConfiguration) {
      try await $0.modifyRecordZones(saving: [], deleting: zones)
    }
    for case .failure(let error) in results.values {
      if let ckError = error as? CKError,
        ckError.code == .zoneNotFound || ckError.code == .userDeletedZone
      {
        continue
      }
      throw error
    }
    await reset()
  }
}
