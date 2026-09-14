import SwiftUI

enum RelayStyle {
    static let blue = Color(red: 0.20, green: 0.36, blue: 0.90)
    static let background = Color(uiColor: .systemGroupedBackground)
    static let panel = Color(uiColor: .secondarySystemGroupedBackground)
}

struct SimulationLabel: View {
    var body: some View {
        Label("Simulation · on this device", systemImage: "testtube.2")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("simulation-label")
    }
}

struct SimulationToolbar: ToolbarContent {
    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Text("SIMULATED")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .accessibilityLabel("Simulation. No live actions.")
        }
    }
}

struct RelayCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 14) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(RelayStyle.panel, in: RoundedRectangle(cornerRadius: 24))
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: 52)
            .foregroundStyle(.white)
            .background(RelayStyle.blue.opacity(isEnabled ? 1 : 0.4), in: RoundedRectangle(cornerRadius: 16))
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: configuration.isPressed)
    }
}

struct AgentMark: View {
    var large = false
    var body: some View {
        Image(systemName: "waveform.path")
            .font(.system(size: large ? 38 : 21, weight: .medium))
            .foregroundStyle(.white)
            .frame(width: large ? 88 : 48, height: large ? 88 : 48)
            .background(RelayStyle.blue.gradient, in: RoundedRectangle(cornerRadius: large ? 30 : 17))
            .accessibilityHidden(true)
    }
}
