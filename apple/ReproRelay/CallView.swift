import SwiftUI
import RelayCore

struct CallView: View {
    @Environment(SimulationStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var draft = ""
    @FocusState private var composing: Bool

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        VStack(spacing: 12) {
                            AgentMark(large: true)
                            Text("Hermes").font(.title.bold())
                            Text("AI investigator · text simulation").font(.subheadline).foregroundStyle(.secondary)
                            SimulationLabel()
                            Text("No microphone or telephone connection. Ending this call does not stop the investigation.")
                                .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        }.frame(maxWidth: .infinity).padding(.vertical, 8)

                        if store.simulation.call == .interrupted {
                            RelayCard {
                                Text("Conversation paused").font(.headline)
                                Text("The app became inactive. Investigation state is separate from this conversation.").font(.callout)
                                Button("Resume conversation") { store.startCall() }.buttonStyle(.bordered)
                            }
                        }

                        ForEach(store.simulation.transcript) { entry in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(entry.speaker == "You" ? "YOU" : "HERMES · SIMULATED")
                                    .font(.caption2.weight(.bold)).tracking(1).foregroundStyle(.secondary)
                                Text(entry.text).font(.body).textSelection(.enabled)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading).padding(18)
                            .background(entry.speaker == "You" ? RelayStyle.blue.opacity(0.09) : RelayStyle.panel, in: RoundedRectangle(cornerRadius: 20))
                        }

                        if store.simulation.step == .review && !store.simulation.hasCase {
                            ReportReviewView()
                        } else if store.simulation.hasCase {
                            RelayCard {
                                Text(store.simulation.investigation.title).font(.headline).accessibilityIdentifier("call-investigation-status")
                                if store.simulation.investigation.isAdvancing {
                                    ProgressView("Playing the fixture sequence…")
                                }
                                NavigationLink("Open case and evidence") { CaseView(openCall: nil) }
                                    .font(.body.weight(.semibold)).frame(minHeight: 44)
                                    .accessibilityIdentifier("call-open-case")
                            }
                        }
                        Color.clear.frame(height: 1).id("latest")
                    }.padding(20)
                }
                .onChange(of: store.simulation.transcript.count) { _, _ in
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { proxy.scrollTo("latest", anchor: .bottom) }
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .background(RelayStyle.background)
            .navigationTitle("Call Relay")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { SimulationToolbar() }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 10) {
                    if store.simulation.step != .review {
                        HStack(alignment: .bottom) {
                            TextField(store.simulation.step == .report ? "Describe the address problem" : "What should happen?", text: $draft, axis: .vertical)
                                .lineLimit(1...3).textFieldStyle(.roundedBorder).focused($composing)
                                .accessibilityLabel("Message to the simulated investigator")
                                .accessibilityIdentifier("call-input")
                            Button(action: send) { Image(systemName: "arrow.up.circle.fill").font(.system(size: 36)).frame(minWidth: 44, minHeight: 44) }
                                .accessibilityLabel("Send message").accessibilityIdentifier("send-message")
                                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.count > 2_000 || store.simulation.call != .active)
                        }
                        Button(store.simulation.step == .report ? "Use example problem" : "Use expected result") {
                            draft = store.simulation.step == .report ? "Customers cannot save their address." : "Save the address and show a confirmation."
                        }.font(.footnote).frame(minHeight: 44).accessibilityIdentifier("use-example")
                        if draft.count > 2_000 { Text("Keep your message under 2,000 characters.").font(.caption).foregroundStyle(.red) }
                    }
                    Button(role: .destructive) { store.endCall(); dismiss() } label: {
                        Label("End call", systemImage: "phone.down.fill").frame(maxWidth: .infinity, minHeight: 44)
                    }.buttonStyle(.bordered).tint(.red).accessibilityIdentifier("end-call")
                }.padding(.horizontal, 20).padding(.vertical, 12).background(.regularMaterial)
            }
        }
    }

    private func send() {
        store.submit(draft)
        draft = ""
        composing = false
    }
}

struct ReportReviewView: View {
    @Environment(SimulationStore.self) private var store
    @State private var report = ""
    @State private var expected = ""

    var body: some View {
        RelayCard {
            Text("Review the report").font(.title3.bold())
            Text("Your notes are saved with this example. The investigation uses the scripted address-save fixture.").font(.footnote).foregroundStyle(.secondary)
            Text("Reported problem").font(.subheadline.weight(.medium))
            TextField("Reported problem", text: $report, axis: .vertical).textFieldStyle(.roundedBorder).accessibilityIdentifier("review-report")
            Text("Expected result").font(.subheadline.weight(.medium))
            TextField("Expected result", text: $expected, axis: .vertical).textFieldStyle(.roundedBorder).accessibilityIdentifier("review-expected")
            Label("fixture://address-book/customers", systemImage: "scope").font(.caption.monospaced()).foregroundStyle(.secondary)
            Text("Manual start · no live tools · no usage charges").font(.caption).foregroundStyle(.secondary)
            Button("Start simulated investigation") {
                store.startInvestigation(report: report, expected: expected)
            }.buttonStyle(PrimaryButtonStyle()).accessibilityIdentifier("start-investigation")
                .disabled(report.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || expected.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || report.count > 2_000 || expected.count > 2_000)
        }.onAppear { report = store.simulation.report; expected = store.simulation.expected }
    }
}
