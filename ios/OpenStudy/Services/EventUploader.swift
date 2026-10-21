import Combine
import Foundation
import UIKit

/// Sends library events to `POST /api/events` (spec 12.3): counts and categories only, never page
/// text. Debounced after each new event, and on launch and when the app goes to the background.
/// A failed send keeps the cursor, so the same events go next time.
@MainActor
final class EventUploader: ObservableObject {
    static let shared = EventUploader()

    private enum Key {
        static let installId = "usage.installId"
        static let cursor = "usage.cursor"
        static let share = "usage.share"
    }

    private weak var store: Store?
    private var watch: AnyCancellable?
    private var sending = false
    private var started = false

    /// "Share usage data" in Profile. On by default.
    @Published var share: Bool = UserDefaults.standard.object(forKey: Key.share) as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(share, forKey: Key.share)
            // Back on: start from now, so events logged while it was off stay private.
            if share, !oldValue { cursor = Usage.Cursor(t: ISO.now()) }
        }
    }

    var installId: String {
        if let id = UserDefaults.standard.string(forKey: Key.installId) { return id }
        let id = UUID().uuidString.lowercased()
        UserDefaults.standard.set(id, forKey: Key.installId)
        return id
    }

    private var cursor: Usage.Cursor? {
        get { UserDefaults.standard.data(forKey: Key.cursor).flatMap { try? JSONDecoder().decode(Usage.Cursor.self, from: $0) } }
        set { UserDefaults.standard.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: Key.cursor) }
    }

    /// Off without a server (billing off) and in UI tests (-noAccountServer clears the server).
    var enabled: Bool { ServerConfig.base != nil }

    func start(store: Store) {
        guard !started, enabled else { return }
        started = true
        self.store = store
        store.library.log("app_open")
        watch = store.$library.map(\.events.count).removeDuplicates().dropFirst()
            .debounce(for: .seconds(3), scheduler: RunLoop.main)
            .sink { [weak self] _ in Task { await self?.flush() } }
        Task { await flush() }
    }

    /// Sends everything after the cursor, a batch at a time.
    func flush() async {
        guard enabled, share, !sending, let store, let server = ServerConfig.base else { return }
        sending = true
        defer { sending = false }
        let token = await AccountController.shared.accessToken()
        while true {
            let batch = Usage.pending(store.library.events, after: cursor)
            guard !batch.isEmpty else { return }
            guard await post(batch, server: server, token: token) else { return }
            cursor = Usage.advance(cursor, past: batch)
            if batch.count < Usage.batchSize { return }
        }
    }

    /// Flush with a little background time so a send started as the app closes can finish.
    func flushInBackground() {
        guard enabled, share else { return }
        var task = UIBackgroundTaskIdentifier.invalid
        task = UIApplication.shared.beginBackgroundTask { UIApplication.shared.endBackgroundTask(task) }
        Task {
            await flush()
            UIApplication.shared.endBackgroundTask(task)
        }
    }

    private struct Payload: Encodable {
        var installId: String
        var platform = "ios"
        var appVersion: String
        var events: [LibraryEvent]
    }

    private func post(_ events: [LibraryEvent], server: URL, token: String?) async -> Bool {
        var r = URLRequest(url: server.appendingPathComponent("api/events"))
        r.httpMethod = "POST"
        r.timeoutInterval = 20
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        r.httpBody = try? JSONEncoder().encode(Payload(installId: installId, appVersion: version, events: events))
        guard let (_, resp) = try? await URLSession.shared.data(for: r) else { return false }
        return (resp as? HTTPURLResponse)?.statusCode == 200
    }
}
