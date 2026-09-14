import SwiftUI

@main
struct ReproRelayApp: App {
    @State private var store = SimulationStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RelayRootView()
                .environment(store)
                .tint(RelayStyle.blue)
                .task { store.resumeProgress() }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { store.resumeProgress() }
                    else { store.interruptCall() }
                }
        }
    }
}
