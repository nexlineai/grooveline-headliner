// swift-tools-version:5.10
// HeadlinerCore: pure Swift (beat grids, the record reader, mix judging), tested with `swift test` on the CI host.
// HeadlinerAudio: the deck engine on AVAudioEngine; the audio-session part is iOS-only, the rest builds on macOS for tests.
import PackageDescription

let package = Package(
    name: "HeadlinerKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "HeadlinerCore", targets: ["HeadlinerCore"]),
        .library(name: "HeadlinerAudio", targets: ["HeadlinerAudio"]),
    ],
    targets: [
        .target(name: "HeadlinerCore"),
        .target(name: "HeadlinerAudio", dependencies: ["HeadlinerCore"]),
        .testTarget(name: "HeadlinerCoreTests", dependencies: ["HeadlinerCore"]),
    ]
)
