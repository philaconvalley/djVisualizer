# DDJ-REV1 USB drop monitor

Catches the DDJ-REV1 dropping off CoreAudio/CoreMIDI and timestamps the
event, for PHI-181. See that ticket, and `docs/hardware-checks/2026-08-10-ddj-rev1.md`
for the F8 finding this investigates.

## Run it

```bash
python3 tools/ddj-rev1-monitor/monitor.py
```

No dependencies beyond Python 3 and macOS's own `system_profiler` and
`log` tools. Stop with Ctrl+C — shutdown is clean and prompt.

Options:

- `--interval SECONDS` — how often to poll device presence (default 5).
- `--log PATH` — where to write the JSONL log (default `ddj-rev1-monitor.log`
  next to this script).
- `--device NAME` — substring to match the device name (default `DDJ-REV1`).

Tail the log live in a second terminal:

```bash
tail -f tools/ddj-rev1-monitor/ddj-rev1-monitor.log
```

## What it does

Two independent checks run at once, per the design in
`decide-first-log.md` (2026-08-23 entry):

1. **Presence polling.** Every interval, it asks `system_profiler` for
   the current CoreAudio and USB device lists, and logs a `poll` line.
   If the DDJ-REV1's presence flips from the last poll, it logs a
   `*_device_dropped` or `*_device_returned` event — this is edge
   detection on a boolean, not a comparison to a baseline session.
2. **Kernel USB log stream.** `log stream --predicate 'subsystem ==
   "com.apple.iokit.usb"'` runs continuously in the background and
   forwards any relevant line straight to the log with the kernel's own
   timestamp. This catches the exact instant of a physical
   disconnect/reset/suspend, rather than only bracketing it between two
   polls.

Every line is a JSON object with a timestamp, written to the log file as
it happens — nothing is only reported in a final summary, so a clean run
is verifiable step by step, not just quiet.

## Using it for the PHI-181 investigation

1. Run it before doing anything else — get a baseline of clean polls
   with nothing connected/changed.
2. Connect the DDJ-REV1, start Serato, and leave the monitor running for
   the planned test window (idle, then active use, per the ticket's
   plan).
3. When a drop happens, the log has both the kernel-log line (exact
   instant) and the next poll's `*_device_dropped` event with CPU load
   and power source at that moment — use both to correlate against what
   was happening (idle, track load, screen sleep, battery/mains).
4. Swap one variable at a time (cable, port, hub, power source) between
   runs, and append what happened to
   `docs/hardware-checks/2026-08-10-ddj-rev1.md`.
