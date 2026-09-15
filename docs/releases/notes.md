## Install

Download **Repro Relay.dmg**, open it, and drag the app to Applications.

This build is not signed by Apple, so the first open needs a right-click on the app and then **Open**. macOS asks once, then remembers.

## The app needs its service

The app is the workspace window; its service runs in Docker on your Mac.

1. Install Docker Desktop and open it.
2. Download **ReproRelay-starter.zip** from this release, unzip it, and double-click **Start Relay.command**.
3. Open the app.

The starter downloads the published package. There is no source build and nothing to paste into a terminal. Your records stay on this Mac.

## The chat agent instead

To run Repro Relay as a Hermes agent on your own Plow line, copy the repository and run `./relay agent` in its folder.
