import SwiftUI

/// The Grooveline mark as on grooveline.org: eleven level bars that breathe, and the name in
/// Orbitron Bold, teal. `height` is the height of the bars; everything else follows from it.
struct GroovelineLogo: View {
    var height: CGFloat = 28

    /// Same bars as the site's header (height in px of 28, seconds per swing, start offset).
    private static let bars: [(h: Double, speed: Double, delay: Double)] = [
        (7, 1.15, 0.22), (15, 1.55, 0.78), (24, 1.28, 0.41), (28, 1.72, 1.02), (20, 1.38, 0.63), (26, 1.86, 0.34),
        (13, 1.21, 0.86), (22, 1.64, 0.52), (17, 1.34, 0.12), (24, 1.76, 0.71), (9, 1.18, 0.48),
    ]
    static let teal = Color(red: 0, green: 212 / 255, blue: 200 / 255)
    private static let barTop = Color(red: 77 / 255, green: 1, blue: 224 / 255)
    private static let barBottom = Color(red: 0, green: 169 / 255, blue: 143 / 255)

    var body: some View {
        let k = height / 28
        HStack(alignment: .center, spacing: 8 * k) {
            TimelineView(.animation) { clock in
                let t = clock.date.timeIntervalSinceReferenceDate
                HStack(alignment: .bottom, spacing: 2 * k) {
                    ForEach(0..<Self.bars.count, id: \.self) { i in
                        let bar = Self.bars[i]
                        let swing = Self.swing(t, speed: bar.speed, delay: bar.delay)
                        UnevenRoundedRectangle(topLeadingRadius: 2 * k, topTrailingRadius: 2 * k)
                            .fill(LinearGradient(colors: [Self.barTop, Self.barBottom], startPoint: .top, endPoint: .bottom))
                            .frame(width: 3 * k, height: CGFloat(bar.h) * k)
                            .scaleEffect(x: 1, y: 0.3 + 0.7 * swing, anchor: .bottom)
                            .opacity(0.45 + 0.55 * swing)
                    }
                }
                .frame(height: height, alignment: .bottom)
                .shadow(color: Self.teal.opacity(0.55), radius: 3.5 * k)
            }
            Text("GROOVELINE")
                .font(.custom("Orbitron-Bold", size: 17.6 * k))
                .tracking(4 * k)
                .foregroundStyle(Self.teal)
        }
        .accessibilityElement()
        .accessibilityLabel("Grooveline")
    }

    /// 0...1, easing up and back down again, one way every `speed` seconds.
    private static func swing(_ t: Double, speed: Double, delay: Double) -> Double {
        var x = ((t + delay) / speed).truncatingRemainder(dividingBy: 2)
        if x > 1 { x = 2 - x }
        return x * x * (3 - 2 * x)
    }
}
