import Foundation

/// Thread-safe set of JS listeners. Nitro callbacks may be called from any thread.
final class ListenerSet<Value>: @unchecked Sendable {
  private let lock = NSLock()
  private var listeners: [UUID: (Value) -> Void] = [:]

  func add(_ listener: @escaping (Value) -> Void) -> UUID {
    let id = UUID()
    lock.locked { listeners[id] = listener }
    return id
  }

  func remove(_ id: UUID) {
    _ = lock.locked { listeners.removeValue(forKey: id) }
  }

  func emit(_ value: Value) {
    let current = lock.locked { Array(listeners.values) }
    for listener in current { listener(value) }
  }
}
