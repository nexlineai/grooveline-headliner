import XCTest
@testable import HeadlinerCore

final class BeatGridTests: XCTestCase {
    func testBeatsAndBars() {
        let g = BeatGrid(bpm: 120, firstBeat: 0.25)
        XCTAssertEqual(g.beatLength, 0.5, accuracy: 1e-12)
        XCTAssertEqual(g.beat(at: 0.25), 0, accuracy: 1e-12)
        XCTAssertEqual(g.beat(at: 2.25), 4, accuracy: 1e-12)
        XCTAssertEqual(g.seconds(atBeat: 8), 4.25, accuracy: 1e-12)
        XCTAssertEqual(g.phase(at: 0.5), 0.5, accuracy: 1e-12)
        XCTAssertEqual(g.bar(at: 2.3), 1)
        XCTAssertEqual(g.beatInBar(at: 1.3), 2)
        XCTAssertEqual(g.beatInBar(at: 0.1), 3) // before the first beat: last beat of the bar before
    }
}

final class MixTests: XCTestCase {
    func testPhaseOffsetWrapsToHalfABeat() {
        XCTAssertEqual(MixMath.phaseOffset(10.0, 10.0), 0, accuracy: 1e-12)
        XCTAssertEqual(MixMath.phaseOffset(10.25, 3.0), 0.25, accuracy: 1e-12)   // B is a quarter beat behind
        XCTAssertEqual(MixMath.phaseOffset(10.0, 3.25), -0.25, accuracy: 1e-12)  // B is ahead
        XCTAssertEqual(MixMath.phaseOffset(0.9, 0.1), -0.2, accuracy: 1e-12)     // across the beat line
    }

    func testCrossfaderIsFullUntilTheMiddle() {
        XCTAssertEqual(MixMath.crossfade(0).a, 1); XCTAssertEqual(MixMath.crossfade(0).b, 0)
        XCTAssertEqual(MixMath.crossfade(0.5).a, 1); XCTAssertEqual(MixMath.crossfade(0.5).b, 1)
        XCTAssertEqual(MixMath.crossfade(0.75).a, 0.5, accuracy: 1e-12); XCTAssertEqual(MixMath.crossfade(0.75).b, 1)
        XCTAssertEqual(MixMath.crossfade(1).a, 0)
    }

    func testPitchAndEQ() {
        XCTAssertEqual(MixMath.pitch(toPlay: 122, at: 124), 2.0 / 122, accuracy: 1e-12)
        XCTAssertEqual(MixMath.eqDecibels(0.5), 0, accuracy: 1e-12)
        XCTAssertEqual(MixMath.eqDecibels(0), -36, accuracy: 1e-12)
        XCTAssertEqual(MixMath.eqDecibels(1), 6, accuracy: 1e-12)
    }

    private func deck(_ beat: Double, bpm: Double = 124, gain: Double = 1, low: Double = 0.5, playing: Bool = true) -> DeckSnapshot {
        DeckSnapshot(playing: playing, gain: gain, bpm: bpm, beat: beat, low: low)
    }

    func testJudgeStates() {
        XCTAssertEqual(MixJudge.read(deck(0, playing: false), deck(0, gain: 0)).state, .silence)
        let solo = MixJudge.read(deck(3.2), deck(0, gain: 0))
        XCTAssertEqual(solo.state, .solo)
        XCTAssertEqual(solo.quality, 1)
    }

    func testLockedBlendWithBassSwapScoresHigh() {
        let r = MixJudge.read(deck(16.0, low: 0.5), deck(48.005, low: 0.0))
        XCTAssertEqual(r.state, .blend)
        XCTAssertFalse(r.bassClash)
        XCTAssertGreaterThan(r.quality, 0.95)
        XCTAssertEqual(r.verdict, "LOCKED")
    }

    func testBothBasslinesCostPoints() {
        let r = MixJudge.read(deck(16.0), deck(48.0))
        XCTAssertTrue(r.bassClash)
        XCTAssertEqual(r.quality, 0.8, accuracy: 1e-9)
    }

    func testGallopingKicksAreATrainWreck() {
        let r = MixJudge.read(deck(16.0, low: 0), deck(48.3, bpm: 126))
        XCTAssertEqual(r.offsetBeats, -0.3, accuracy: 1e-9)
        XCTAssertLessThan(r.quality, 0.3)
        XCTAssertEqual(r.verdict, "TRAIN WRECK")
    }
}

