import Toybox.Lang;
import Toybox.Test;

(:test)
function testKnownRmssd(logger as Logger) as Boolean {
    var q = new Quality();
    q.add([914, 954, 914, 954], 4000);
    return q.pairs == 3 && q.usable == 4 && q.coverageMs == 3736
        && q.rmssd() == 40.0;
}

(:test)
function testNullAndEmpty(logger as Logger) as Boolean {
    var q = new Quality();
    q.add(null, 4000);
    q.add([], 8000);
    return q.empty == 2 && q.seen == 0 && q.pairs == 0
        && q.result(8000, 0, 1).equals("Empty / unsupported");
}

(:test)
function testInvalidAndGap(logger as Logger) as Boolean {
    var q = new Quality();
    q.add([910, null, 950, 990, 100, 930], 4000);
    q.add([980, 1010], 12000);
    return q.rejected == 2 && q.gaps == 1 && q.pairs == 2
        && q.squareSum == 2500.0;
}

(:test)
function testReplay(logger as Logger) as Boolean {
    var q = new Quality();
    for (var i = 1; i < 5; i++) {
        q.add([902, 912, 922, 932], i * 4000);
    }
    return q.replay == 3 && q.usable == 4 && q.pairs == 3
        && q.result(16000, 0, 1).equals("Suspicious intervals");
}

(:test)
function testBpmLattice(logger as Logger) as Boolean {
    var q = new Quality();
    q.add([1000, 984, 968, 952], 4000);
    q.add([938, 923, 909, 896], 8000);
    return q.bpmHits == 8 && q.result(8000, 0, 1).equals("Suspicious intervals");
}

(:test)
function testPassAndCoverageGate(logger as Logger) as Boolean {
    var q = new Quality();
    q.add([912, 945, 916, 949], 4000);
    q.add([920, 953, 924, 957], 8000);
    return q.result(8000, 5000, 6).equals("Valid-looking PRV")
        && q.result(20000, 5000, 6).equals("Insufficient quality");
}
