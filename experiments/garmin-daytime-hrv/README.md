# Forerunner 970 optical PRV feasibility test

Phase 1 is a wrist-only hardware experiment. The watch application collects
only on explicit START, unless you later arm the separate temporal experiment.
It uses no GPS, activity recording, phone companion, wireless transmission, or
web endpoint. It saves a latest foreground report and bounded background
counters locally. It makes no changes to Performance Lab or Garmin sync.

## Install the prebuilt watch app

1. Download [PRVTEST.prg](builds/PRVTEST.prg) from the experiment branch. Keep that filename.
   You do not need developer tools to sideload this binary.
2. Use a **Windows PC** and the 970's USB **data** cable. Close Garmin Express
   and any other Garmin application using the device. In File Explorer, open
   **This PC → Forerunner 970 → Internal Storage → GARMIN → APPS**. MTP can
   show the storage name slightly differently. Copy the file directly into
   `GARMIN/APPS`, then disconnect after the copy completes.
3. From the watch face, press the upper-right **START** button and find
   **Optical PRV Test** in the app launcher (check **Apps** if grouped).
   If the app is missing, confirm it is a `.prg` and the correct folder, then
   check for a watch software update. The 970 uses MTP. It does not appear as
   an ordinary Finder disk on a Mac. Windows is Garmin's supported file-access
   route for this model, including for Mac users with access to a Windows PC.

