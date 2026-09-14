import SwiftUI
import RelayCore

struct RelayRootView: View {
    @Environment(SimulationStore.self) private var store
    @State private var selectedTab = 0
    @State private var showingCall = false

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        SimulationLabel()
                        VStack(alignment: .leading, spacing: 16) {
                            HStack { AgentMark(); Spacer(); Text("HERMES / AI INVESTIGATOR").font(.caption2.weight(.bold)).tracking(1) }
                            Text("Talk it through.\nKeep work moving.")
                                .font(.largeTitle.weight(.bold)).fixedSize(horizontal: false, vertical: true)
                            Text("Describe the problem. Follow the investigation. Decide what happens next.")
                                .font(.body).foregroundStyle(.white.opacity(0.86))
                            Button(action: openCall) {
                                Label(store.simulation.call == .idle ? "Try a simulated call" : "Return to the conversation", systemImage: "phone.arrow.up.right")
                                    .font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 54)
                                    .foregroundStyle(RelayStyle.blue)
                                    .background(.white, in: RoundedRectangle(cornerRadius: 16))
                            }
                            .accessibilityIdentifier("open-call")
                        }
                        .padding(24).foregroundStyle(.white)
                        .background(LinearGradient(colors: [Color(red: 0.10, green: 0.19, blue: 0.48), RelayStyle.blue], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 28))

                        HStack {
                            Text("Your workspace").font(.title2.bold())
                            Spacer()
                            Text("LOCAL DEMO").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                        }
                        if store.simulation.hasCase {
                            NavigationLink { CaseView(openCall: openCall) } label: { CaseSummary() }
                                .buttonStyle(.plain).accessibilityIdentifier("home-case")
                        } else {
                            RelayCard {
                                Label("One conversation. One case.", systemImage: "point.3.connected.trianglepath.dotted").font(.headline)
                                Text("Try the address-save example to see how a report becomes evidence and a reviewable repair.").foregroundStyle(.secondary)
                                Text("No microphone, account, or runtime required.").font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                        if let error = store.persistenceError {
                            Text(error).font(.callout).foregroundStyle(.red)
                        }
                        Label("Live agent access is not connected", systemImage: "network.slash")
                            .font(.footnote).foregroundStyle(.secondary)
                    }.padding(20)
                }
                .background(RelayStyle.background)
                .navigationTitle("Repro Relay")
                .navigationBarTitleDisplayMode(.inline)
            }.tabItem { Label("Home", systemImage: "square.grid.2x2") }.tag(0)

            NavigationStack {
                Group {
                    if store.simulation.hasCase {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 20) {
                                SimulationLabel()
                                NavigationLink { CaseView(openCall: openCall) } label: { CaseSummary() }
                                    .buttonStyle(.plain).accessibilityIdentifier("inbox-case")
                            }.padding(20)
                        }
                    } else {
                        ContentUnavailableView {
                            Label("No cases yet", systemImage: "tray")
                        } description: {
                            Text("Confirm a report in the simulated call to create your first example case.")
                        } actions: {
                            Button("Try a simulated call", action: openCall).buttonStyle(.borderedProminent)
                        }
                    }
                }.background(RelayStyle.background).navigationTitle("Cases")
            }.tabItem { Label("Cases", systemImage: "tray.full") }.tag(1)

            NavigationStack { ConnectionsView() }
                .tabItem { Label("Connections", systemImage: "slider.horizontal.3") }.tag(2)
        }
        .sheet(isPresented: $showingCall, onDismiss: { store.endCall() }) {
            CallView().environment(store).interactiveDismissDisabled()
        }
    }

    private func openCall() { store.startCall(); showingCall = true }
}

struct CaseSummary: View {
    @Environment(SimulationStore.self) private var store
    var body: some View {
        RelayCard {
            HStack {
                Label(store.simulation.caseID, systemImage: "square.stack.3d.up").font(.caption.monospaced()).foregroundStyle(.secondary)
                Spacer()
                Image(systemName: "arrow.up.right").foregroundStyle(.secondary)
            }
            Text("Customers cannot save their address").font(.title3.weight(.semibold)).foregroundStyle(.primary)
            Text(store.simulation.investigation.title).font(.subheadline.weight(.medium)).foregroundStyle(RelayStyle.blue)
            HStack {
                Text("Address book example")
                Spacer()
                Text("\(store.simulation.evidence.count) evidence items")
            }.font(.caption).foregroundStyle(.secondary)
        }
    }
}
