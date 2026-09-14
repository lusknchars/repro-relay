import SwiftUI
import RelayCore

struct CaseView: View {
    @Environment(SimulationStore.self) private var store
    let openCall: (() -> Void)?
    @State private var confirmingStop = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                SimulationLabel()
                Text(store.simulation.caseID).font(.caption.monospaced()).foregroundStyle(.secondary)
                Text("Customers cannot save their address").font(.largeTitle.bold())
                Text(store.simulation.investigation.title).font(.headline).foregroundStyle(RelayStyle.blue)
                    .accessibilityIdentifier("case-status")
                RelayCard {
                    Text("The report").font(.headline)
                    Text(store.simulation.report)
                    Text("Expected result").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                    Text(store.simulation.expected)
                    Text("Your notes are retained. Findings below belong to the scripted address-save example.").font(.caption).foregroundStyle(.secondary)
                }

                if store.simulation.investigation == .awaitingApproval {
                    RepairDecisionView(revision: store.simulation.revision)
                }
                if store.simulation.investigation == .complete {
                    RelayCard {
                        Label("Simulated result", systemImage: "checkmark.seal").font(.headline).foregroundStyle(RelayStyle.blue)
                        Text("The example now sends the field expected by the sample API.")
                        Text("Base failed · candidate passed · regression passed").font(.subheadline)
                        Text("Scripted checks only. No real code changed; this is not an independently verified fix.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if store.simulation.investigation == .blocked {
                    RelayCard {
                        Label("Access is needed", systemImage: "lock").font(.headline)
                        Text("The fixture denied target access. No observation or repair was produced. Try the address-save scenario from Connections to explore the successful path.").font(.callout)
                    }
                }

                RelayCard {
                    Text("Investigation activity").font(.headline)
                    ForEach(Array(store.simulation.activities.enumerated()), id: \.offset) { index, activity in
                        HStack(alignment: .top, spacing: 12) {
                            Text(String(format: "%02d", index + 1)).font(.caption.monospaced()).foregroundStyle(RelayStyle.blue).fixedSize().padding(.top, 3)
                            Text(activity).font(.subheadline)
                        }
                    }
                    if store.simulation.investigation.isAdvancing { ProgressView("Playing the fixture sequence…") }
                }

                RelayCard {
                    Text("Evidence").font(.headline)
                    if store.simulation.evidence.isEmpty {
                        Text("No evidence yet. Only completed fixture steps appear here.").foregroundStyle(.secondary)
                    }
                    ForEach(store.simulation.evidence) { item in
                        NavigationLink {
                            EvidenceView(evidence: item)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "doc.text.magnifyingglass").foregroundStyle(RelayStyle.blue)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(item.title).font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                                    Text(item.kind).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                            }.frame(minHeight: 52)
                        }.accessibilityIdentifier("evidence-\(item.id)")
                    }
                }

                if let openCall { Button("Return to conversation", action: openCall).buttonStyle(PrimaryButtonStyle()) }
                if store.simulation.investigation.isAdvancing || store.simulation.investigation == .awaitingApproval {
                    Button("Stop investigation", role: .destructive) { confirmingStop = true }
                        .frame(maxWidth: .infinity, minHeight: 44).accessibilityIdentifier("stop-investigation")
                }
                Text("Stored only on this device. Live Hermes, owner delivery, and project memory are not connected.")
                    .font(.footnote).foregroundStyle(.secondary)
            }.padding(20)
        }
        .background(RelayStyle.background)
        .navigationTitle("Case detail").navigationBarTitleDisplayMode(.inline)
        .toolbar { SimulationToolbar() }
        .confirmationDialog("Stop this simulated investigation?", isPresented: $confirmingStop, titleVisibility: .visible) {
            Button("Stop investigation", role: .destructive) { store.stopInvestigation() }
        } message: { Text("Existing evidence will remain in the case. This does not end the conversation.") }
    }
}

struct RepairDecisionView: View {
    @Environment(SimulationStore.self) private var store
    let revision: Int
    @State private var confirming = false

    var body: some View {
        RelayCard {
            Label("Your decision", systemImage: "hand.raised").font(.headline)
            Text("Use the API's field name").font(.title3.bold())
            Text("The fixture sent postalCode. Its API expects postal_code. Review the exact simulated scope before continuing.").font(.callout)
            Text(Simulation.repairScope).font(.caption.monospaced()).textSelection(.enabled)
            Text("Approval applies to this case at revision \(revision). No real repository access is granted.").font(.caption).foregroundStyle(.secondary)
            Button("Review approval") { confirming = true }
                .buttonStyle(PrimaryButtonStyle()).accessibilityIdentifier("review-approval")
            Button("Decline repair", role: .destructive) { store.decide(approve: false, revision: revision) }
                .frame(maxWidth: .infinity, minHeight: 44).accessibilityIdentifier("decline-repair")
        }
        .confirmationDialog("Approve this simulated repair?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Approve simulated repair") { store.decide(approve: true, revision: revision) }
        } message: { Text("Only fixture/address-book at fixture-base-v1, src/address-form.ts, and the displayed acceptance and regression checks. No real files will change.") }
    }
}

struct EvidenceView: View {
    let evidence: Evidence
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                SimulationLabel()
                Text(evidence.title).font(.title2.bold())
                Label(evidence.kind, systemImage: "doc.text").font(.subheadline).foregroundStyle(.secondary)
                Text(evidence.content).font(.system(.callout, design: .monospaced))
                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20).background(RelayStyle.panel, in: RoundedRectangle(cornerRadius: 20))
                    .accessibilityIdentifier("evidence-content")
            }.padding(20)
        }.background(RelayStyle.background)
            .navigationTitle("Evidence").navigationBarTitleDisplayMode(.inline)
            .toolbar { SimulationToolbar() }
    }
}
