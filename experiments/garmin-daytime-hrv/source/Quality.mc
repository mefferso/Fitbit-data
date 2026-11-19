import Toybox.Lang;
import Toybox.Math;

// Each callback is a separate adjacency group. Beat timestamps are unavailable.
(:background)
class Quality {
    var seen = 0;
    var batches = 0;
    var empty = 0;
    var usable = 0;
    var rejected = 0;
    var replay = 0;
    var gaps = 0;
    var bpmHits = 0;
    var repeats = 0;
    var coverageMs = 0;
    var pairs = 0;
    var squareSum = 0.0;
    var last = null;
    var priorBatch as Array or Null;
    var priorTick as Number or Null;
    var firstTick as Number or Null;

    function initialize() {}

    function sameBatch(values as Array, previous as Array or Null) as Boolean {
        if (previous == null || values.size() < 2 || values.size() != previous.size()) {
            return false;
        }
        for (var i = 0; i < values.size(); i++) {
            if (values[i] != previous[i]) { return false; }
        }
        return true;
    }

    function add(values as Array or Null, elapsed as Number) as Void {
        batches++;
        if (firstTick == null) { firstTick = elapsed; }
        if (priorTick != null && (elapsed - priorTick > 5500 || elapsed <= priorTick)) {
            gaps++;
        }
        priorTick = elapsed;
        if (values == null || values.size() == 0) {
            empty++;
            last = null;
            priorBatch = null;
            return;
        }
        seen += values.size();
        if (sameBatch(values, priorBatch)) {
            replay++;
            rejected += values.size();
            last = null;
            return;
        }
        priorBatch = values.slice(0, values.size() > 20 ? 20 : values.size());
        var total = 0;
        for (var i = 0; i < priorBatch.size(); i++) {
            var value = priorBatch[i];
            if (value instanceof Number && value >= 300 && value <= 1800) {
                total += value;
            }
        }
        if (values.size() > 20 || total > 5800) {
            rejected += values.size();
            gaps++;
            last = null;
            return;
        }

        var previous = 0;
        for (var j = 0; j < values.size(); j++) {
            var rr = values[j];
            if (!(rr instanceof Number) || rr < 300 || rr > 1800) {
                rejected++;
                previous = 0;
                last = null;
                continue;
            }
            // Detect an integer-BPM reciprocal lattice. Never feed it into RMSSD.
            var bpm = Math.round(60000.0 / rr);
            if (Math.abs(rr - 60000.0 / bpm) <= 1.0) { bpmHits++; }
            if (last == rr) { repeats++; }
            last = rr;
            if (previous > 0 && Math.abs(rr - previous) > previous * 0.20) {
                rejected++;
                previous = 0;
                continue;
            }
            usable++;
            coverageMs += rr;
            if (previous > 0) {
                var diff = (rr - previous).toFloat();
                squareSum += diff * diff;
                pairs++;
            }
            previous = rr;
        }
    }

    function result(elapsed as Number, minMs as Number, minPairs as Number) as String {
        if (seen == 0) { return "Empty / unsupported"; }
        if ((usable >= 8 && (bpmHits >= usable * 0.85 || repeats >= usable * 0.65)) ||
            replay >= 3) { return "Suspicious intervals"; }
        if (pairs < minPairs || coverageMs < minMs || coverageMs < elapsed * 0.60 ||
            gaps > 2 || rejected > seen * 0.15) { return "Insufficient quality"; }
        return "Valid-looking PRV";
    }

    function rmssd() as Float {
        return Math.sqrt(squareSum / pairs).toFloat();
    }
}
