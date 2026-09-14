# Repro Relay for iPhone

Native SwiftUI implementation of gate N-01 in the [client plan](../docs/SWIFTUI-CLIENT-PLAN.md). This build is an offline, text-driven simulated call with Hermes. It captures an editable example report, progresses an investigation, presents a scoped repair decision, and displays fixture evidence. No microphone, network, agent runtime, shell, or messaging provider is used.

## Open and run

Open `ReproRelay.xcodeproj` in Xcode and select the ReproRelay scheme and an installed iPhone simulator. Run with Command-R. The committed project requires no project generator or external Swift packages to open.

The app targets iOS 17 or later. Development validation uses Xcode 26.4.1 and the installed iOS 26.4 simulator. A physical device needs your signing team configured in Xcode; no team identifier or signing credentials are checked in. The minimum supported OS still needs its own device/runtime validation.

From the repository root:

```sh
open apple/ReproRelay.xcodeproj
make -C apple build
make -C apple test
```

Select a different installed device without changing source:

```sh
make -C apple test DESTINATION='platform=iOS Simulator,name=iPhone 17e'
```

## Try the workflow

1. Choose **Try a simulated call** on Home.
2. Type a problem or choose **Use example problem**, then send it. Answer the clarification or use the suggested expected result.
3. Review and edit the report, then choose **Start simulated investigation**.
4. End the call. Open the example case from Home or Cases; the fixture progresses independently of the call view.
5. Review the exact approval scope, approve or decline, and inspect the sample context, request receipt, patch, and test log.
6. In Connections, select **Target access unavailable**, then reset the simulation to try the blocked path.

The investigation always follows the selected address-book fixture. Edited report notes do not drive an actual model or diagnosis. Every receipt is marked as simulation. Nothing is copied into real backend cases or trusted project memory.

Ending the call preserves the investigation. Stopping the investigation preserves prior evidence and leaves the call open. Device-local state survives relaunch. iOS may suspend the fixture timer in the background; it resumes when the app runs again. This is not a background execution service. Returning from inactivity pauses the conversation until explicitly resumed.

## Isolation and layout

| Path | Responsibility |
| --- | --- |
| `ReproRelay/` | SwiftUI app, navigation, views, device-local persistence and fixture scheduling |
| `Packages/RelayCore/` | Platform-independent, Codable simulation state and transition tests |
| `ReproRelayUITests/` | Native call, approval, evidence, stop, failure and relaunch workflows |
| `project.yml` | Reproducible Xcode project definition |

The `apple/` directory has its own build commands and ignored build/test output. It does not change the web package, Cargo workspace, Tauri application, API, or database migrations. Keep one repository so native and backend contract changes can be reviewed together. A separate repository can follow if release ownership requires it; it is not needed for code isolation.

Use [XcodeGen](https://github.com/yonaskolb/XcodeGen) only after changing targets, source membership, or project settings: `make -C apple generate`. Commit `project.yml` and the regenerated project together. The local package is shared-code preparation for macOS; this milestone does not add a native Mac target.

## Validation and next gate

Seven core tests cover call/worker separation, cancellation, revision-bound approval and replay, decline, blocked access, draft validation, and persistence serialization. Four UI tests operate the visible controls, including report submission at the largest accessibility text size, and attach simulator screenshots to the Xcode test result. These passed on iPhone 17 Pro / iOS 26.4. UI tests use a separate UserDefaults suite so they cannot erase a user's normal simulation.

The repository's existing `make check` remains the backend/web regression gate. Native tests are separate and require macOS/Xcode. No test here establishes live Hermes operation, independent bug verification, or Edge/Windows execution.

The next integration work is N-03 authenticated device access and the conversation adapter described in the [plan](../docs/SWIFTUI-CLIENT-PLAN.md). Do not add the local maintainer API URL as an unauthenticated production connection. Voice capture, native Mac layout, App Store assets/signing, and live repair remain later gates.