final class VinylTests: XCTestCase {
    /// A deck holding a slow ramp, so the sample value tells where the needle is.
    private func withDeck(frames: Int = 4000, _ body: (UnsafeMutablePointer<DeckShared>) -> Void) {
        let data = UnsafeMutablePointer<Float>.allocate(capacity: frames)
        for i in 0..<frames { data[i] = Float(i) / Float(frames) }
        let s = UnsafeMutablePointer<DeckShared>.allocate(capacity: 1)
        s.initialize(to: DeckShared())
        s.pointee.left = data; s.pointee.right = data; s.pointee.frames = frames
        s.pointee.gain = 1; s.pointee.targetGain = 1
        body(s)
        s.deinitialize(count: 1); s.deallocate(); data.deallocate()
    }

    private func run(_ s: UnsafeMutablePointer<DeckShared>, _ count: Int) -> [Float] {
        var l = [Float](repeating: 9, count: count), r = [Float](repeating: 9, count: count)
        l.withUnsafeMutableBufferPointer { lp in
            r.withUnsafeMutableBufferPointer { rp in
                Vinyl.render(s, left: lp.baseAddress!, right: rp.baseAddress!, count: count)
            }
        }
        return l
    }

    func testNormalSpeedReadsTheRecordFrameByFrame() {
        withDeck { s in
            s.pointee.rate = 1; s.pointee.targetRate = 1; s.pointee.position = 100
            let out = run(s, 50)
            XCTAssertEqual(out[0], 101.0 / 4000, accuracy: 1e-6)
            XCTAssertEqual(out[49], 150.0 / 4000, accuracy: 1e-6)
            XCTAssertEqual(s.pointee.position, 150, accuracy: 1e-9)
        }
    }

    func testStoppedRecordIsSilentAndStaysPut() {
        withDeck { s in
            s.pointee.position = 500
            let out = run(s, 64)
            XCTAssertTrue(out.allSatisfy { $0 == 0 })
            XCTAssertEqual(s.pointee.position, 500, accuracy: 1e-9)
        }
    }

    func testHalfSpeedInterpolatesBetweenFrames() {
        withDeck { s in
            s.pointee.rate = 0.5; s.pointee.targetRate = 0.5; s.pointee.position = 200
            let out = run(s, 3)
            XCTAssertEqual(out[0], 200.5 / 4000, accuracy: 1e-6)
            XCTAssertEqual(out[2], 201.5 / 4000, accuracy: 1e-6)
        }
    }

    func testBackwardsAndTheStartOfTheRecord() {
        withDeck { s in
            s.pointee.rate = -1; s.pointee.targetRate = -1; s.pointee.position = 10
            let out = run(s, 30)
            XCTAssertEqual(out[0], 9.0 / 4000, accuracy: 1e-6)
            XCTAssertEqual(s.pointee.position, 1, accuracy: 1e-9) // stops at the first groove
            XCTAssertEqual(out[29], 0)
        }
    }

    func testMotorGlidesTowardsItsSpeed() {
        withDeck { s in
            s.pointee.targetRate = 1; s.pointee.glide = 0.01; s.pointee.position = 10
            _ = run(s, 100)
            XCTAssertEqual(s.pointee.rate, 1 - pow(0.99, 100), accuracy: 1e-9)
        }
    }

    func testNeedleDropAndPeak() {
        withDeck { s in
            s.pointee.rate = 1; s.pointee.targetRate = 1; s.pointee.seekTo = 2000
            let out = run(s, 10)
            XCTAssertEqual(out[0], 2001.0 / 4000, accuracy: 1e-6)
            XCTAssertEqual(s.pointee.seekTo, -1)
            XCTAssertEqual(s.pointee.peak, 2010.0 / 4000, accuracy: 1e-6)
        }
    }

    func testNothingLoadedIsSilence() {
        let s = UnsafeMutablePointer<DeckShared>.allocate(capacity: 1)
        s.initialize(to: DeckShared())
        XCTAssertTrue(run(s, 16).allSatisfy { $0 == 0 })
        s.deinitialize(count: 1); s.deallocate()
    }

    func testOverviewShowsTheQuietPart() {
        // Loud, then a quiet middle, then loud again.
        var samples = [Float](repeating: 0.8, count: 3000)
        for i in 1000..<2000 { samples[i] = 0.2 }
        let bins = samples.withUnsafeBufferPointer { Vinyl.overview($0.baseAddress!, count: 3000, bins: 3, stride: 1) }
        XCTAssertEqual(bins.count, 3)
        XCTAssertEqual(bins[0], 1, accuracy: 1e-4)
        XCTAssertEqual(bins[1], 0.25, accuracy: 1e-4)
        XCTAssertEqual(bins[2], 1, accuracy: 1e-4)
        XCTAssertTrue(Vinyl.overview(samples, count: 0, bins: 4).isEmpty)
    }

    func testFirstOnset() {
        var x = [Float](repeating: 0, count: 100)
        x[40] = 0.01; x[41] = 0.2
        XCTAssertEqual(x.withUnsafeBufferPointer { Vinyl.firstOnset($0.baseAddress!, count: 100) }, 41)
    }
}
