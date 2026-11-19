import Toybox.Application;
import Toybox.Application.Storage;
import Toybox.Background;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

(:background)
class ProbeApp extends Application.AppBase {
    function initialize() { AppBase.initialize(); }

    function getServiceDelegate() as [ServiceDelegate] { return [new TemporalProbe()]; }

    function getInitialView() as [Views] or [Views, InputDelegates] {
        var screen = new ProbeView();
        return [screen, new ProbeControls(screen)];
    }
}

class ProbeView extends WatchUi.View {
    var capture = null;
    var saved as Dictionary or Null;
    var redraw = null;
    var storageError = false;
    var temporalPage = false;
    var message = "";

    function initialize() {
        View.initialize();
        saved = Storage.getValue("foreground");
    }

    function begin() as Void {
        if (capture != null && capture.running) { return; }
        var state = Storage.getValue("temporal");
        if (state instanceof Dictionary && state["enabled"]) {
            temporalPage = true;
            message = "Stop background to retest";
            refresh();
            return;
        }
        temporalPage = false;
        storageError = false;
        capture = new Capture(method(:completed));
        redraw = new Timer.Timer();
        redraw.start(method(:refresh), 1000, true);
        capture.start(240000);
        refresh();
    }

    function showTemporal() as Void {
        if (capture != null && capture.running) { return; }
        temporalPage = !temporalPage;
        message = "";
        refresh();
    }

    function toggleTemporal() as Void {
        if (capture != null && capture.running) { return; }
        var state = Storage.getValue("temporal");
        temporalPage = true;
        try {
            if (state instanceof Dictionary && state["enabled"]) {
                Background.deleteTemporalEvent();
                state["enabled"] = false;
                Storage.setValue("temporal", state);
                message = "Background stopped";
            } else if (saved != null && saved["rmssd"] != null) {
                var now = Time.now().value();
                var battery = System.getSystemStats().battery;
                Storage.setValue("temporal", {
                    "enabled" => true, "expires" => now + 93600,
                    "last" => now, "pending" => false, "attempts" => 0,
                    "valid" => 0, "empty" => 0, "rejected" => 0, "error" => 0,
                    "missed" => 0, "interrupted" => 0, "workout" => 0, "unknown" => 0,
                    "samplingMs" => 0, "batteryStart" => battery, "batteryEnd" => battery
                });
                try {
                    Background.registerForTemporalEvent(new Time.Duration(900));
                } catch (ex) {
                    var failed = Storage.getValue("temporal") as Dictionary;
                    failed["enabled"] = false;
                    Storage.setValue("temporal", failed);
                    throw ex;
                }
                message = "Background armed";
            } else {
                message = "Pass foreground first";
            }
        } catch (ex) {
            message = "Schedule / storage error";
        }
        refresh();
    }

    function drawTemporal(dc as Dc) as Void {
        var state = Storage.getValue("temporal");
        if (state instanceof Dictionary) {
            line(dc, 106, state["enabled"] ? "Background: armed" : "Background: off", 0x65E6C4);
            line(dc, 143, "Attempts " + state["attempts"] + "  valid " + state["valid"], 0xF2F6FF);
            line(dc, 180, "Empty " + state["empty"] + "  rejected " + state["rejected"], 0xF2F6FF);
            line(dc, 217, "Errors " + state["error"] + "  missed ~" + state["missed"], 0xF2F6FF);
            var interrupted = state["interrupted"] + (state["pending"] ? 1 : 0);
            line(dc, 254, "Interrupted " + interrupted + "  workout " + state["workout"], 0xF2F6FF);
            line(dc, 291, "Unknown " + state["unknown"] + "  sec " + (state["samplingMs"] / 1000), 0xF2F6FF);
            if (message.length() == 0) {
                line(dc, 366, state["batteryStart"].format("%.1f") + " > " +
                    state["batteryEnd"].format("%.1f") + "%", 0x9BB0BD);
            }
        }
        line(dc, 326, message.length() == 0 ? "Hold UP: arm / stop" : message, 0x9BB0BD);
    }

    function refresh() as Void { WatchUi.requestUpdate(); }

    function completed(result as Capture) as Void {
        if (redraw != null) { redraw.stop(); }
        saved = result.report();
        try { Storage.setValue("foreground", saved); }
        catch (ex) { storageError = true; }
        // A pre-created USB debug log gets one compact summary, never raw intervals.
        System.println("PRV foreground " + saved.toString());
        refresh();
    }

    function onHide() as Void {
        if (capture != null && capture.running) { capture.finish("Interrupted"); }
    }

    function onUpdate(dc as Dc) as Void {
        dc.setColor(0xF2F6FF, 0x081520);
        dc.clear();
        line(dc, 66, "Optical PRV Test", 0x65E6C4);
        if (temporalPage) {
            drawTemporal(dc);
        } else if (capture != null && capture.running) {
            var quality = capture.quality;
            line(dc, 127, (capture.elapsed() / 1000) + " / 240 sec", 0xF2F6FF);
            line(dc, 181, "Usable " + quality.usable + " / " + quality.seen, 0xF2F6FF);
            line(dc, 235, "Coverage " + (quality.coverageMs / 1000) + " sec", 0xF2F6FF);
            line(dc, 293, "Sit still, wrist relaxed", 0x9BB0BD);
        } else if (saved != null) {
            line(dc, 120, saved["status"], 0xF2F6FF);
            line(dc, 167, "Usable " + saved["usable"] + " / " + saved["seen"], 0xF2F6FF);
            line(dc, 214, "Coverage " + (saved["coverageMs"] / 1000) + " sec", 0xF2F6FF);
            var value = saved["rmssd"];
            line(dc, 262, value == null ? "RMSSD --" : "PRV " + value.format("%.1f") + " ms", 0x65E6C4);
            line(dc, 309, "Battery " + saved["batteryStart"].format("%.1f") + " > " +
                saved["batteryEnd"].format("%.1f") + "%", 0x9BB0BD);
            line(dc, 352, storageError ? "Local save failed" : "START: repeat | DOWN", 0x9BB0BD);
        } else {
            line(dc, 133, "Wrist sensor only", 0xF2F6FF);
            line(dc, 187, "Sit quietly for 4 min", 0xF2F6FF);
            line(dc, 246, "START: collect", 0x65E6C4);
            line(dc, 300, "DOWN: background", 0x9BB0BD);
        }
    }

    function line(dc as Dc, y as Number, text as String, color as Number) as Void {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, y * dc.getHeight() / 454,
            Graphics.FONT_XTINY, text, Graphics.TEXT_JUSTIFY_CENTER);
    }
}

class ProbeControls extends WatchUi.BehaviorDelegate {
    var view;
    function initialize(screen as ProbeView) {
        BehaviorDelegate.initialize();
        view = screen;
    }

    function onNextPage() as Boolean { view.showTemporal(); return true; }

    function onMenu() as Boolean { view.toggleTemporal(); return true; }

    function onSelect() as Boolean {
        view.begin();
        return true;
    }
}
