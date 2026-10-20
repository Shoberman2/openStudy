import Foundation

/// Entitlement rules on the device (spec 11.5): the server's answer in wire form, and the offline
/// grace rule for when the server cannot be reached. Mirrors web/src/engine/billing.ts.
public enum Billing {
    public static let productId = "com.openstudy.shelf.plus.monthly"
    /// How long a cached entitlement is trusted past its end date when the server cannot be reached.
    public static let offlineGrace: TimeInterval = 3 * 86_400

    /// `entitlement` as `GET /api/me` returns it.
    public struct WireEntitlement: Codable, Equatable {
        public var active: Bool
        public var status: String
        public var source: String?
        public var renewsAt: String?
        public var trialEndsAt: String?

        public init(_ e: Entitlement) {
            active = e.active; status = e.status; source = e.source
            renewsAt = e.renewsAt.map(ISO.string); trialEndsAt = e.trialEndsAt.map(ISO.string)
        }

        public var entitlement: Entitlement {
            Entitlement(active: active, status: status, source: source,
                        renewsAt: renewsAt.flatMap(ISO.date), trialEndsAt: trialEndsAt.flatMap(ISO.date))
        }
    }

    public struct Cached: Codable, Equatable {
        public var entitlement: WireEntitlement
        public var userId: String
        public var fetchedAt: String
        public init(entitlement: WireEntitlement, userId: String, fetchedAt: String) {
            self.entitlement = entitlement; self.userId = userId; self.fetchedAt = fetchedAt
        }
    }

    /// The cached entitlement to use offline, or nil when there is none for this account.
    public static func offline(_ cache: Cached?, userId: String?, now: Date = Date()) -> Entitlement? {
        guard let cache, let userId, cache.userId == userId else { return nil }
        var e = cache.entitlement.entitlement
        guard e.active, e.status != "comp" else { return e }
        let end = e.status == "trialing" ? (e.trialEndsAt ?? e.renewsAt) : e.renewsAt
        let base = end ?? ISO.date(cache.fetchedAt) ?? .distantPast
        if base.addingTimeInterval(offlineGrace) <= now { e.active = false }
        return e
    }
}
