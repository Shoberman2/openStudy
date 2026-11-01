import XCTest

/// Spec 14: OpenStudy Plus plans, the free tier and the study check.
final class V10Tests: XCTestCase {
    let may = ISO.date("2026-05-14T12:00:00.000Z")!

    func testPlansUseOneGroupsProductIds() {
        XCTAssertEqual(PlusPlan.monthly.productId, "com.openstudy.shelf.plus.monthly")
        XCTAssertEqual(PlusPlan.yearly.productId, "com.openstudy.shelf.plus.yearly")
        XCTAssertEqual(PlusPlan.from(productId: "com.openstudy.shelf.plus.yearly"), .yearly)
        XCTAssertEqual(Billing.entitlementId, "pro")
        XCTAssertEqual(Billing.productIds.count, 2)
    }

    func testPriceLines() {
        XCTAssertEqual(PlusGate.priceLine(plan: .yearly, price: nil, trial: true), "7 days free, then $59.99 a year.")
        XCTAssertEqual(PlusGate.priceLine(plan: .monthly, price: "$7.99", trial: false), "$7.99 a month.")
        XCTAssertEqual(PlusGate.yearlySaving(monthly: 7.99, yearly: 59.99), 37)
        XCTAssertNil(PlusGate.yearlySaving(monthly: 4, yearly: 59.99))
    }

    func testFreeTierAllowsThreeStudySetsAndTenQuizzesAMonth() {
        var u = MonthlyUsage(month: MonthlyUsage.monthKey(may))
        XCTAssertTrue(PlusGate.allowed(.studySet, plus: false, usage: u, count: 3))
        XCTAssertFalse(PlusGate.allowed(.studySet, plus: false, usage: u, count: 4))
        u.studySets = 3; u.quizzes = 10
        XCTAssertFalse(PlusGate.allowed(.studySet, plus: false, usage: u))
        XCTAssertFalse(PlusGate.allowed(.quiz, plus: false, usage: u))
        XCTAssertTrue(PlusGate.allowed(.quiz, plus: false, sample: true, usage: u), "sample material is always free")
        XCTAssertTrue(PlusGate.allowed(.quiz, plus: true, usage: u))
        XCTAssertEqual(u.quizzesLeft, 0)
        XCTAssertFalse(PlusGate.allowed(.fullReport, plus: false, usage: MonthlyUsage(month: "2026-05")))
        XCTAssertFalse(PlusGate.allowed(.export, plus: false, usage: MonthlyUsage(month: "2026-05")))
        XCTAssertTrue(PlusGate.allowed(.export, plus: true, usage: MonthlyUsage(month: "2026-05")))
    }

    func testUsageResetsEachMonth() {
        let u = MonthlyUsage(month: MonthlyUsage.monthKey(may), studySets: 3, quizzes: 9)
        XCTAssertEqual(u.current(may), u)
        let june = Calendar.current.date(byAdding: .month, value: 1, to: may)!
        XCTAssertEqual(u.current(june).quizzes, 0)
        XCTAssertEqual(u.current(june).studySetsLeft, PlusLimits.freeStudySets)
    }

    func testPaywallReasons() {
        XCTAssertEqual(PlusGate.reason("create_all"), "You've made your 3 free study sets this month.")
        XCTAssertEqual(PlusGate.reason("practice"), "You've used your 10 free quizzes this month.")
        XCTAssertNil(PlusGate.reason("profile"))
    }

    func testAIWrittenOnlyForModelSources() {
        var lib = Library()
        lib.log("questions_written", ["source": "server", "count": 4, "lessonId": "l1"])
        lib.log("questions_written", ["source": "none", "count": 0, "lessonId": "l2"])
        XCTAssertTrue(lib.aiWritten(lessonId: "l1"))
        XCTAssertFalse(lib.aiWritten(lessonId: "l2"))
        XCTAssertFalse(lib.aiWritten(lessonId: nil))
    }

    func testStudyCheckFlagsCrammingAndOverconfidence() {
        var lib = Library()
        lib.profile.practice = ["flash"]
        let t = ISO.string(may)
        for _ in 0..<5 { lib.events.append(LibraryEvent(t: t, name: "session_done", props: ["accuracy": 0.95, "lessonId": "l1"])) }
        lib.events.append(LibraryEvent(t: t, name: "test_done", props: ["accuracy": 0.6]))
        let items = StudyCheck.run(lib, now: may)
        func status(_ id: String) -> StudyCheck.Status? { items.first { $0.id == id }?.status }
        XCTAssertEqual(status("spacing"), .flag)
        XCTAssertEqual(status("confidence"), .flag)
        XCTAssertEqual(status("variety"), .flag)
        XCTAssertEqual(status("saving"), .unknown)
        XCTAssertEqual(StudyCheck.flagged(items), 3)
        XCTAssertTrue(StudyCheck.report(items, now: may).hasSuffix("Not medical or research advice."))
    }

    func testStudyCheckNeedsDataBeforeJudging() {
        let items = StudyCheck.run(Library(), now: may)
        XCTAssertEqual(items.first { $0.id == "spacing" }?.status, .unknown)
        XCTAssertEqual(items.first { $0.id == "confidence" }?.status, .unknown)
        XCTAssertEqual(items.count, 5)
    }
}
