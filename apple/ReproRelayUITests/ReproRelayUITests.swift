import XCTest

@MainActor
final class ReproRelayUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() async throws {
        try await super.setUp()
        await MainActor.run {
            continueAfterFailure = false
            app = XCUIApplication()
            app.launchArguments = ["--ui-testing", "--reset-simulation"]
            app.launch()
        }
    }

    private func reveal(_ element: XCUIElement) {
        for _ in 0..<8 {
            if element.exists && element.isHittable { return }
            app.swipeUp()
        }
        XCTAssertTrue(element.waitForExistence(timeout: 3))
        XCTAssertTrue(element.isHittable)
    }

    private func beginInvestigation() {
        app.buttons["open-call"].tap()
        XCTAssertTrue(app.buttons["use-example"].waitForExistence(timeout: 5))
        app.buttons["use-example"].tap()
        app.buttons["send-message"].tap()
        app.buttons["use-example"].tap()
        app.buttons["send-message"].tap()
        let start = app.buttons["start-investigation"]
        reveal(start)
        start.tap()
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testCallToCaseApprovalAndEvidenceSurvivesRelaunch() {
        capture("Home")
        beginInvestigation()
        capture("Call")
        app.buttons["end-call"].tap()
        let homeCase = app.buttons["home-case"]
        XCTAssertTrue(homeCase.waitForExistence(timeout: 5))
        reveal(homeCase)
        homeCase.tap()
        let approve = app.buttons["review-approval"]
        XCTAssertTrue(approve.waitForExistence(timeout: 10))
        reveal(approve)
        capture("Decision")
        approve.tap()
        app.buttons["Approve simulated repair"].tap()
        let patch = app.buttons["evidence-patch"]
        XCTAssertTrue(patch.waitForExistence(timeout: 10))
        reveal(patch)
        patch.tap()
        XCTAssertTrue(app.staticTexts["evidence-content"].label.contains("No actual repository"))
        capture("Patch evidence")

        app.terminate()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        reveal(app.buttons["home-case"])
        XCTAssertTrue(app.staticTexts["Simulated checks passed"].exists)
        app.buttons["home-case"].tap()
        let checks = app.buttons["evidence-checks"]
        reveal(checks)
        checks.tap()
        XCTAssertTrue(app.staticTexts["evidence-content"].label.contains("independently_verified: false"))
    }

    func testStopKeepsCaseAndDoesNotEndConversation() {
        beginInvestigation()
        let open = app.buttons["call-open-case"]
        reveal(open)
        open.tap()
        let stop = app.buttons["stop-investigation"]
        reveal(stop)
        stop.tap()
        app.sheets.buttons["Stop investigation"].tap()
        for _ in 0..<3 { app.swipeDown() }
        let stopped = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "Investigation stopped"), object: app.staticTexts["case-status"])
        XCTAssertEqual(XCTWaiter.wait(for: [stopped], timeout: 5), .completed)
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(app.buttons["end-call"].waitForExistence(timeout: 3))
    }

    func testUnavailableTargetAndReset() {
        app.tabBars.buttons["Connections"].tap()
        let picker = app.buttons["scenario-picker"]
        reveal(picker)
        picker.tap()
        app.buttons["Target access unavailable"].tap()
        app.buttons["reset-simulation"].tap()
        app.buttons["Reset and use selected scenario"].tap()
        app.tabBars.buttons["Home"].tap()
        beginInvestigation()
        app.buttons["end-call"].tap()
        reveal(app.buttons["home-case"])
        app.buttons["home-case"].tap()
        XCTAssertTrue(app.staticTexts["Access is needed"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["review-approval"].exists)
        XCTAssertFalse(app.buttons["evidence-patch"].exists)
        capture("Blocked target")
    }

    func testLargeTextEmptyCasesAndCallControls() {
        app.terminate()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        app.tabBars.buttons["Cases"].tap()
        XCTAssertTrue(app.staticTexts["No cases yet"].exists)
        capture("Large text empty cases")
        app.tabBars.buttons["Home"].tap()
        reveal(app.buttons["open-call"])
        app.buttons["open-call"].tap()
        XCTAssertTrue(app.buttons["end-call"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["end-call"].isHittable)
        capture("Large text call")
        app.buttons["use-example"].tap()
        app.buttons["send-message"].tap()
        app.buttons["use-example"].tap()
        app.buttons["send-message"].tap()
        let start = app.buttons["start-investigation"]
        reveal(start)
        start.tap()
        XCTAssertTrue(app.buttons["call-open-case"].waitForExistence(timeout: 5))
        app.buttons["end-call"].tap()
    }
}
