import XCTest

/// Drives the real app on the simulator: onboarding, "Find notes in Photos", Sort, Create all, and the
/// Apple Notes Shortcut hand-off (`openstudy://import-notes` with notes on the clipboard).
/// Photos: add the test media first (`xcrun simctl addmedia booted ios/OpenStudyAppTests/Media/*`).
final class ImportFlowUITests: XCTestCase {
    let shots = ProcessInfo.processInfo.environment["SHOTS_DIR"]

    override func setUp() { continueAfterFailure = false }

    private func button(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    /// Taps once the element exists and can be hit (screens slide in, so an early tap can land mid-transition).
    private func tap(_ app: XCUIApplication, _ label: String, timeout: TimeInterval = 10) {
        let b = button(app, label)
        XCTAssertTrue(b.waitForExistence(timeout: timeout), "no button \(label): \(labels(app))")
        let deadline = Date().addingTimeInterval(timeout)
        while !b.isHittable && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.2)) }
        RunLoop.current.run(until: Date().addingTimeInterval(0.4))
        b.tap()
    }

    /// Multi-select tiles may start selected (onboarding preselects "Books I'm reading"); tap only to turn one on.
    private func select(_ app: XCUIApplication, _ label: String) {
        let b = button(app, label)
        XCTAssertTrue(b.waitForExistence(timeout: 10), "no tile \(label): \(labels(app))")
        if !b.isSelected { tap(app, label) }
    }

    private func labels(_ app: XCUIApplication) -> String {
        (app.staticTexts.allElementsBoundByIndex.map(\.label) + app.buttons.allElementsBoundByIndex.map { "[\($0.label)]" }).joined(separator: " | ")
    }

    private func text(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    private func shot(_ name: String) {
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    /// Taps a system alert button (photo access, paste permission) if one shows up.
    private func allowSystemAlert(_ labels: [String], timeout: TimeInterval = 3) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in labels {
            let b = springboard.buttons[label]
            if b.waitForExistence(timeout: timeout) { b.tap(); return }
        }
    }

    func testOnboardingFindNotesInPhotosSortCreateAll() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-screen", "welcome", "-noAccountServer"]
        app.launch()

        tap(app, "Get started")
        select(app, "Books I'm reading")
        tap(app, "Continue")
        select(app, "Remember the big ideas")
        tap(app, "Continue")
        select(app, "Quick taps")
        tap(app, "Continue")
        tap(app, "XP")
        tap(app, "Continue")
        tap(app, "Not now")
        XCTAssertTrue(button(app, "Add files or photos").waitForExistence(timeout: 5))
        shot("onboarding-last")
        tap(app, "Add files or photos")

        let find = button(app, "Find notes in Photos")
        XCTAssertTrue(find.waitForExistence(timeout: 5))
        shot("import-sheet")
        tap(app, "Find notes in Photos")
        allowSystemAlert(["Allow Full Access", "Allow Access to All Photos", "Allow"])
        let result = text(app, "Found ")
        XCTAssertTrue(result.waitForExistence(timeout: 180), "Photos sweep never finished: \(labels(app))")
        XCTAssertTrue(result.label.hasPrefix("Checked "), result.label)
        shot("photos-sweep-done")

        let sort = button(app, "Sort ")
        XCTAssertTrue(sort.waitForExistence(timeout: 5))
        tap(app, "Sort ")
        let summary = text(app, "Looks like")
        XCTAssertTrue(summary.waitForExistence(timeout: 10))
        XCTAssertTrue(summary.label.contains("1 book"), summary.label)
        XCTAssertTrue(summary.label.contains("1 word list"), summary.label)
        shot("sort")

        let createAll = button(app, "Create all")
        XCTAssertTrue(createAll.waitForExistence(timeout: 5))
        tap(app, "Create all")
        XCTAssertTrue(text(app, "Atomic Habits").waitForExistence(timeout: 60))
        XCTAssertTrue(text(app, "Words").waitForExistence(timeout: 5))
        shot("home-after-create-all")
    }

    func testShortcutNotesHandOff() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demo", "-noAccountServer"]
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))

        UIPasteboard.general.string = """
        === OpenStudy note ===
        Title: Stoicism
        Folder: Philosophy
        Stoicism
        Virtue is the only good, said the Stoics, and reason is our guide through every hardship we face in life.
        === OpenStudy note ===
        Title: Vocab
        Folder:
        sonder - realizing others have full lives
        limerence - the state of being infatuated
        petrichor - the smell of rain on dry earth
        """
        // Through the system, like the Shortcut's Open URL action (not XCUIApplication.open).
        XCUIDevice.shared.system.open(URL(string: "openstudy://import-notes")!)
        // iOS confirms a link opened from outside the app, then asks before the app reads what another app copied.
        shot("after-open-url")
        allowSystemAlert(["Open"], timeout: 5)
        shot("after-open-prompt")
        allowSystemAlert(["Allow Paste"], timeout: 5)
        shot("after-paste-prompt")
        let done = text(app, "Added 2 pages from 2 notes.")
        XCTAssertTrue(done.waitForExistence(timeout: 10), labels(app))
        shot("shortcut-import")
        XCTAssertTrue(button(app, "Sort 2 new pages").exists)
    }
}
