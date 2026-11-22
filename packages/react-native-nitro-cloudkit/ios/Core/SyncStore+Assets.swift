@preconcurrency import CloudKit
import Foundation

/// Files live in their own zone (`<zone>_assets`), one record per file with a CKAsset field, so a
/// sync fetch never downloads them in bulk. They are read and written with direct database calls.
@available(iOS 17.0, macOS 14.0, *)
extension SyncStore {
  static let assetRecordType = "NitroCloudKitAsset"
  static let assetField = "file"

  func putAsset(name: String, fileUri: String) async throws {
    let source = try fileURL(fileUri)
    guard FileManager.default.fileExists(atPath: source.path) else {
      throw CloudKitFailure(.fileError, "No file at \(source.lastPathComponent)")
    }
    let id = CKRecord.ID(recordName: name, zoneID: assetZoneID)
    // Assets never change after import: one already stored is the same file.
    if try await lookup(id, desiredKeys: []) != nil { return }
    try await saveAssetZoneIfNeeded()

    let record = CKRecord(recordType: Self.assetRecordType, recordID: id)
    record[Self.assetField] = CKAsset(fileURL: source)
    let (results, _) = try await database.configuredWith(configuration: assetConfiguration) {
      try await $0.modifyRecords(
        saving: [record], deleting: [], savePolicy: .ifServerRecordUnchanged, atomically: false)
    }
    if case .failure(let error) = results[id] {
      // Another device stored it first: same name, same file.
      if let ckError = error as? CKError, ckError.code == .serverRecordChanged { return }
      throw error
    }
  }

  func getAsset(name: String, fileUri: String) async throws {
    let destination = try fileURL(fileUri)
    let id = CKRecord.ID(recordName: name, zoneID: assetZoneID)
    guard let record = try await lookup(id, desiredKeys: [Self.assetField]),
      let asset = record[Self.assetField] as? CKAsset, let source = asset.fileURL
    else {
      throw CloudKitFailure(.assetNotFound, "No asset named \(name)")
    }
    let manager = FileManager.default
    try manager.createDirectory(
      at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    let partial = destination.appendingPathExtension("partial-\(UUID().uuidString)")
    try manager.copyItem(at: source, to: partial)
    do {
      if manager.fileExists(atPath: destination.path) {
        _ = try manager.replaceItemAt(destination, withItemAt: partial)
      } else {
        try manager.moveItem(at: partial, to: destination)
      }
    } catch {
      try? manager.removeItem(at: partial)
      throw error
    }
  }

  func removeAsset(name: String) async throws {
    let id = CKRecord.ID(recordName: name, zoneID: assetZoneID)
    do {
      let (_, results) = try await database.configuredWith(configuration: operationConfiguration) {
        try await $0.modifyRecords(saving: [], deleting: [id], atomically: false)
      }
      if case .failure(let error) = results[id] { throw error }
    } catch let error as CKError
      where [.unknownItem, .zoneNotFound, .userDeletedZone].contains(error.code)
    {
      return  // Already gone.
    }
  }

  private func saveAssetZoneIfNeeded() async throws {
    guard !assetZoneSaved else { return }
    let zone = CKRecordZone(zoneID: assetZoneID)
    let (results, _) = try await database.configuredWith(configuration: operationConfiguration) {
      try await $0.modifyRecordZones(saving: [zone], deleting: [])
    }
    if case .failure(let error) = results[assetZoneID] { throw error }
    assetZoneSaved = true
  }

  /// Uploads and downloads may be large: allow the whole timeout per request, not less.
  private var assetConfiguration: CKOperation.Configuration {
    let configuration = operationConfiguration
    configuration.timeoutIntervalForResource = max(timeoutSeconds, 300)
    return configuration
  }

  func fileURL(_ uri: String) throws -> URL {
    if uri.hasPrefix("file://"), let url = URL(string: uri), url.isFileURL { return url }
    if uri.hasPrefix("/") { return URL(fileURLWithPath: uri) }
    throw CloudKitFailure(.invalidArgument, "Expected a file:// URI or an absolute path")
  }
}
