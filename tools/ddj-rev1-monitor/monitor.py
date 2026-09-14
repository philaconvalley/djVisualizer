#!/usr/bin/env python3
"""
DDJ-REV1 USB drop monitor (PHI-181).

Catches the DDJ-REV1 dropping off CoreAudio/CoreMIDI and timestamps the
event, with enough context to see what was happening at that moment.

Design (see decide-first-log.md, 2026-08-23 entry, for the reasoning):

  - Device presence is a boolean, not a metric that drifts from a baseline.
    So detection is edge-based: poll the device list on an interval, diff
    it against the last poll, and log the exact transition (present ->
    absent, absent -> present). No baseline file, no session comparison.

  - `log stream` on the USB kernel subsystem runs concurrently and gives
    the kernel's own event-time for the physical disconnect. This is
    event-driven, not polled, so it catches the instant rather than
    bracketing it between two samples. The two sources are cross-checked
    in the log: a real drop should show up in both.

  - Every phase writes an append-only, timestamped line to one log file.
    Nothing is summarized only at the end -- the point is that a clean
    run is trustworthy because you can see each step, not because
    nothing was printed.

Usage:
    python3 monitor.py [--interval SECONDS] [--log PATH] [--device NAME]

Stop with Ctrl+C. The log file is safe to tail in a second terminal
while this runs: `tail -f ddj-rev1-monitor.log`.
"""

import argparse
import json
import shlex
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_DEVICE_MATCH = "DDJ-REV1"
DEFAULT_INTERVAL = 5.0
DEFAULT_LOG = Path(__file__).parent / "ddj-rev1-monitor.log"

# subsystem == "com.apple.iokit.usb" catches physical attach/detach at the
# kernel level -- this is the source of truth for "did the USB link drop."
USB_LOG_PREDICATE = 'subsystem == "com.apple.iokit.usb"'


def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="milliseconds")


class JsonlLogger:
    """Append-only structured log. One JSON object per line, flushed immediately."""

    def __init__(self, path):
        self.path = Path(path)
        self._lock = threading.Lock()
        self._fh = open(self.path, "a", buffering=1)

    def write(self, event, **fields):
        record = {"ts": now_iso(), "event": event, **fields}
        line = json.dumps(record, sort_keys=True)
        with self._lock:
            self._fh.write(line + "\n")
            self._fh.flush()
        # Mirror to stdout so the operator sees it live without tailing.
        print(line)

    def close(self):
        self._fh.close()


def get_cpu_load():
    """Cheap, no-dependency context snapshot: 1-minute load average."""
    try:
        return subprocess.run(
            ["sysctl", "-n", "vm.loadavg"], capture_output=True, text=True, timeout=2
        ).stdout.strip()
    except Exception as exc:
        return f"unavailable ({exc})"


def get_power_source():
    """on-battery vs on-mains -- relevant since the controller is bus-powered."""
    try:
        out = subprocess.run(
            ["pmset", "-g", "batt"], capture_output=True, text=True, timeout=2
        ).stdout
        if "AC Power" in out:
            return "mains"
        if "Battery Power" in out:
            return "battery"
        return f"unknown ({out.strip()[:80]})"
    except Exception as exc:
        return f"unavailable ({exc})"


