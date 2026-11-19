import Toybox.Lang;
import Toybox.Sensor;
import Toybox.System;
import Toybox.Timer;

(:background)
class Capture {
    var quality;
    var running = false;
    var startedAt = 0;
    var duration = 0;
    var batteryStart = 0.0;
    var batteryEnd = 0.0;
    var registered = false;
    var onboard = false;
    var timer = null;
    var limit = 0;
    var done;
    var status = "";

    function initialize(onDone) {
        done = onDone;
        quality = new Quality();
    }

    function elapsed() as Number {
        return running ? System.getTimer() - startedAt : duration;
    }

    function start(milliseconds as Number) as Void {
        if (running) { return; }
        limit = milliseconds;
        startedAt = System.getTimer();
        batteryStart = System.getSystemStats().battery;
        running = true;
        try {
            onboard = Sensor.enableSensorType(Sensor.SENSOR_ONBOARD_HEARTRATE);
            if (!onboard) {
                finish("Onboard request failed");
                return;
            }
            Sensor.registerSensorDataListener(method(:onSensorData), {
                :period => 4,
                :heartBeatIntervals => {:enabled => true}
            });
            registered = true;
            timer = new Timer.Timer();
            timer.start(method(:onDeadline), milliseconds, false);
        } catch (ex) {
            finish("Sensor / API error");
        }
    }

    function onSensorData(data as Sensor.SensorData) as Void {
        if (!running) { return; }
        try {
            var tick = elapsed();
            if (tick > limit) {
                onDeadline();
                return;
            }
            var heart = data.heartRateData;
            quality.add(heart == null ? null : heart.heartBeatIntervals, tick);
        } catch (ex) {
            finish("Sensor callback error");
        }
    }

    function onDeadline() as Void {
        finish("");
    }

    function finish(reason as String) as Void {
        if (!running) { return; }
        duration = elapsed();
        running = false;
        status = reason;
        if (timer != null) { timer.stop(); }
        if (registered) {
            try { Sensor.unregisterSensorDataListener(); }
            catch (ex) { status = "Sensor cleanup error"; }
        }
        if (onboard) {
            try {
                if (!Sensor.disableSensorType(Sensor.SENSOR_ONBOARD_HEARTRATE)) {
                    status = "Sensor cleanup error";
                }
            }
            catch (ex) { status = "Sensor cleanup error"; }
        }
        batteryEnd = System.getSystemStats().battery;
        if (status.length() == 0) {
            status = quality.result(duration, limit > 30000 ? 120000 : 14000,
                limit > 30000 ? 70 : 8);
        }
        done.invoke(self);
    }

    function report() as Dictionary {
        return {
            "status" => status, "elapsedMs" => duration, "seen" => quality.seen,
            "usable" => quality.usable, "rejected" => quality.rejected,
            "callbacks" => quality.batches, "empty" => quality.empty, "gaps" => quality.gaps,
            "replay" => quality.replay, "bpmHits" => quality.bpmHits,
            "repeats" => quality.repeats, "coverageMs" => quality.coverageMs,
            "firstCallbackMs" => quality.firstTick, "lastCallbackMs" => quality.priorTick,
            "pairs" => quality.pairs, "onboardRequested" => onboard,
            "batteryStart" => batteryStart, "batteryEnd" => batteryEnd,
            "rmssd" => status.equals("Valid-looking PRV") ? quality.rmssd() : null
        };
    }
}
