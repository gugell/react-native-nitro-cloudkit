import Foundation

/// Runs async operations one after another: CKSyncEngine fetches and sends must not overlap.
actor SerialQueue {
  private var tail: Task<Void, Never>?

  func run<T>(_ operation: @escaping @Sendable () async throws -> T) async throws -> T {
    let previous = tail
    let task = Task { () async throws -> T in
      await previous?.value
      return try await operation()
    }
    tail = Task { _ = try? await task.value }
    return try await task.value
  }
}

/// Resumes a continuation once, whichever of the work and the timer finishes first.
private final class ResumeOnce<T>: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<T, Error>?

  init(_ continuation: CheckedContinuation<T, Error>) { self.continuation = continuation }

  @discardableResult
  func resume(_ result: Result<T, Error>) -> Bool {
    let pending: CheckedContinuation<T, Error>? = lock.locked {
      defer { continuation = nil }
      return continuation
    }
    pending?.resume(with: result)
    return pending != nil
  }
}

/// Fails with `timeout` after `seconds`, even when `operation` never returns (it is cancelled).
func withTimeout<T>(
  seconds: Double,
  _ what: String,
  _ operation: @escaping @Sendable () async throws -> T
) async throws -> T {
  try await withCheckedThrowingContinuation { continuation in
    let once = ResumeOnce(continuation)
    let work = Task {
      do { once.resume(.success(try await operation())) } catch { once.resume(.failure(error)) }
    }
    Task {
      try? await Task.sleep(nanoseconds: UInt64(max(seconds, 1) * 1_000_000_000))
      let failure = CloudKitFailure(.timeout, "\(what) took longer than \(Int(seconds)) s")
      if once.resume(.failure(failure)) { work.cancel() }
    }
  }
}