def audio_devices_present(device_match):
    """
    Poll CoreAudio device enumeration via system_profiler and return
    True/False for whether a device matching `device_match` is present.

    system_profiler's JSON output is the structured, parseable path --
    avoids scraping the human-readable text form.
    """
    try:
        proc = subprocess.run(
            ["system_profiler", "SPAudioDataType", "-json"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except subprocess.TimeoutExpired:
        return None, "system_profiler timed out"
    except Exception as exc:
        return None, f"system_profiler failed: {exc}"

    if proc.returncode != 0:
        return None, f"system_profiler exit {proc.returncode}: {proc.stderr.strip()}"

    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        return None, f"could not parse system_profiler JSON: {exc}"

    # SPAudioDataType is a list containing one wrapper object; the actual
    # devices live in that wrapper's "_items" array, not at the top level.
    # Confirmed empirically 2026-08-23: reading _name off the top-level
    # entries directly found nothing, even with a real device connected.
    names = []
    for section in data.get("SPAudioDataType", []):
        for item in section.get("_items", []):
            names.append(item.get("_name", ""))
    present = any(device_match.lower() in n.lower() for n in names)
    return present, names


def midi_devices_present(device_match):
    """
    Poll USB device enumeration for the DDJ-REV1's USB interface, which
    the OS enumerates whether or not CoreMIDI has claimed it -- the
    DDJ-REV1's MIDI interface rides the same USB descriptor as its audio
    interface, so a drop here should line up with the audio drop.

    Uses `ioreg -p IOUSB`, not `system_profiler SPUSBDataType`. Confirmed
    empirically 2026-08-23: on this machine `system_profiler SPUSBDataType`
    returned completely empty output (not even built-in hubs), while
    `ioreg` reliably showed the DDJ-REV1 node with its USB product name.
    `system_profiler`'s USB data source is apparently unreliable here;
    `ioreg` reads the USB registry directly and does not depend on it.
    """
    try:
        proc = subprocess.run(
            ["ioreg", "-p", "IOUSB", "-w0", "-l"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except subprocess.TimeoutExpired:
        return None, "ioreg timed out"
    except Exception as exc:
        return None, f"ioreg failed: {exc}"

    if proc.returncode != 0:
        return None, f"ioreg exit {proc.returncode}: {proc.stderr.strip()}"

    text = proc.stdout
    present = device_match.lower() in text.lower()
    # For context/debugging, pull out just the lines naming a USB node
    # (the "+-o SomeName@..." tree lines) rather than dumping the whole
    # (very large) ioreg output into every log line.
    node_lines = [line.strip() for line in text.splitlines() if "+-o " in line]
    return present, node_lines


class UsbKernelLogWatcher(threading.Thread):
    """
    Runs `log stream --predicate 'subsystem == "com.apple.iokit.usb"'`
    continuously in the background and forwards every line whose text
    mentions the target device to the logger, with the kernel's own
    timestamp already embedded in the line.

    This is the event-driven half: it can catch the instant of a drop
    even between two polls of the boolean-presence check above.
    """

    def __init__(self, logger, device_match, stop_event):
        super().__init__(daemon=True)
        self.logger = logger
        self.device_match = device_match.lower()
        self.stop_event = stop_event
        self.proc = None

    def run(self):
        cmd = ["log", "stream", "--style", "compact", "--predicate", USB_LOG_PREDICATE]
        self.logger.write("kernel_log_watch_start", cmd=shlex.join(cmd))
        try:
            self.proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
            )
        except Exception as exc:
            self.logger.write("kernel_log_watch_error", error=str(exc))
            return

        try:
            for line in self.proc.stdout:
                if self.stop_event.is_set():
                    break
                line = line.rstrip("\n")
                if not line:
                    continue
                # Forward every USB subsystem line that mentions the device,
                # plus generic disconnect/enumeration-failure language --
                # a brownout or power-management event may not print the
                # product name on every line.
                lowered = line.lower()
                is_relevant = (
                    self.device_match in lowered
                    or "disconnect" in lowered
                    or "enumerat" in lowered
                    or "suspend" in lowered
                    or "reset" in lowered
                )
                if is_relevant:
                    self.logger.write("kernel_usb_log_line", line=line)
        except Exception as exc:
            self.logger.write("kernel_log_watch_error", error=str(exc))
        finally:
            self.logger.write("kernel_log_watch_stop")

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--interval", type=float, default=DEFAULT_INTERVAL,
                         help=f"Seconds between presence polls (default: {DEFAULT_INTERVAL})")
    parser.add_argument("--log", type=Path, default=DEFAULT_LOG,
                         help=f"Path to the JSONL log file (default: {DEFAULT_LOG})")
    parser.add_argument("--device", default=DEFAULT_DEVICE_MATCH,
                         help=f"Substring to match the device name (default: {DEFAULT_DEVICE_MATCH!r})")
    args = parser.parse_args()

    logger = JsonlLogger(args.log)
    stop_event = threading.Event()

    # Explicit signal handlers rather than a bare `except KeyboardInterrupt`
    # around the sleep loop. Tested and confirmed necessary: with a
    # background thread continuously reading a live subprocess's stdout
    # (the kernel log watcher below), a plain try/except around
    # time.sleep() did not reliably stop the process on SIGINT -- the
    # interrupt could be swallowed. An explicit handler that flips a
    # threading.Event, checked on a short poll cadence, shuts down
    # promptly and deterministically regardless of what the other
    # thread is doing.
    def request_stop(sig, frame):
        logger.write("monitor_stop_requested", signal=signal.Signals(sig).name)
        stop_event.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    logger.write(
        "monitor_start",
        interval_seconds=args.interval,
        device_match=args.device,
        log_path=str(args.log),
    )

    kernel_watcher = UsbKernelLogWatcher(logger, args.device, stop_event)
    kernel_watcher.start()

    # Edge-detection state -- None means "not yet known," so the first
    # poll always logs an initial reading rather than a spurious edge.
    last_audio_present = None
    last_midi_present = None

    try:
        while not stop_event.is_set():
            audio_present, audio_detail = audio_devices_present(args.device)
            midi_present, midi_detail = midi_devices_present(args.device)
            cpu = get_cpu_load()
            power = get_power_source()

            logger.write(
                "poll",
                audio_present=audio_present,
                midi_present=midi_present,
                cpu_loadavg=cpu,
                power_source=power,
            )

            if audio_present is None:
                logger.write("poll_error", channel="audio", detail=audio_detail)
            elif last_audio_present is not None and audio_present != last_audio_present:
                event = "audio_device_dropped" if not audio_present else "audio_device_returned"
                logger.write(event, all_audio_devices=audio_detail, cpu_loadavg=cpu, power_source=power)

            if midi_present is None:
                logger.write("poll_error", channel="usb_midi_proxy", detail=midi_detail)
            elif last_midi_present is not None and midi_present != last_midi_present:
                event = "usb_device_dropped" if not midi_present else "usb_device_returned"
                logger.write(event, all_usb_devices=midi_detail, cpu_loadavg=cpu, power_source=power)

            if audio_present is not None:
                last_audio_present = audio_present
            if midi_present is not None:
                last_midi_present = midi_present

            # Sleep in short slices so a stop request lands within ~0.5s
            # even mid-interval, instead of blocking for the full poll
            # interval on a single time.sleep() call.
            slept = 0.0
            while slept < args.interval and not stop_event.is_set():
                time.sleep(min(0.5, args.interval - slept))
                slept += 0.5
    finally:
        logger.write("monitor_stop", reason="stop_event_set")
        stop_event.set()
        kernel_watcher.stop()
        logger.close()


if __name__ == "__main__":
    sys.exit(main())
