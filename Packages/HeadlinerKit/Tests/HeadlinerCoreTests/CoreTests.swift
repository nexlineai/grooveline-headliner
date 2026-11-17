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

final class MixerTests: XCTestCase {
    /// Two decks, each playing a steady tone (deck 0 at `hz0`, deck 1 at `hz1`), through the mixer.
    private func mix(hz0: Double = 440, hz1: Double = 880, frames: Int = 44_100, split: Bool = false, cueMix: Float = 0,
                     master: Float = 1, twoOutputs: Bool = false,
                     set: (UnsafeMutablePointer<ChannelStrip>, UnsafeMutablePointer<ChannelStrip>) -> Void) -> (left: [Float], right: [Float], phones: [Float]) {
        let rate = 44_100.0
        let tones = [hz0, hz1].map { hz -> UnsafeMutablePointer<Float> in
            let p = UnsafeMutablePointer<Float>.allocate(capacity: frames * 2)
            for i in 0..<frames * 2 { p[i] = Float(0.5 * sin(2 * Double.pi * hz * Double(i) / rate)) }
            return p
        }
        let decks = UnsafeMutablePointer<UnsafeMutablePointer<DeckShared>>.allocate(capacity: 2)
        let strips = UnsafeMutablePointer<UnsafeMutablePointer<ChannelStrip>>.allocate(capacity: 2)
        for d in 0..<2 {
            let s = UnsafeMutablePointer<DeckShared>.allocate(capacity: 1)
            s.initialize(to: DeckShared())
            s.pointee.left = tones[d]; s.pointee.right = tones[d]; s.pointee.frames = frames * 2
            s.pointee.gain = 1; s.pointee.targetGain = 1; s.pointee.rate = 1; s.pointee.targetRate = 1; s.pointee.position = 1
            (decks + d).initialize(to: s)
            let c = UnsafeMutablePointer<ChannelStrip>.allocate(capacity: 1)
            c.initialize(to: ChannelStrip())
            (strips + d).initialize(to: c)
        }
        let mixer = UnsafeMutablePointer<MixerShared>.allocate(capacity: 1)
        mixer.initialize(to: MixerShared())
        mixer.pointee.sampleRate = rate; mixer.pointee.split = split; mixer.pointee.cueMix = cueMix
        mixer.pointee.master = master
        set(strips[0], strips[1])
        let left = UnsafeMutablePointer<Float>.allocate(capacity: frames)
        let right = UnsafeMutablePointer<Float>.allocate(capacity: frames)
        let phonesL = UnsafeMutablePointer<Float>.allocate(capacity: frames)
        let phonesR = UnsafeMutablePointer<Float>.allocate(capacity: frames)
        for p in [left, right, phonesL, phonesR] { p.initialize(repeating: 9, count: frames) }
        let scratch = UnsafeMutablePointer<Float>.allocate(capacity: 1024)
        var done = 0
        while done < frames { // in buffers of 512, like the phone
            let n = min(512, frames - done)
            if twoOutputs {
                Mixer.render(decks: decks, strips: strips, deckCount: 2, mixer: mixer, scratch: scratch,
                             left: left + done, right: right + done,
                             phonesLeft: phonesL + done, phonesRight: phonesR + done, count: n)
            } else {
                Mixer.render(decks: decks, strips: strips, deckCount: 2, mixer: mixer, scratch: scratch,
                             left: left + done, right: right + done, count: n)
            }
            done += n
        }
        let out = (Array(UnsafeBufferPointer(start: left, count: frames)),
                   Array(UnsafeBufferPointer(start: right, count: frames)),
                   Array(UnsafeBufferPointer(start: phonesL, count: frames)))
        for d in 0..<2 { decks[d].deallocate(); strips[d].deallocate(); tones[d].deallocate() }
        for p in [left, right, phonesL, phonesR, scratch] { p.deallocate() }
        decks.deallocate(); strips.deallocate(); mixer.deallocate()
        return out
    }

