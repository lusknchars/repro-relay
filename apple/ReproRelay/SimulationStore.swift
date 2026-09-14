import Foundation
import Observation
import RelayCore

@MainActor @Observable
final class SimulationStore {
    private(set) var simulation: Simulation
    var persistenceError: String?
    private var worker: Task<Void, Never>?
    private let defaults: UserDefaults
    private let storageKey = "relay.simulation.v1"

    init() {
        let testing = ProcessInfo.processInfo.arguments.contains("--ui-testing")
        defaults = testing ? UserDefaults(suiteName: "dev.reprorelay.ui-tests")! : .standard
        if ProcessInfo.processInfo.arguments.contains("--reset-simulation") {
            defaults.removeObject(forKey: storageKey)
        }
        if let data = defaults.data(forKey: storageKey) {
            do {
                let saved = try JSONDecoder().decode(Simulation.self, from: data)
                guard saved.schemaVersion == 1 else { throw CocoaError(.coderReadCorrupt) }
                simulation = saved
                simulation.interruptCall()
            } catch {
                simulation = Simulation()
                persistenceError = "The saved simulation could not be read. A new example is open; the previous saved data has not been replaced. Reset the simulation in Connections to save again."
            }
        } else {
            simulation = Simulation()
        }
    }

    func startCall() { update { $0.startCall() } }
    func endCall() { update { $0.endCall() } }
    func interruptCall() { update { $0.interruptCall() } }
    func submit(_ text: String) { update { _ = $0.submit(text) } }
    func startInvestigation(report: String, expected: String) {
        update { _ = $0.startInvestigation(report: report, expected: expected) }
    }
    func decide(approve: Bool, revision: Int) {
        update { _ = $0.decide(approve: approve, expectedRevision: revision) }
    }
    func stopInvestigation() { update { $0.stopInvestigation() } }

    func reset(scenario: Scenario) {
        worker?.cancel()
        worker = nil
        persistenceError = nil
        simulation = Simulation(scenario: scenario)
        save()
    }

    func resumeProgress() { schedule() }

    private func update(_ operation: (inout Simulation) -> Void) {
        operation(&simulation)
        save()
        schedule()
    }

    private func save() {
        guard persistenceError == nil else { return }
        do { defaults.set(try JSONEncoder().encode(simulation), forKey: storageKey) }
        catch { persistenceError = "This simulation could not be saved. Keep the app open to retain the current view." }
    }

    private func schedule() {
        guard worker == nil, simulation.investigation.isAdvancing else { return }
        let caseID = simulation.id
        worker = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(2)) } catch { return }
                guard let self, self.simulation.id == caseID else { return }
                guard self.simulation.investigation.isAdvancing else { break }
                self.simulation.advance()
                self.save()
            }
            self?.worker = nil
        }
    }
}
