import Foundation

public enum CallPhase: String, Codable, Sendable {
    case idle, active, interrupted, ended
}

public enum InvestigationPhase: String, Codable, Sendable {
    case draft, readingContext, inspecting, awaitingApproval, repairing, complete, blocked, stopped, declined

    public var title: String {
        switch self {
        case .draft: "Ready to investigate"
        case .readingContext: "Reading case context"
        case .inspecting: "Inspecting the address form"
        case .awaitingApproval: "Your decision is needed"
        case .repairing: "Checking the proposed repair"
        case .complete: "Simulated checks passed"
        case .blocked: "Target access unavailable"
        case .stopped: "Investigation stopped"
        case .declined: "Repair declined"
        }
    }

    public var isAdvancing: Bool {
        [.readingContext, .inspecting, .repairing].contains(self)
    }
}

public enum ConversationStep: String, Codable, Sendable { case report, clarification, review }
public enum Scenario: String, Codable, CaseIterable, Sendable {
    case addressSave, unavailableTarget
    public var title: String { self == .addressSave ? "Address save failure" : "Target access unavailable" }
}

public struct TranscriptEntry: Identifiable, Codable, Equatable, Sendable {
    public let id: UUID
    public let speaker: String
    public let text: String
    init(_ speaker: String, _ text: String) {
        id = UUID()
        self.speaker = speaker
        self.text = text
    }
}

public struct Evidence: Identifiable, Codable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let kind: String
    public let content: String
}

/// An offline fixture domain. No network client, credentials, or production command can enter it.
public struct Simulation: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let id: UUID
    public private(set) var call: CallPhase = .idle
    public private(set) var investigation: InvestigationPhase = .draft
    public private(set) var step: ConversationStep = .report
    public private(set) var transcript: [TranscriptEntry] = []
    public private(set) var evidence: [Evidence] = []
    public private(set) var activities: [String] = []
    public private(set) var report = ""
    public private(set) var expected = ""
    public private(set) var revision = 0
    public private(set) var scenario: Scenario

    public var caseID: String { "DEMO-" + id.uuidString.prefix(8) }
    public var hasCase: Bool { investigation != .draft }

    public init(scenario: Scenario = .addressSave) {
        schemaVersion = 1
        id = UUID()
        self.scenario = scenario
    }

    public mutating func startCall() {
        guard call != .active else { return }
        call = .active
        if transcript.isEmpty {
            transcript.append(.init("Hermes", "I'm your AI investigator. This is a simulated call about a customer address form. What went wrong?"))
        }
    }

    public mutating func endCall() { call = .ended }

    public mutating func interruptCall() {
        if call == .active { call = .interrupted }
    }

    @discardableResult
    public mutating func submit(_ text: String) -> Bool {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard call == .active, investigation == .draft, step != .review,
              !value.isEmpty, value.count <= 2_000 else { return false }
        transcript.append(.init("You", value))
        if step == .report {
            report = value
            step = .clarification
            transcript.append(.init("Hermes", "What should happen when a customer selects Save address?"))
        } else {
            expected = value
            step = .review
            transcript.append(.init("Hermes", "Review your notes below. This example will inspect the scripted address-save fixture; it will not access your application."))
        }
        return true
    }

    @discardableResult
    public mutating func startInvestigation(report: String, expected: String) -> Bool {
        let report = report.trimmingCharacters(in: .whitespacesAndNewlines)
        let expected = expected.trimmingCharacters(in: .whitespacesAndNewlines)
        guard step == .review, investigation == .draft,
              !report.isEmpty, !expected.isEmpty, report.count <= 2_000, expected.count <= 2_000 else { return false }
        self.report = report
        self.expected = expected
        revision += 1
        investigation = .readingContext
        activities.append("Confirmed report saved in the local simulation.")
        transcript.append(.init("Hermes", "The simulated investigation has started. You can end this call and follow the case from Home."))
        return true
    }

    /// One deterministic fixture event. Call lifecycle never drives investigation lifecycle.
    public mutating func advance() {
        switch investigation {
        case .readingContext:
            evidence.append(Self.context)
            activities.append("Read the fixture context. No reviewed project memory was supplied.")
            investigation = .inspecting
        case .inspecting:
            if scenario == .unavailableTarget {
                investigation = .blocked
                activities.append("Fixture target denied access. No browser action or repair ran.")
                transcript.append(.init("Hermes", "The example target is unavailable. The case is blocked; no repair was attempted."))
            } else {
                investigation = .awaitingApproval
                evidence.append(Self.observation)
                activities.append("Fixture receipt: the form sent postalCode while the sample API expects postal_code.")
                transcript.append(.init("Hermes", "The fixture shows a field-name mismatch. Review the proposed change before the simulation continues."))
            }
        case .repairing:
            investigation = .complete
            evidence.append(contentsOf: [Self.patch, Self.checks])
            activities.append("Simulated base failure, candidate success, and regression success recorded.")
            transcript.append(.init("Hermes", "The simulated checks passed. Inspect the sample patch and test log in the case. No real repository was changed."))
        default: break
        }
    }

    @discardableResult
    public mutating func decide(approve: Bool, expectedRevision: Int) -> Bool {
        guard investigation == .awaitingApproval, revision == expectedRevision else { return false }
        revision += 1
        investigation = approve ? .repairing : .declined
        activities.append(approve ? "You approved the exact simulated repair scope." : "You declined the simulated repair. Evidence remains available.")
        return true
    }

    public mutating func stopInvestigation() {
        guard investigation.isAdvancing || investigation == .awaitingApproval else { return }
        investigation = .stopped
        revision += 1
        activities.append("You stopped the simulation. Existing evidence is preserved.")
    }

    public static let repairScope = "Repository: fixture/address-book\nBase: fixture-base-v1\nAllowed path: src/address-form.ts\nChange: serialize postal_code instead of postalCode\nAcceptance: address-save.test.ts\nRegression: address-validation.test.ts\nDestination: isolated simulation only"

    private static let context = Evidence(id: "context", title: "Context supplied to the fixture", kind: "Context", content: "PROVENANCE: SIMULATION\nProject: Address book example\nTarget: fixture://address-book/customers\nBuild: fixture-base-v1\nReviewed memory: none\nScope: inspect address serialization\nNetwork requests: none")
    private static let observation = Evidence(id: "observation", title: "Address request rejected", kind: "Observed in fixture", content: "PROVENANCE: SIMULATION\nAction: submit customer address\nRequest: {\"postalCode\":\"01310-100\"}\nResponse: 422 {\"error\":\"postal_code is required\"}\nObserved symptom: address was not saved.\nHypothesis: request field does not match the sample API contract.\nBrowser / OS: scripted fixture, no browser or physical device tested.")
    private static let patch = Evidence(id: "patch", title: "Proposed field-name correction", kind: "Simulated patch", content: "PROVENANCE: SIMULATION\n--- fixture-base-v1/src/address-form.ts\n+++ fixture-candidate-v1/src/address-form.ts\n- postalCode: address.postalCode\n+ postal_code: address.postalCode\n\nNo actual repository or file was modified.")
    private static let checks = Evidence(id: "checks", title: "Base, candidate, and regression checks", kind: "Simulated test log", content: "PROVENANCE: SIMULATION\nBase / address-save.test.ts: FAIL (exit 1)\nCandidate / address-save.test.ts: PASS (exit 0)\nCandidate / address-validation.test.ts: PASS (exit 0)\nResult: simulated_checks_passed\nindependently_verified: false\nThese are scripted outputs, not executed commands.\nNo Windows, Edge, or physical phone testing is implied.")
}
