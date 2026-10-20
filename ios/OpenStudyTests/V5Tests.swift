import XCTest

/// Spec section 11: picture cards, source images and the profile helpers. Mirrors web/src/engine/v5.test.ts.
final class V5Tests: XCTestCase {
    let now = ISO.date("2026-10-20T12:00:00.000Z")!

    func fact(_ s: String, _ pageId: String?) -> BuiltCard {
        let w = s.split(separator: " ").map(String.init)
        return BuiltCard(pageId: pageId, statement: s, cloze: w[1], question: s, answer: w[1], distractors: [], falseStatement: s)
    }

    lazy var result = BuildResult(lessons: [
        BuiltLesson(title: "Cells", summary: "", cards: [fact("Mitochondria make ATP for the cell.", "p1"), fact("Ribosomes build proteins from amino acids.", "p2")]),
        BuiltLesson(title: "Stoics", summary: "", cards: [fact("Virtue is the only good for the Stoics.", "p3")]),
    ], quotes: [])

    func photo(_ id: String, _ text: String, heading: String? = nil, kind: String = "photo", image: String? = "img") -> Page {
        Page(id: id, kind: kind, text: text, image: image, heading: heading)
    }

    // MARK: Building picture cards

    func testJoinsLessonWithItsPage() {
        let out = PictureCards.attach(result, pages: [photo("p1", "Mitochondria diagram")])
        XCTAssertEqual(out.lessons[0].pictures, [BuiltPicture(pageId: "p1", statement: "Mitochondria diagram", question: "What does this page show?")])
        XCTAssertEqual(out.lessons.count, 2)
    }

    func testClosestLessonElsePictures() {
        let out = PictureCards.attach(result, pages: [photo("w1", "Stoics virtue chart", heading: "Virtue"), photo("w2", "Grocery prices table")])
        XCTAssertEqual(out.lessons[1].pictures.map(\.pageId), ["w1"])
        XCTAssertEqual(out.lessons[1].pictures.first?.question, "What's on this page about Virtue?")
        XCTAssertEqual(out.lessons[2].title, PictureCards.lessonTitle)
        XCTAssertEqual(out.lessons[2].pictures.map(\.pageId), ["w2"])
    }

    func testOnlyPhotosAndLowTextScreenshots() {
        let pages = [
            photo("a", "no image", image: nil),
            photo("b", String(repeating: "word ", count: 60), kind: "screenshot"),
            photo("c", "A small diagram", kind: "screenshot"),
            photo("d", "A note", kind: "note"),
        ]
        let out = PictureCards.attach(BuildResult(lessons: [], quotes: []), pages: pages)
        XCTAssertEqual(out.lessons.flatMap(\.pictures).map(\.pageId), ["c"])
    }

    func testTwelvePerLesson() {
        let pages = (0..<14).map { photo("q\($0)", "Photo \($0)") }
        let out = PictureCards.attach(BuildResult(lessons: [], quotes: []), pages: pages)
        XCTAssertEqual(out.lessons.map(\.title), ["Pictures", "Pictures 2"])
        XCTAssertEqual(out.lessons.map(\.pictures.count), [12, 2])
    }

    func testPhotoBuildsPictureCardThroughFactory() {
        let text = "Photosynthesis turns light into sugar in the leaf.\nChlorophyll absorbs the red and blue light in plants.\nThe Calvin cycle fixes carbon dioxide into sugar molecules."
        let built = LessonFactory.build(pages: [photo("ph", text, heading: "Photosynthesis")], title: "Plants", author: nil, type: "class")
        var lib = Library()
        let p = lib.createProject(title: "Plants", author: nil, pageIds: [], build: built, focus: "ideas", quotes: nil, type: "class", now: now)
        let pics = lib.cards(ofProject: p.id).filter(\.isPicture)
        XCTAssertEqual(pics.count, 1)
        XCTAssertEqual(pics.first?.pageId, "ph")
        XCTAssertEqual(pics.first?.question, "What's on this page about Photosynthesis?")
        XCTAssertNotEqual(lib.lessons.first { $0.id == pics.first?.lessonId }?.title, PictureCards.lessonTitle)
    }

    func testWordListPhotosNeverBecomePictures() {
        var p = photo("w", "sonder - a feeling\nlimerence - a crush")
        p.words = [WordEntry(term: "sonder", definition: "a feeling"), WordEntry(term: "limerence", definition: "a crush")]
        let built = LessonFactory.build(pages: [p], title: "Words", author: nil, type: "other")
        XCTAssertTrue(built.lessons.flatMap(\.pictures).isEmpty)
    }

    // MARK: Sessions

    lazy var lesson = Lesson(id: "L", projectId: "P", title: "Cells", summary: "", order: 0)
    lazy var facts: [Card] = (0..<10).map { i in
        Card(id: "f\(i)", lessonId: "L", projectId: "P", kind: "fact", statement: "Fact number \(i) says the organelle\(i) matters for the cell.",
             cloze: "organelle\(i)", question: "Fact number \(i) says the ____ matters for the cell.", answer: "organelle\(i)",
             distractors: ["alpha", "beta", "gamma"], falseStatement: "Fact number \(i) says the alpha matters for the cell.", srs: .fresh(now: now))
    }
    lazy var pics: [Card] = (0..<6).map { i in
        Card(id: "p\(i)", lessonId: "L", projectId: "P", pageId: "pg\(i)", kind: "picture", statement: "Diagram \(i)", question: "What does this page show?", srs: .fresh(now: now))
    }

