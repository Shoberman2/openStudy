import StoreKit
import StoreKitTest
import XCTest
@testable import OpenStudy

/// OpenStudy Plus through StoreKit 2 against the local OpenStudy.storekit configuration (spec 11.5).
@MainActor
final class StoreKitTests: XCTestCase {
    var session: SKTestSession!

    override func setUp() async throws {
        session = try SKTestSession(configurationFileNamed: "OpenStudy")
        session.resetToDefaultState()
        session.clearTransactions()
        session.disableDialogs = true
    }

    func testProductIsTenDollarsMonthlyWithSevenDayTrial() async throws {
        let products = try await Product.products(for: [Billing.productId])
        let product = try XCTUnwrap(products.first)
        XCTAssertEqual(product.price, 10)
        XCTAssertEqual(product.type, .autoRenewable)
        let sub = try XCTUnwrap(product.subscription)
        XCTAssertEqual(sub.subscriptionPeriod.unit, .month)
        XCTAssertEqual(sub.subscriptionPeriod.value, 1)
        let intro = try XCTUnwrap(sub.introductoryOffer)
        XCTAssertEqual(intro.paymentMode, .freeTrial)
        XCTAssertEqual(intro.period.unit, .week)
        XCTAssertEqual(intro.period.value, 1)
        let eligible = await sub.isEligibleForIntroOffer
        XCTAssertTrue(eligible)
    }

    func testPurchaseCarriesTheAccountIdAndStartsTheTrial() async throws {
        let products = try await Product.products(for: [Billing.productId])
        let product = try XCTUnwrap(products.first)
        let account = UUID()
        let result = try await product.purchase(options: [.appAccountToken(account)])
        guard case .success(let verification) = result, case .verified(let tx) = verification else { return XCTFail("purchase failed: \(result)") }
        XCTAssertEqual(tx.appAccountToken, account)
        XCTAssertEqual(tx.productID, Billing.productId)
        if #available(iOS 17.2, *) {
            XCTAssertEqual(tx.offer?.type, .introductory)
            XCTAssertEqual(tx.offer?.paymentMode, .freeTrial)
        }
        XCTAssertFalse(verification.jwsRepresentation.isEmpty)
        await tx.finish()
        let eligible = await product.subscription?.isEligibleForIntroOffer
        XCTAssertEqual(eligible, false, "one free trial per Apple ID")
    }

    func testStoreServiceKeepsThePurchaseUnfinishedWhenTheServerHasNotRecordedIt() async throws {
        // No account server in tests: the purchase must stay unfinished so Transaction.updates retries it.
        let shop = StoreService()
        let r = await shop.purchase(accountId: UUID().uuidString)
        XCTAssertEqual(r, .failed)
        var unfinished = 0
        for await v in Transaction.unfinished { if case .verified(let tx) = v, tx.productID == Billing.productId { unfinished += 1 } }
        XCTAssertEqual(unfinished, 1)
    }

    func testPurchaseNeedsAnAccount() async {
        let r = await StoreService().purchase(accountId: "not-a-uuid")
        XCTAssertEqual(r, .unavailable)
    }

    func testPKCEChallengeMatchesRFC7636() {
        XCTAssertEqual(SupabaseAuth.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        XCTAssertGreaterThanOrEqual(SupabaseAuth.randomVerifier().count, 43)
    }

    func testSignInLinkParsing() {
        XCTAssertEqual(SupabaseAuth.callbackCode(URL(string: "openstudy://auth-callback?code=abc-123")!), "abc-123")
        XCTAssertNil(SupabaseAuth.callbackCode(URL(string: "openstudy://import-notes")!))
        XCTAssertNil(SupabaseAuth.callbackCode(URL(string: "https://evil.example/auth-callback?code=x")!))
    }
}

/// End to end against a running OpenStudy server and the real Supabase project: a StoreKit purchase
/// in the simulator is verified by the server and unlocks the account. Runs only when the runner
/// passes OPENSTUDY_E2E_SERVER and OPENSTUDY_E2E_TOKEN/USER (TEST_RUNNER_ prefixed for xcodebuild).
@MainActor
final class BillingEndToEndTests: XCTestCase {
    func testPurchaseIsRecordedOnTheServer() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let base = env["OPENSTUDY_E2E_SERVER"].flatMap(URL.init(string:)), let token = env["OPENSTUDY_E2E_TOKEN"],
              let user = env["OPENSTUDY_E2E_USER"].flatMap(UUID.init(uuidString:)) else { throw XCTSkip("no e2e server") }
        let session = try SKTestSession(configurationFileNamed: "OpenStudy")
        session.resetToDefaultState()
        session.clearTransactions()
        session.disableDialogs = true

        func me() async throws -> [String: Any] {
            var r = URLRequest(url: base.appendingPathComponent("api/me"))
            r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (data, _) = try await URLSession.shared.data(for: r)
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }
        let meBefore = try await me()
        let before = try XCTUnwrap(meBefore["entitlement"] as? [String: Any])
        XCTAssertEqual(before["status"] as? String, "none")
        XCTAssertEqual(before["active"] as? Bool, false)

        let products = try await Product.products(for: [Billing.productId])
        let product = try XCTUnwrap(products.first)
        let result = try await product.purchase(options: [.appAccountToken(user)])
        guard case .success(let verification) = result, case .verified(let tx) = verification else { return XCTFail("purchase failed") }

        func post(_ jws: String, token: String) async throws -> Int {
            var r = URLRequest(url: base.appendingPathComponent("api/apple/transaction"))
            r.httpMethod = "POST"
            r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try JSONEncoder().encode(["jws": jws])
            let (_, resp) = try await URLSession.shared.data(for: r)
            return (resp as? HTTPURLResponse)?.statusCode ?? 0
        }
        let posted = try await post(verification.jwsRepresentation, token: token)
        XCTAssertEqual(posted, 200)
        let meAfter = try await me()
        let after = try XCTUnwrap(meAfter["entitlement"] as? [String: Any])
        XCTAssertEqual(after["status"] as? String, "trialing")
        XCTAssertEqual(after["source"] as? String, "apple")
        XCTAssertEqual(after["active"] as? Bool, true)
        XCTAssertNotNil(after["trialEndsAt"] as? String)

        // A forged token in the JWS cannot be replayed onto another account.
        if let other = env["OPENSTUDY_E2E_OTHER_TOKEN"] {
            let replay = try await post(verification.jwsRepresentation, token: other)
            XCTAssertEqual(replay, 409)
        }
        // In the Xcode environment the server cannot check Apple's signature (local StoreKit signs
        // with a local key), which is why it is accepted only in development. Garbage still fails.
        let garbage = try await post("not.a.jws", token: token)
        XCTAssertEqual(garbage, 400)
        await tx.finish()
    }
}
