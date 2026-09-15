Repro Relay starter
===================

This folder starts Repro Relay's local service on your Mac. The app window itself
is the separate "Repro Relay.dmg" download from the same release.

Before you begin
----------------
Install Docker Desktop and open it. Wait until it reports that it is running.

Start it
--------
Double-click "Start Relay.command". The first start downloads the published
package, starts PostgreSQL and the application, waits until both report healthy,
and opens the workspace at 127.0.0.1:8178. Your records stay on this Mac.

If macOS refuses to open the file because it came from the internet, right-click
it, choose Open, then confirm once.

Everyday controls, from Terminal in this folder
-----------------------------------------------
  ./start.sh status   check both services
  ./start.sh logs     the last 100 application log lines
  ./start.sh stop     stop both services and keep your data

What it does not do
-------------------
It does not create an account, ask for a phone number, or need a model provider
key to open. It makes no model calls by itself. Hermes, Plow, Discord, Sentry,
Exa, calendars and memory stay disconnected until you configure them in Settings.

If the start fails
------------------
The most common cause is Docker not running yet. The second is the published
package being unavailable to your account, in which case this starter cannot
build the application from source: download the full repository and run
"sh connect.sh" there instead.
