import XCTest
@testable import RelayCore

final class SimulationTests: XCTestCase {
    private func investigating(_ scenario: Scenario = .addressSave) -> Simulation {
        var state = Simulation(scenario: scenario)
        state.startCall()
        XCTAssertTrue(state.submit("Cannot save the address"))
        XCTAssertTrue(state.submit("Save the customer's address"))
        XCTAssertTrue(state.startInvestigation(report: state.report, expected: state.expected))
        return state
    }

    func testEndCallDoesNotCancelInvestigation() {
        var state = investigating()
        state.endCall()
        state.advance()
        state.advance()
        XCTAssertEqual(state.call, .ended)
        XCTAssertEqual(state.investigation, .awaitingApproval)
        XCTAssertEqual(state.evidence.count, 2)
    }

    func testStopPreventsLaterEventsAndKeepsEvidence() {
        var state = investigating()
        state.advance()
        state.stopInvestigation()
        state.advance()
        XCTAssertEqual(state.investigation, .stopped)
        XCTAssertEqual(state.call, .active)
        XCTAssertEqual(state.evidence.map(\.id), ["context"])
        XCTAssertFalse(state.decide(approve: true, expectedRevision: state.revision))
    }

    func testApprovalIsScopedAndCannotReplay() {
        var state = investigating()
        XCTAssertFalse(state.decide(approve: true, expectedRevision: state.revision))
        state.advance()
        state.advance()
        let revision = state.revision
        XCTAssertFalse(state.decide(approve: true, expectedRevision: revision - 1))
        XCTAssertTrue(state.decide(approve: true, expectedRevision: revision))
        XCTAssertFalse(state.decide(approve: true, expectedRevision: revision))
        state.advance()
        state.advance()
        XCTAssertEqual(state.evidence.count, 4)
        XCTAssertEqual(state.investigation, .complete)
        XCTAssertTrue(state.evidence.allSatisfy { $0.content.contains("SIMULATION") })
    }

    func testDeclinePreservesFindingsWithoutPatch() {
        var state = investigating()
        state.advance()
        state.advance()
        XCTAssertTrue(state.decide(approve: false, expectedRevision: state.revision))
        state.advance()
        XCTAssertEqual(state.investigation, .declined)
        XCTAssertEqual(state.evidence.map(\.id), ["context", "observation"])
    }

    func testAccessFailureDoesNotProduceFindingsOrRepair() {
        var state = investigating(.unavailableTarget)
        state.advance()
        state.advance()
        XCTAssertEqual(state.investigation, .blocked)
        XCTAssertEqual(state.evidence.map(\.id), ["context"])
        XCTAssertFalse(state.decide(approve: true, expectedRevision: state.revision))
    }

    func testValidatedDraftAndDuplicateStart() {
        var state = Simulation()
        XCTAssertFalse(state.submit("address"))
        state.startCall()
        XCTAssertFalse(state.submit(" \n"))
        XCTAssertFalse(state.submit(String(repeating: "x", count: 2_001)))
        XCTAssertTrue(state.submit("Original report"))
        XCTAssertTrue(state.submit("Expected behavior"))
        XCTAssertFalse(state.startInvestigation(report: "", expected: state.expected))
        XCTAssertTrue(state.startInvestigation(report: "Reviewed report", expected: state.expected))
        XCTAssertEqual(state.report, "Reviewed report")
        XCTAssertFalse(state.startInvestigation(report: "Duplicate", expected: "Duplicate"))
        XCTAssertEqual(state.revision, 1)
    }

    func testRoundTripPreservesIdentityAndApprovalState() throws {
        var state = investigating()
        state.advance()
        state.advance()
        state.interruptCall()
        let restored = try JSONDecoder().decode(Simulation.self, from: JSONEncoder().encode(state))
        XCTAssertEqual(restored, state)
        XCTAssertEqual(restored.investigation, .awaitingApproval)
        XCTAssertEqual(restored.call, .interrupted)
    }
}