    /// How strongly `hz` is present in the second half of `x` (amplitude of that tone).
    /// Half a second holds a whole number of cycles of every tone used here, so tones do not leak into each other.
    private func level(_ x: [Float], hz: Double) -> Double {
        var re = 0.0, im = 0.0
        let from = x.count / 2
        for i in from..<x.count {
            let a = 2 * Double.pi * hz * Double(i) / 44_100
            re += Double(x[i]) * cos(a); im += Double(x[i]) * sin(a)
        }
        return 2 * (re * re + im * im).squareRoot() / Double(x.count - from)
    }

    func testFlatMixerPassesBothDecks() {
        let out = mix { _, _ in }
        XCTAssertEqual(level(out.left, hz: 440), 0.5, accuracy: 0.01)
        XCTAssertEqual(level(out.left, hz: 880), 0.5, accuracy: 0.01)
        XCTAssertEqual(level(out.right, hz: 440), 0.5, accuracy: 0.01)
    }

    func testFaderDownIsSilent() {
        let out = mix { a, _ in a.pointee.fader = 0 }
        XCTAssertLessThan(level(out.left, hz: 440), 0.001)
        XCTAssertEqual(level(out.left, hz: 880), 0.5, accuracy: 0.01)
    }

    func testSplitPutsTheRoomLeftAndTheCueRight() {
        // Deck 0 plays to the room. Deck 1 has its fader down and its headphone cue on.
        let out = mix(split: true) { _, b in b.pointee.fader = 0; b.pointee.cue = 1 }
        XCTAssertEqual(level(out.left, hz: 440), 0.5, accuracy: 0.01)
        XCTAssertLessThan(level(out.left, hz: 880), 0.001)
        XCTAssertEqual(level(out.right, hz: 880), 0.5, accuracy: 0.01)
        XCTAssertLessThan(level(out.right, hz: 440), 0.001)
    }

    func testCueMixBringsTheRoomIntoTheHeadphones() {
        let out = mix(split: true, cueMix: 0.5) { _, b in b.pointee.fader = 0; b.pointee.cue = 1 }
        XCTAssertEqual(level(out.right, hz: 880), 0.25, accuracy: 0.01)
        XCTAssertEqual(level(out.right, hz: 440), 0.25, accuracy: 0.01)
        XCTAssertEqual(level(out.left, hz: 440), 0.5, accuracy: 0.01)
    }

    func testLowKillTakesTheBassAndLeavesTheRest() {
        // 60 Hz and 3 kHz through deck 0 with the low knob all the way down; deck 1 silent.
        let bass = mix(hz0: 60) { a, b in a.pointee.lowDB = -36; b.pointee.fader = 0 }
        XCTAssertLessThan(level(bass.left, hz: 60), 0.5 * 0.03) // at least 30 dB down
        let top = mix(hz0: 3_000) { a, b in a.pointee.lowDB = -36; b.pointee.fader = 0 }
        XCTAssertEqual(level(top.left, hz: 3_000), 0.5, accuracy: 0.03)
    }

    func testHighKillAndMidBoost() {
        let top = mix(hz0: 12_000) { a, b in a.pointee.highDB = -36; b.pointee.fader = 0 }
        XCTAssertLessThan(level(top.left, hz: 12_000), 0.5 * 0.03)
        let mid = mix(hz0: 1_000) { a, b in a.pointee.midDB = 6; b.pointee.fader = 0 }
        XCTAssertEqual(level(mid.left, hz: 1_000), 0.5 * 1.995, accuracy: 0.03)
        let low = mix(hz0: 60) { a, b in a.pointee.highDB = -36; b.pointee.fader = 0 }
        XCTAssertEqual(level(low.left, hz: 60), 0.5, accuracy: 0.02)
    }

    func testTwoOutputsCarryTheRoomAndTheHeadphones() {
        // Deck 0 plays to the room. Deck 1 has its fader down and its headphone cue on.
        let out = mix(twoOutputs: true) { _, b in b.pointee.fader = 0; b.pointee.cue = 1 }
        XCTAssertEqual(level(out.left, hz: 440), 0.5, accuracy: 0.01)
        XCTAssertLessThan(level(out.left, hz: 880), 0.001)
        XCTAssertEqual(level(out.phones, hz: 880), 0.5, accuracy: 0.01)
        XCTAssertLessThan(level(out.phones, hz: 440), 0.001)
        // With the cue mix all the way to ROOM the headphones hear what the room hears.
        let room = mix(cueMix: 1, twoOutputs: true) { _, b in b.pointee.fader = 0; b.pointee.cue = 1 }
        XCTAssertEqual(level(room.phones, hz: 440), 0.5, accuracy: 0.01)
        XCTAssertLessThan(level(room.phones, hz: 880), 0.001)
    }

