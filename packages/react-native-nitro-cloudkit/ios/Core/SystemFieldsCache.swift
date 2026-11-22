@preconcurrency import CloudKit
import Foundation

/// The last known system fields (change tag) of every record in the zone, on disk. A save built on
/// them goes over the server version; one without them meets `serverRecordChanged` once, after
/// which the server's fields are cached here. Losing this file costs one conflict round per record.
final class SystemFieldsCache {
  private let url: URL
  private var entries: [String: Data]
  private var dirty = false

  init(containerIdentifier: String, zoneName: String) {
    let base =
      FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? FileManager.default.temporaryDirectory
    let safe = { (value: String) in
      String(value.map { $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" ? $0 : "_" })
    }
    url = base
      .appendingPathComponent("NitroCloudKit", isDirectory: true)
      .appendingPathComponent("\(safe(containerIdentifier))-\(safe(zoneName))-system-fields.plist")
    entries =
      (try? Data(contentsOf: url)).flatMap {
        try? PropertyListDecoder().decode([String: Data].self, from: $0)
      } ?? [:]
  }

  /// A record carrying the cached system fields, when they exist for that type.
  func record(for id: CKRecord.ID, type: String) -> CKRecord? {
    guard let data = entries[id.recordName], let record = CKRecord.fromSystemFields(data),
      record.recordType == type, record.recordID.zoneID == id.zoneID
    else { return nil }
    return record
  }

  func store(_ record: CKRecord) {
    entries[record.recordID.recordName] = record.encodedSystemFields()
    dirty = true
  }

  func remove(_ recordName: String) {
    if entries.removeValue(forKey: recordName) != nil { dirty = true }
  }

  func removeAll() {
    entries = [:]
    dirty = false
    try? FileManager.default.removeItem(at: url)
  }

  /// Writes pending changes; a failed write only costs conflict rounds later.
  func flush() {
    guard dirty else { return }
    do {
      try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      let data = try PropertyListEncoder().encode(entries)
      try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      var target = url
      try? target.setResourceValues(values)
      dirty = false
    } catch {
      // Kept dirty: the next flush tries again.
    }
  }
}
