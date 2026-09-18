# Repro Relay on Windows

Repro Relay runs on Windows. The agent runs in a Linux container, and your phone line belongs to Plow, so texting the agent works the same as it does from a Mac. Only the tools that touch your own computer need a Mac.

| Part | On Windows |
| --- | --- |
| The text agent on your own Plow line | Yes. It needs Docker Desktop and Python 3, the same as on a Mac. |
| Meeting notes and todos as tracked work | Yes. The agent keeps its own task store inside the container. |
| The workspace app | Yes, in the browser. The native desktop app is macOS only. |
| Tools that read, write or run something on your own computer | No. They go through Plow Latch, which is a Mac application. |
| A digest of a technical talk | No. It reads the talk in your own browser through Latch. |
| GitHub through your own `gh` login | No. The agent reaches `gh` with Latch's `plow_run_command`. |

## What needs a Mac, and why

Plow Latch is a Mac application. `plow_read_file`, `plow_write_file`, `plow_run_command` and the browser tools reach your own computer through it. Plow publishes no Windows or Linux Latch, so on those machines those tools do not exist. That is Plow's limit, and no Relay setting changes it.

The agent is told which machine you installed from, through `RELAY_OWNER_PLATFORM` in its container. On Windows it says once that those tools need a Mac running Latch, and then it stops offering them and stops asking whether you want your Mac used. An agent installed before that variable existed does not know your platform, and asks rather than assuming.

## Run the commands

`relay` is a Python file. Its shebang and executable bit mean nothing to PowerShell or `cmd.exe`, so `./relay ...` fails there with "not recognized". Use `python relay ...`:

```powershell
python relay agent
python relay agent status
python relay agent test "Summarise my open work"
python relay agent stop
python relay agent model
python relay setup --web
python relay doctor
python relay --help
```

Documentation elsewhere writes these as `./relay ...`, including [terminal tooling](../integrations/relay-terminal/README.md). On Windows, read that form as `python relay ...`.

`install.sh`, `start.sh` and `connect.sh` are POSIX shell scripts. Run them from Git Bash or WSL, or use `python relay setup --web` to start the same services.

## Not established on Windows

Windows CI runs the mocked interface compatibility suite in Microsoft Edge and checks the native desktop crate. It does not run the PostgreSQL or Hermes suites there. See [runner configuration](HERMES-RUNNER.md).

[Terminal tooling](../integrations/relay-terminal/README.md) records that no-follow file reads currently require POSIX, and that native Windows ledger access is unsupported and must not be advertised as tested. `relay ledger read` and `relay ledger state` depend on those reads.
