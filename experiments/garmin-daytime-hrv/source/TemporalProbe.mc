import Toybox.Activity;
import Toybox.Application.Storage;
import Toybox.Background;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;

(:background)
class TemporalProbe extends System.ServiceDelegate {
    var capture = null;
    var totals as Dictionary;

    function initialize() {
        ServiceDelegate.initialize();
        totals = {};
    }

    function onTemporalEvent() as Void {
        try {
            var state = Storage.getValue("temporal");
            if (!(state instanceof Dictionary) || !state["enabled"]) {
                Background.deleteTemporalEvent();
                Background.exit(null);
                return;
            }
            totals = state;
            var now = Time.now().value();
            if (now >= totals["expires"]) {
                totals["enabled"] = false;
                Background.deleteTemporalEvent();
                saveAndExit();
                return;
            }
            var since = now - totals["last"];
            // A repeat delivery must not launch an overlapping or catch-up burst.
            if (since < 450) {
                Background.exit(null);
                return;
            }
            totals["missed"] += since > 1350 ? (since + 450) / 900 - 1 : 0;
            if (totals["pending"]) { totals["interrupted"]++; }
            totals["last"] = now;
            totals["pending"] = true;
            totals["attempts"]++;
            Storage.setValue("temporal", totals);

            var activity = activityState();
            if (activity != 0) {
                countsAndExit(activity == 1 ? "workout" : "unknown");
                return;
            }
            capture = new Capture(method(:completed));
            capture.start(24000);
        } catch (ex) {
            if (totals.hasKey("error") && totals["pending"]) {
                countsAndExit("error");
            } else {
                Background.exit(null);
            }
        }
    }

    // Fail closed if the platform can't report the activity timer state.
    function activityState() as Number {
        try {
            var info = Activity.getActivityInfo();
            if (info == null || info.timerState == null) { return 2; }
            return info.timerState == Activity.TIMER_STATE_OFF ? 0 : 1;
        } catch (ex) {
            return 2;
        }
    }

    function completed(result as Capture) as Void {
        totals["samplingMs"] += result.duration;
        var activity = activityState();
        var report = result.report();
        var key = "error";
        if (activity != 0) {
            key = activity == 1 ? "workout" : "unknown";
        } else if (result.status.equals("Valid-looking PRV")) {
            key = "valid";
        } else if (result.status.equals("Empty / unsupported")) {
            key = "empty";
        } else if (result.status.equals("Suspicious intervals") ||
                   result.status.equals("Insufficient quality")) {
            key = "rejected";
        }
        if (activity == 0) { totals["latest"] = report; }
        countsAndExit(key);
    }

    function countsAndExit(key as String) as Void {
        totals[key]++;
        totals["pending"] = false;
        saveAndExit();
    }

    function saveAndExit() as Void {
        totals["batteryEnd"] = System.getSystemStats().battery;
        try {
            Storage.setValue("temporal", totals);
            System.println("PRV temporal " + totals.toString());
        } catch (ex) {
            System.println("PRV temporal storage error");
        }
        Background.exit(null);
    }
}
