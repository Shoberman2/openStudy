import XCTest

/// Offline grace for the cached entitlement (spec 11.5). Mirrors web/src/engine/billing.test.ts.
final class BillingTests: XCTestCase {
    let now = ISO.date("2026-10-20T12:00:00Z")!
    let day: TimeInterval = 86_400

    func cache(_ status: String = "active", renews: TimeInterval? = nil, trialEnds: TimeInterval? = nil, fetched: TimeInterval = 0, user: String = "u1") -> Billing.Cached {
        let e = Entitlement(active: true, status: status, source: "apple",
                            renewsAt: renews.map { now.addingTimeInterval($0) }, trialEndsAt: trialEnds.map { now.addingTimeInterval($0) })
        return Billing.Cached(entitlement: Billing.WireEntitlement(e), userId: user, fetchedAt: ISO.string(now.addingTimeInterval(fetched)))
    }

    func testUsesCacheUntilEndPlusThreeDays() {
        XCTAssertEqual(Billing.offline(cache(renews: -2 * day), userId: "u1", now: now)?.active, true)
        XCTAssertEqual(Billing.offline(cache(renews: -4 * day), userId: "u1", now: now)?.active, false)
        XCTAssertEqual(Billing.offline(cache("trialing", trialEnds: day), userId: "u1", now: now)?.active, true)
    }

    func testIgnoresOtherAccountAndKeepsComp() {
        XCTAssertNil(Billing.offline(cache(), userId: "u2", now: now))
        XCTAssertNil(Billing.offline(nil, userId: "u1", now: now))
        XCTAssertEqual(Billing.offline(cache("comp", fetched: -90 * day), userId: "u1", now: now)?.active, true)
    }

    func testWireRoundTrip() throws {
        let json = #"{"active":true,"status":"trialing","source":"stripe","trialEndsAt":"2026-10-27T12:00:00.000Z"}"#
        let w = try JSONDecoder().decode(Billing.WireEntitlement.self, from: Data(json.utf8))
        XCTAssertEqual(w.entitlement.status, "trialing")
        XCTAssertEqual(w.entitlement.trialEndsAt, now.addingTimeInterval(7 * day))
        XCTAssertEqual(ProfileInfo.subscriptionLine(w.entitlement, now: now), "Free trial: 7 days left")
    }
}
