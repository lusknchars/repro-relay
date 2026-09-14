import SwiftUI
import RelayCore

struct ConnectionsView: View {
    @Environment(SimulationStore.self) private var store
    @State private var scenario: Scenario = .addressSave
    @State private var confirmingReset = false

    var body: some View {
        Form {
            Section {
                SimulationLabel()
                LabeledContent("Workspace", value: "Local simulation")
                LabeledContent("Storage", value: "This device only")
                LabeledContent("Network requests", value: "None")
            } header: { Text("Effective configuration") }

            Section {
                connection("Hermes investigator", reason: "Requires an authenticated backend connection and a live conversation adapter.")
                connection("Plow / owner updates", reason: "Provider authentication and message transport are not connected.")
                connection("Microphone and voice", reason: "This first slice uses text. No audio is captured or stored.")
                connection("Project memory", reason: "Simulation evidence is never published as reviewed project memory.")
            } header: { Text("Live capabilities") } footer: {
                Text("The local desktop API cannot authorize a phone by itself. Secure device pairing is the next integration gate.")
            }

            Section {
                Picker("Next scenario", selection: $scenario) {
                    ForEach(Scenario.allCases, id: \.self) { item in Text(item.title).tag(item) }
                }.accessibilityIdentifier("scenario-picker")
                LabeledContent("Current scenario", value: store.simulation.scenario.title)
                Button("Reset simulation", role: .destructive) { confirmingReset = true }
                    .frame(minHeight: 44).accessibilityIdentifier("reset-simulation")
            } header: { Text("Try another path") } footer: {
                Text("Reset removes the local example's transcript, report, and evidence. It does not affect web, desktop, or backend cases.")
            }
            if let error = store.persistenceError {
                Section("Storage issue") { Text(error).foregroundStyle(.red) }
            }
            Section {
                Text("Native prototype · N-01").font(.subheadline)
                Text("No actual phone call, agent execution, code repair, or external delivery occurs in this build.").font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Connections")
        .onAppear { scenario = store.simulation.scenario }
        .confirmationDialog("Reset the local simulation?", isPresented: $confirmingReset, titleVisibility: .visible) {
            Button("Reset and use selected scenario", role: .destructive) { store.reset(scenario: scenario) }
        } message: { Text("The example case on this device will be removed. This cannot be undone.") }
    }

    private func connection(_ name: String, reason: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(name).font(.headline)
            Label("Not connected", systemImage: "circle.slash").font(.caption.weight(.medium)).foregroundStyle(.secondary)
            Text(reason).font(.footnote).foregroundStyle(.secondary)
        }.padding(.vertical, 6)
    }
}