    func testMasterVolumeTurnsEverythingDown() {
        let out = mix(master: 0.5) { _, _ in }
        XCTAssertEqual(level(out.left, hz: 440), 0.25, accuracy: 0.01)
        XCTAssertEqual(level(out.right, hz: 880), 0.25, accuracy: 0.01)
    }
}

final class HarmonyTests: XCTestCase {
    func testNeighboursOnTheWheel() {
        XCTAssertTrue(Harmony.compatible("2A", "2A"))
        XCTAssertTrue(Harmony.compatible("2A", "3A"))
        XCTAssertTrue(Harmony.compatible("2A", "1A"))
        XCTAssertTrue(Harmony.compatible("12A", "1A")) // the wheel wraps
        XCTAssertTrue(Harmony.compatible("1B", "12B"))
        XCTAssertTrue(Harmony.compatible("2A", "2B"))   // relative major
        XCTAssertFalse(Harmony.compatible("2A", "4A"))
        XCTAssertFalse(Harmony.compatible("2A", "8A"))
        XCTAssertFalse(Harmony.compatible("2A", "3B"))
        XCTAssertFalse(Harmony.compatible("3A", "10A"))
        XCTAssertTrue(Harmony.compatible("2A", "?"))    // unknown keys never clash
    }

    func testPitchMovesTheKey() {
        XCTAssertEqual(Harmony.detune(0, 0), 0, accuracy: 1e-12)
        XCTAssertEqual(Harmony.detune(2.0 / 128, 0), 0.268, accuracy: 0.002) // 128 -> 130
        XCTAssertFalse(Harmony.clash("9A", pitch: 0.0156, "10A", pitch: 0))   // Sinal at 130 with Portão
        XCTAssertTrue(Harmony.clash("2A", pitch: 0.03125, "3A", pitch: 0))    // 128 pushed to 132: half a semitone out
        XCTAssertTrue(Harmony.clash("2A", pitch: 0, "8A", pitch: 0))
    }
}

final class FilterTests: XCTestCase {
    /// RMS of a sine after it went through one filter (second half, once the filter has settled).
    private func rms(through shape: Biquad.Shape, at hz: Double, tone: Double) -> Float {
        var f = Biquad()
        f.set(shape, frequency: hz, gainDB: 0, q: 1.0, sampleRate: 48_000)
        let n = 9_600
        var l = (0..<n).map { Float(sin(2 * Double.pi * tone * Double($0) / 48_000)) }
        var r = l
        l.withUnsafeMutableBufferPointer { lp in
            r.withUnsafeMutableBufferPointer { rp in f.run(lp.baseAddress!, rp.baseAddress!, count: n) }
        }
        let tail = l[(n / 2)...]
        return sqrt(tail.reduce(0) { $0 + $1 * $1 } / Float(tail.count))
    }

    func testLowPassKeepsTheBassAndTakesTheTop() {
        XCTAssertGreaterThan(rms(through: .lowPass, at: 300, tone: 60), 0.6)
        XCTAssertLessThan(rms(through: .lowPass, at: 300, tone: 5_000), 0.01)
    }

    func testHighPassTakesTheBass() {
        XCTAssertGreaterThan(rms(through: .highPass, at: 2_000, tone: 8_000), 0.6)
        XCTAssertLessThan(rms(through: .highPass, at: 2_000, tone: 60), 0.01)
    }

    func testKnobPositions() {
        XCTAssertEqual(Mixer.filterHz(-1), 100, accuracy: 0.01)
        XCTAssertEqual(Mixer.filterHz(1), 8_000, accuracy: 0.01)
        XCTAssertEqual(Mixer.filterHz(-0.5), 20_000 * sqrt(100.0 / 20_000), accuracy: 0.01)
    }
}

