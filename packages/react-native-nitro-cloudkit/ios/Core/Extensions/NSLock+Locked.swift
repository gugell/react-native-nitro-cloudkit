import Foundation

extension NSLock {
  /// `withLock` before iOS 16.
  func locked<T>(_ body: () throws -> T) rethrows -> T {
    lock()
    defer { unlock() }
    return try body()
  }
}