    func testSessionCapsPicturesNeverFirst() {
        for seed in 1..<40 {
            var rng = SeededRNG(seed: UInt64(seed))
            let ex = SessionBuilder.build(lesson: lesson, cards: facts + pics, profile: Profile(), now: now, rng: &rng)
            XCTAssertEqual(ex.count, 10)
            XCTAssertNotEqual(ex.first?.kind, .picture)
            XCTAssertEqual(ex.filter { $0.kind == .picture }.count, 3)
            XCTAssertFalse(ex.filter { $0.kind != .picture }.flatMap(\.cardIds).contains { $0.hasPrefix("p") })
            XCTAssertTrue(ex.filter { $0.kind == .picture }.allSatisfy { $0.pageId?.hasPrefix("pg") == true })
        }
    }

    func testPictureOnlyLessonPlaysThemAll() {
        var rng = SeededRNG(seed: 3)
        let ex = SessionBuilder.build(lesson: lesson, cards: pics, profile: Profile(), now: now, rng: &rng)
        XCTAssertEqual(ex.map(\.kind), Array(repeating: .picture, count: 6))
    }

    func testPracticeIncludesDuePictures() {
        let due = (facts + pics).map { c -> Card in
            var c = c
            c.srs = Srs(state: "review", ease: 2.5, interval: 1, due: "2026-10-19T00:00:00.000Z", reps: 1, lapses: 0)
            return c
        }
        for seed in 1..<20 {
            var rng = SeededRNG(seed: UInt64(seed))
            let ex = SessionBuilder.practice(cards: due, profile: Profile(), now: now, rng: &rng)
            XCTAssertEqual(ex.count, 12)
            XCTAssertNotEqual(ex.first?.kind, .picture)
            XCTAssertEqual(ex.filter { $0.kind == .picture }.count, 3)
        }
    }

    func testPracticeTestSkipsPictures() {
        var lib = Library()
        lib.projects = [Project(id: "P", title: "Cells", color: .blue)]
        lib.lessons = [lesson]
        lib.cards = facts + pics
        var rng = SeededRNG(seed: 5)
        let ex = PracticeTest.build(project: lib.projects[0], lib: lib, rng: &rng)
        XCTAssertFalse(ex.contains { $0.kind == .picture })
        XCTAssertEqual(ex.count, 10)
    }

    // MARK: Loading and profile

    func testPictureCardsAndNameRoundTrip() throws {
        var lib = Library()
        lib.profile.name = "Sam"
        lib.cards = [pics[0], facts[0]]
        let data = try JSONEncoder().encode(lib)
        let back = try JSONDecoder().decode(Library.self, from: data)
        XCTAssertEqual(back.profile.name, "Sam")
        XCTAssertEqual(back.cards.first?.kind, "picture")
        XCTAssertTrue(back.cards.first!.isPicture)
        // Old JSON without a name still loads.
        let old = try JSONDecoder().decode(Profile.self, from: Data(#"{"onboarded":true,"goals":["ideas"]}"#.utf8))
        XCTAssertNil(old.name)
    }

    func testSubscriptionLine() {
        let d = { ISO.date($0)! }
        XCTAssertEqual(ProfileInfo.subscriptionLine(Entitlement(active: true, status: "comp", source: "comp"), now: now), "Free for you")
        XCTAssertEqual(ProfileInfo.subscriptionLine(Entitlement(active: true, status: "trialing", trialEndsAt: d("2026-10-25T12:00:00.000Z")), now: now), "Free trial: 5 days left")
        XCTAssertEqual(ProfileInfo.subscriptionLine(Entitlement(active: true, status: "trialing", trialEndsAt: d("2026-10-21T12:00:00.000Z")), now: now), "Free trial: 1 day left")
        XCTAssertEqual(ProfileInfo.subscriptionLine(Entitlement(active: true, status: "active", renewsAt: d("2026-11-20T12:00:00.000Z")), now: now), "OpenStudy Plus, renews Nov 20")
        XCTAssertEqual(ProfileInfo.subscriptionLine(Entitlement(active: false, status: "expired"), now: now), "Not subscribed")
        XCTAssertEqual(ProfileInfo.subscriptionLine(Entitlement(active: false, status: "none"), now: now), "Not subscribed")
    }

    func testStatsAndAvatar() {
        var lib = Library()
        lib.projects = [Project(id: "s", title: "Sample", color: .blue, sample: true), Project(id: "r", title: "Real", color: .red)]
        lib.cards = Array(facts.prefix(5))
        for i in 0..<3 { lib.cards[i].srs.reps = 1 }
        lib.events = [LibraryEvent(t: "2026-10-02T10:00:00.000Z", name: "session_done", props: nil),
                      LibraryEvent(t: "2026-10-01T09:00:00.000Z", name: "onboarding_done", props: nil)]
        let s = ProfileInfo.stats(lib, now: now)
        XCTAssertEqual(s.projects, 1)
        XCTAssertEqual(s.cardsLearned, 3)
        XCTAssertEqual(s.sessions, 1)
        XCTAssertEqual(s.memberSince, ISO.date("2026-10-01T09:00:00.000Z"))
        XCTAssertEqual(ProfileInfo.avatarInitial(name: "sam", email: "x@y.z"), "S")
        XCTAssertEqual(ProfileInfo.avatarInitial(name: "", email: "ann@x.com"), "A")
        XCTAssertNil(ProfileInfo.avatarInitial(name: nil, email: nil))
    }
}