final class DrumMachineTests: XCTestCase {
    func testWholeBarsAndSilenceForAnEmptyPattern() {
        let audio = DrumMachine.render(DrumPattern(), bpm: 120, bars: 2)
        XCTAssertEqual(DrumMachine.barFrames(bpm: 120), 88_200)
        XCTAssertEqual(audio.left.count, 176_400)
        XCTAssertEqual(audio.right.count, 176_400)
        XCTAssertEqual(audio.left.map { abs($0) }.max() ?? 1, 0)
    }

    func testKickOnStepOneStartsAtSampleZero() {
        var p = DrumPattern()
        p.rows[0][0] = true
        let audio = DrumMachine.render(p, bpm: 124, bars: 1)
        XCTAssertGreaterThan(abs(audio.left[0]), 0.5)
    }

    func testAHitLandsOnItsStep() {
        var p = DrumPattern()
        p.rows[1][4] = true
        let audio = DrumMachine.render(p, bpm: 120, bars: 1)
        let at = DrumMachine.stepFrame(4, bpm: 120)
        XCTAssertEqual(at, 22_050)
        XCTAssertEqual(audio.left[0..<at].map { abs($0) }.max() ?? 1, 0)
        XCTAssertGreaterThan(audio.left[at..<(at + 2_205)].map { abs($0) }.max() ?? 0, 0.05)
    }

    func testTheHouseGroove() {
        XCTAssertEqual(DrumPattern.house.on(0), [0, 4, 8, 12])
        XCTAssertEqual(DrumPattern.house.on(1), [4, 12])
        XCTAssertEqual(DrumPattern.house.on(2), [2, 6, 10, 14])
    }
}

final class StudioSynthTests: XCTestCase {
    func testFiveRowsEvenFromAShorterPattern() {
        XCTAssertEqual(DrumPattern().rows.count, 5)
        XCTAssertEqual(DrumPattern.house.rows.count, 5)
        XCTAssertTrue(DrumPattern.house.rows[3].allSatisfy { !$0 })
        XCTAssertEqual(DrumPattern(rows: [[true]]).rows[0].count, 16)
    }

    func testBassAndChordSound() {
        XCTAssertGreaterThan(DrumMachine.voice(3).map { abs($0) }.max() ?? 0, 0.1)
        XCTAssertGreaterThan(DrumMachine.voice(4).map { abs($0) }.max() ?? 0, 0.1)
        var p = DrumPattern()
        p.rows[3][2] = true
        let audio = DrumMachine.render(p, bpm: 124, bars: 1)
        let at = DrumMachine.stepFrame(2, bpm: 124)
        XCTAssertEqual(audio.left[0..<at].map { abs($0) }.max() ?? 1, 0)
        XCTAssertGreaterThan(audio.left[at..<(at + 4_410)].map { abs($0) }.max() ?? 0, 0.05)
    }
}

final class DubplateTests: XCTestCase {
    func testTheArrangementIsEightyBars() {
        XCTAssertEqual(DrumMachine.arrangement.reduce(0) { $0 + $1.bars }, 80)
        let audio = DrumMachine.render(.track, bpm: 124, sections: DrumMachine.arrangement)
        XCTAssertEqual(audio.left.count, 80 * DrumMachine.barFrames(bpm: 124))
    }

    func testTheIntroHasNoClap() {
        var p = DrumPattern()
        p.rows[1][4] = true // clap only
        let audio = DrumMachine.render(p, bpm: 124, sections: DrumMachine.arrangement)
        let bar = DrumMachine.barFrames(bpm: 124)
        XCTAssertEqual(audio.left[0..<(16 * bar)].map { abs($0) }.max() ?? 1, 0)                 // intro: kick and hat only
        XCTAssertGreaterThan(audio.left[(16 * bar)..<(17 * bar)].map { abs($0) }.max() ?? 0, 0.05) // groove: the clap is in
    }

    func testTheLoopStillWorks() {
        XCTAssertEqual(DrumMachine.render(.house, bpm: 120, bars: 2).left.count, 2 * 88_200)
        XCTAssertEqual(DrumPattern.track.on(3), [2, 6, 10, 14])
        XCTAssertEqual(DrumPattern.track.on(4), [3, 11])
    }
}