[Garmin sideload guide](https://developer.garmin.com/connect-iq/connect-iq-basics/your-first-app/) ·
[Garmin Forerunner 970 MTP support](https://support.garmin.com/en-US/?faq=CZqibgTHMb0dAYEaj2UiU7)

## Four-minute foreground test

1. Leave wrist HR enabled. Disconnect or move out of range of all paired HR
   accessories, including Bluetooth and ANT+ straps. Finish any activity or
   Health Snapshot first. Wear the watch snugly, sit quietly for a minute,
   then rest your arm on a table.
2. Open **Optical PRV Test**, then press **START** from its ready screen.
   Leave the app open for four minutes. Read **Usable / total** and approximate
   coverage as they update. The report is saved automatically and reappears
   when you reopen the app. For stronger evidence, repeat twice more while
   seated. Record the firmware version and which tests were wrist-only.
3. Optionally pre-create an empty `GARMIN/APPS/LOGS/PRVTEST.TXT` over USB
   before testing. If logging is enabled on the watch, that file receives
   compact foreground and background diagnostic lines. Copy it locally after
   testing, or photograph the watch result. Keep the report private unless
   you choose to share it. No raw intervals are logged.
4. An optional separate off-wrist run can serve as a negative control. Run
   the wrist-only test first and save its report before replacing it.

| Result | Meaning |
| --- | --- |
| Valid-looking PRV | The API returned enough intervals to pass the screen. Repeatability and optical provenance still need hardware evidence. |
| Empty / unsupported | No intervals arrived. Callback counts distinguish empty batches from no callbacks. Retry with wrist HR on and no accessories. |
| Suspicious intervals | Replay, exact repeats, or an integer-BPM reciprocal pattern dominated. RMSSD is withheld. |
| Insufficient quality | Intervals arrived, but coverage, artifacts, timing gaps, or usable pair count failed the gate. |
| Onboard request failed / Sensor error | The onboard request, listener, callback, or cleanup failed. Record the displayed error and firmware. |
| Interrupted | The view was closed before collection finished. |

## What the SDK establishes

Garmin Connect IQ SDK 9.3.0 and the `fr970` device profile support building a
watch app with the `Sensor` permission. The device reference lists a 454 × 454
screen. The device definition used for this build lists 64 KiB of background
memory. The profile came from a [mirror of SDK Manager device files](https://github.com/DuckSoft/setup-connectiq-actions/tree/64f7145) because the SDK Manager's direct device service required authentication here.
Use the SDK Manager for current device files when rebuilding.

`Sensor.enableSensorType(Sensor.SENSOR_ONBOARD_HEARTRATE)` requests onboard
HR. It returns a Boolean. The app never enables the external HR sensor type.
`Sensor.registerSensorDataListener(listener, options)` takes a callback with
one `Sensor.SensorData` argument and requests `{:period => 4,
:heartBeatIntervals => {:enabled => true}}`, in seconds. The callback's
nullable `heartRateData` contains a millisecond `heartBeatIntervals` array.
There is no beat timestamp or reliable source label attached to that array.
The app records monotonic elapsed time at callback arrival and reports first
and last arrival offsets. An accepted onboard request is not proof of source
or interval authenticity. Native Health Snapshot or overnight HRV does not
establish third-party interval access.

Garmin developer forum reports describe wrist-only empty streams and potential
BPM-derived interval patterns on other devices. Those reports inform the
diagnostics, and cannot establish the behavior of a 970 or its firmware.
This test uses the documented API without starting a dummy activity or
altering native monitoring settings.

[SDK 9.3.0](https://developer.garmin.com/connect-iq/sdk/) ·
[Forerunner 970 profile](https://developer.garmin.com/connect-iq/device-reference/) ·
[Sensor module](https://developer.garmin.com/connect-iq/api-docs/Toybox/Sensor.html) ·
[HeartRateData](https://developer.garmin.com/connect-iq/api-docs/Toybox/Sensor/HeartRateData.html) ·
[Optical interval forum report](https://forums.garmin.com/developer/connect-iq/i/bug-reports/interval-capture-broken-again-or-not-fixed)

## Experimental unattended test

**Run this only after a valid-looking foreground result.** On the saved result,
press **DOWN** to view background statistics. Hold **UP** (MENU) to arm it.
Return to the watch face. After 30–60 minutes, reopen the app and press
**DOWN** to inspect counters. Hold **UP** again to stop. An armed test expires
after 26 hours and is deregistered the next time its service wakes. A foreground
retest requires disarming first. Arming a new run resets background statistics.

The `Background` permission and `System.ServiceDelegate` are used for a
15-minute temporal duration. Garmin documents a minimum five-minute spacing,
one registered temporal event, a smaller memory budget, and a hard 30-second
service limit. The app sets a 24-second deadline and exits earlier on failure.
It skips a workout or unknown activity timer state. Timing is best effort.
A gap in delivery estimates missed slots. A persisted in-progress marker
records a service that entered and did not finish, detected at the next wake.
These are separate counters alongside valid, empty, rejected, API errors,
workout skips, and unknown-state skips. Timing and storage use two small
summary writes per attempt, with no interval history or catch-up bursts.
A last unfinished attempt may appear in the interrupted counter until it
resolves.

This background build passes the SDK's target and context checks. A developer
has reported background interval callbacks on a vívoactive 5, including
intermittently empty data. This is precedent for trying a temporal listener,
not a vendor guarantee for the Forerunner 970. The watch test must confirm
whether a timer and interval callbacks run together within the deadline,
whether a native workout is detectable, and whether native monitoring or
power modes affect collection. If workout state stays unknown, this build
will skip sampling by design. A series of all empty, missed, or unknown outcomes
is a failed feasibility result for unattended use in that setup.

[Garmin background services](https://developer.garmin.com/connect-iq/articles/core-topics/Backgrounding.html) ·
[Temporal API](https://developer.garmin.com/connect-iq/api-docs/Toybox/Background.html) ·
[Background callback field report](https://forums.garmin.com/developer/connect-iq/f/discussion/447502/heartbeatintervals-empty-in-a-background-sensor-listener-at-night-vivoactive-5-17-05/2078043)

## Quality and computation

The app screens actual callback intervals between 300 and 1,800 ms. Invalid
items and adjacent changes over 20% break a pair. An overly long batch or
exact replay of a multi-beat batch is discarded. The elapsed clock flags
delayed callbacks, and pairs never span callback boundaries because there
are no individual beat timestamps. Repetition and proximity to the reciprocal
of an integer BPM are heuristic flags. No averaged BPM input enters the
measurement path. A regular pulse can trip a heuristic, and a synthetic or
heavily filtered stream can evade it.

RMSSD is the square root of the mean of squared consecutive interval
differences over admitted within-batch pairs. Effective coverage is the
sum of admitted intervals, not elapsed wall time or proof of strict continuity.
Foreground needs at least 120 seconds, 60% coverage and 70 pairs. Background
needs at least 14 seconds, 60% coverage and eight pairs. Both reject excessive
gaps or artifacts. The pooled short batches and the 24-second optical result
are experimental PRV measurements with different sampling conditions from
a two-minute Health Snapshot or a continuous five-minute resting recording.
Neither the simulator nor these checks can prove raw optical physiology.

## Battery A/B (48 hours)

Perform only after foreground and unattended collection produce usable data.

1. Start **A** with the temporal test off. Note battery percentage and time.
   Wear the watch normally for 24 hours. Record the end percentage.
2. Start **B** at the same time the next day, at a similar starting percentage
   if possible. Arm the 15-minute test and wear the watch for 24 hours.
   Record end battery, elapsed time, attempts, valid/empty/rejected/error,
   estimated misses, workout skips and sampling seconds; then disarm.
3. Keep always-on display, brightness, Pulse Ox, Bluetooth, GPS workouts,
   and notifications comparable. Avoid charging during either window. Start
   B without USB debug logging if you want the normal experimental footprint.
   Compare the two percentage-point drops normalized to 24 hours. Reverse
   the order on a repeat pair if the difference is near the display's
   resolution or workouts were materially different.

The target is under two additional percentage points per day. A/B measures
the whole experiment, including scheduling, wrist HR, CPU, and flash writes.
It does not isolate individual costs. There is no added wireless transfer.
Watch battery telemetry is approximate. No measured drain is claimed.
An optional later wake-only control can separate scheduling/storage overhead
from sensor use. Also compare native overnight HRV availability and note
any activity, sensor, or firmware anomalies.

## Rebuild and tests

Install Java (17 or later works with SDK 9.3.0) and the official Garmin
Connect IQ SDK Manager. Select the current SDK and download **Forerunner 970**
on its Devices tab. If using VS Code, install Garmin's **Monkey C** extension,
run **Monkey C: Verify Installation**, and generate a developer key through
its command palette. Alternatively, create an RSA 4096 DER key outside the
repo and compile from this directory:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out ~/ciq-test.pem
openssl pkcs8 -topk8 -inform PEM -outform DER -in ~/ciq-test.pem -out ~/ciq-test.der -nocrypt
mkdir -p bin
monkeyc -w -r -f monkey.jungle -d fr970 -y ~/ciq-test.der -o bin/PRVTEST.prg
monkeyc -w -t -f monkey.jungle -d fr970 -y ~/ciq-test.der -o bin/PRVTEST-TEST.prg
connectiq
# In a second terminal, with the simulator open:
monkeydo bin/PRVTEST-TEST.prg fr970 -t
```

Put the SDK's `bin` on your PATH, or use absolute command paths. On Windows,
use `monkeyc.bat` with your developer key path. The test build contains six
synthetic Monkey C fixtures and is for simulation only. The watch build
and fixture build compiled with SDK 9.3.0. The simulator runtime could not
start in the build environment because compatible WebKitGTK and other native
libraries were unavailable. Fixture execution and physical test results are
pending. The supplied feasibility binary is a signed release build. Its
SHA-256 is `b4f1a55b55121d98d749b105cdb956f1265cb29a3c4f5cdf62c851103e739105`.

## Future integration, after watch validation

Keep a bounded ring of timestamped summaries on the watch. Use a separate,
opt-in phone bridge to deliver batches to a private endpoint with replay-safe
IDs and minimal retention. Keep workout skips, empty readings, and rejected
samples as aggregate coverage statistics. Give offline or dropped transfer
a distinct state. Bring a separate wrist PRV series into Aerobic Fitness Lab
only once quality, battery, and privacy behavior has been demonstrated. Do
not mix it with activity FIT, overnight Garmin HRV, or Health Snapshot series.
