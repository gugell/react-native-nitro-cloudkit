@preconcurrency import CloudKit
import Foundation

extension CKRecord {
  /// The record as JS sees it: its encrypted string fields and server modification time.
  func toNitro() -> CloudKitRecord {
    var fields: [String: String] = [:]
    for key in encryptedValues.allKeys() {
      if let value = encryptedValues[key] as? String { fields[key] = value }
    }
    let modifiedAt = (modificationDate ?? creationDate).map { $0.timeIntervalSince1970 * 1000 } ?? 0
    return CloudKitRecord(
      recordType: recordType,
      recordName: recordID.recordName,
      encryptedFields: fields,
      modifiedAt: modifiedAt
    )
  }

  /// Only the system fields (record id, type, change tag): enough to save over the server version.
  func encodedSystemFields() -> Data {
    let coder = NSKeyedArchiver(requiringSecureCoding: true)
    encodeSystemFields(with: coder)
    coder.finishEncoding()
    return coder.encodedData
  }

  static func fromSystemFields(_ data: Data) -> CKRecord? {
    guard let coder = try? NSKeyedUnarchiver(forReadingFrom: data) else { return nil }
    coder.requiresSecureCoding = true
    defer { coder.finishDecoding() }
    return CKRecord(coder: coder)
  }
}
