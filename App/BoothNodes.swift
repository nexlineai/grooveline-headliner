import SpriteKit
import UIKit

// The pieces of gear the booth is built from. Each one only draws itself and shows a value;
// the scene decides what a touch means.

func gearLabel(_ text: String, size: CGFloat, color: UIColor = Palette.dim, mono: Bool = false) -> SKLabelNode {
    let label = SKLabelNode(fontNamed: mono ? "Menlo-Bold" : "AvenirNextCondensed-DemiBold")
    label.text = text
    label.fontSize = size
    label.fontColor = color
    label.verticalAlignmentMode = .center
    label.horizontalAlignmentMode = .center
    return label
}

func panel(_ rect: CGRect, radius: CGFloat) -> SKShapeNode {
    let node = SKShapeNode(rect: rect, cornerRadius: radius)
    node.fillColor = Palette.panel
    node.strokeColor = Palette.edge
    node.lineWidth = 1
    return node
}

/// A slot with a cap that slides along it. `value` 0...1 runs bottom to top, or left to right.
final class FaderNode: SKNode {
    let travel: CGFloat
    let vertical: Bool
    private let cap: SKShapeNode

    var value: Double = 0.5 { didSet { place() } }

    init(travel: CGFloat, vertical: Bool, cap capSize: CGSize, tint: UIColor, centreMark: Bool = false) {
        self.travel = travel
        self.vertical = vertical
        cap = SKShapeNode(rectOf: capSize, cornerRadius: min(capSize.width, capSize.height) * 0.22)
        super.init()

        let slotSize = vertical ? CGSize(width: 4, height: travel + capSize.height) : CGSize(width: travel + capSize.width, height: 4)
        let slot = SKShapeNode(rectOf: slotSize, cornerRadius: 2)
        slot.fillColor = Palette.slot
        slot.strokeColor = Palette.edge
        slot.lineWidth = 1
        addChild(slot)

        // Scale marks beside the slot; the middle one is longer.
        for i in 0...8 {
            let long = i == 4
            let at = (CGFloat(i) / 8 - 0.5) * travel
            let length: CGFloat = long ? 9 : 5
            let mark = SKShapeNode(rectOf: vertical ? CGSize(width: length, height: 1) : CGSize(width: 1, height: length))
            mark.fillColor = long && centreMark ? tint : Palette.dim
            mark.strokeColor = .clear
            let off = max(capSize.width, capSize.height) * 0.5 + 5
            mark.position = vertical ? CGPoint(x: -off, y: at) : CGPoint(x: at, y: -off)
            addChild(mark)
        }

        cap.fillColor = Palette.darkMetal
        cap.strokeColor = Palette.metal
        cap.lineWidth = 1
        let line = SKShapeNode(rectOf: vertical ? CGSize(width: capSize.width * 0.8, height: 2) : CGSize(width: 2, height: capSize.height * 0.8))
        line.fillColor = tint
        line.strokeColor = .clear
        cap.addChild(line)
        addChild(cap)
        place()
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    private func place() {
        let p = (CGFloat(min(1, max(0, value))) - 0.5) * travel
        cap.position = vertical ? CGPoint(x: 0, y: p) : CGPoint(x: p, y: 0)
    }
}

/// A rotary knob. `value` 0...1; 0.5 points straight up.
final class KnobNode: SKNode {
    private let dial = SKNode()

    var value: Double = 0.5 { didSet { dial.zRotation = CGFloat(0.5 - min(1, max(0, value))) * 1.5 * .pi } }

    init(radius: CGFloat, tint: UIColor, title: String) {
        super.init()
        let ring = SKShapeNode(circleOfRadius: radius + 2.5)
        ring.fillColor = Palette.slot
        ring.strokeColor = Palette.edge
        ring.lineWidth = 1
        addChild(ring)

        let body = SKShapeNode(circleOfRadius: radius)
        body.fillColor = Palette.darkMetal
        body.strokeColor = Palette.metal
        body.lineWidth = 1
        dial.addChild(body)
        let pointer = SKShapeNode(rectOf: CGSize(width: 2.5, height: radius * 0.62), cornerRadius: 1)
        pointer.fillColor = tint
        pointer.strokeColor = .clear
        pointer.position = CGPoint(x: 0, y: radius * 0.58)
        dial.addChild(pointer)
        addChild(dial)

        let label = gearLabel(title, size: radius * 0.6)
        label.position = CGPoint(x: 0, y: -radius - 9)
        addChild(label)
    }

    required init?(coder: NSCoder) { fatalError("not used") }
}

/// A push button that lights up.
final class ButtonNode: SKNode {
    let buttonSize: CGSize
    private let face: SKShapeNode
    private let label: SKLabelNode
    private let tint: UIColor

    var lit = false { didSet { if lit != oldValue { paint() } } }

    init(size: CGSize, title: String, tint: UIColor) {
        buttonSize = size
        self.tint = tint
        face = SKShapeNode(rectOf: size, cornerRadius: size.height * 0.28)
        label = gearLabel(title, size: size.height * 0.46)
        super.init()
        face.lineWidth = 1.5
        addChild(face)
        addChild(label)
        paint()
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    private func paint() {
        face.fillColor = lit ? tint : Palette.slot
        face.strokeColor = lit ? tint : tint.withAlphaComponent(0.55)
        label.fontColor = lit ? .black : tint
    }
}

/// A ladder of lights: teal, then orange, then red at the top.
final class MeterNode: SKNode {
    private var lamps: [SKShapeNode] = []

    var level: Double = 0 {
        didSet {
            let on = level * Double(lamps.count)
            for (i, lamp) in lamps.enumerated() { lamp.alpha = Double(i) < on ? 1 : 0.16 }
        }
    }

    init(size: CGSize, lamps count: Int = 10) {
        super.init()
        let h = size.height / CGFloat(count)
        for i in 0..<count {
            let lamp = SKShapeNode(rectOf: CGSize(width: size.width, height: h - 2), cornerRadius: 1)
            lamp.fillColor = i >= count - 1 ? Palette.red : (i >= count - 4 ? Palette.orange : Palette.teal)
            lamp.strokeColor = .clear
            lamp.position = CGPoint(x: 0, y: (CGFloat(i) + 0.5) * h - size.height / 2)
            lamp.alpha = 0.16
            addChild(lamp)
            lamps.append(lamp)
        }
    }

    required init?(coder: NSCoder) { fatalError("not used") }
}

/// Pictures drawn once with Core Graphics and reused as textures.
enum Draw {
    /// The platter with a record on it, seen from above. `radius` is the record; the platter's
    /// dotted rim reaches to `radius * 1.07`, which is the size of the picture.
    static func platter(radius r: CGFloat, label: UIColor) -> SKTexture {
        let outer = r * 1.07
        let size = CGSize(width: outer * 2, height: outer * 2)
        let image = UIGraphicsImageRenderer(size: size).image { context in
            let c = context.cgContext
            let mid = CGPoint(x: outer, y: outer)
            func ring(_ radius: CGFloat) -> CGRect {
                CGRect(x: mid.x - radius, y: mid.y - radius, width: radius * 2, height: radius * 2)
            }
            // Platter rim with strobe dots.
            c.setFillColor(Palette.darkMetal.cgColor)
            c.fillEllipse(in: ring(outer))
            c.setStrokeColor(Palette.metal.withAlphaComponent(0.6).cgColor)
            c.setLineWidth(1)
            c.strokeEllipse(in: ring(outer - 0.5))
            c.setFillColor(Palette.metal.cgColor)
            let dots = 72
            for i in 0..<dots {
                let a = CGFloat(i) / CGFloat(dots) * 2 * .pi
                let p = CGPoint(x: mid.x + cos(a) * r * 1.035, y: mid.y + sin(a) * r * 1.035)
                let d = r * 0.011
                c.fillEllipse(in: CGRect(x: p.x - d, y: p.y - d, width: d * 2, height: d * 2))
            }
            // Vinyl and its grooves; every few rings a brighter gap between tracks.
            c.setFillColor(UIColor(white: 0.03, alpha: 1).cgColor)
            c.fillEllipse(in: ring(r))
            var groove = r * 0.965
            var i = 0
            while groove > r * 0.42 {
                let gap = i % 8 == 0
                c.setStrokeColor(UIColor(white: 1, alpha: gap ? 0.12 : 0.04).cgColor)
                c.setLineWidth(gap ? 1 : 0.5)
                c.strokeEllipse(in: ring(groove))
                groove -= r * 0.02
                i += 1
            }
            // Label, with a stripe the eye can follow.
            let lr = r * 0.34
            c.setFillColor(label.cgColor)
            c.fillEllipse(in: ring(lr))
            c.setStrokeColor(UIColor(white: 0, alpha: 0.3).cgColor)
            c.setLineWidth(lr * 0.07)
            c.strokeEllipse(in: ring(lr * 0.74))
            c.setStrokeColor(UIColor.white.cgColor)
            c.setLineWidth(max(2, r * 0.035))
            c.setLineCap(.round)
            c.move(to: CGPoint(x: mid.x, y: mid.y - lr * 0.3))
            c.addLine(to: CGPoint(x: mid.x, y: mid.y - lr * 0.9))
            c.strokePath()
            // A sticker at the edge of the vinyl, the way DJs mark where the first beat is.
            c.setFillColor(UIColor.white.withAlphaComponent(0.9).cgColor)
            c.fill(CGRect(x: mid.x - r * 0.022, y: mid.y - r * 0.99, width: r * 0.044, height: r * 0.11))
            // Spindle.
            c.setFillColor(Palette.metal.cgColor)
            c.fillEllipse(in: ring(r * 0.035))
        }
        return SKTexture(image: image)
    }

    /// The record's loudness along its length, mirrored round the middle line like a waveform.
    /// `ticks` (0...1 along the strip) mark where each sixteen-bar phrase starts.
    static func waveform(_ levels: [Float], size: CGSize, tint: UIColor, ticks: [CGFloat]) -> SKTexture {
        let image = UIGraphicsImageRenderer(size: size).image { context in
            let c = context.cgContext
            let mid = size.height / 2
            if levels.count > 1 {
                let step = size.width / CGFloat(levels.count - 1)
                c.move(to: CGPoint(x: 0, y: mid))
                for (i, level) in levels.enumerated() {
                    let h = max(0.6, CGFloat(level) * (mid - 1))
                    c.addLine(to: CGPoint(x: CGFloat(i) * step, y: mid - h))
                }
                for (i, level) in levels.enumerated().reversed() {
                    let h = max(0.6, CGFloat(level) * (mid - 1))
                    c.addLine(to: CGPoint(x: CGFloat(i) * step, y: mid + h))
                }
                c.closePath()
                c.setFillColor(tint.withAlphaComponent(0.85).cgColor)
                c.fillPath()
            } else {
                c.setFillColor(Palette.dim.cgColor)
                c.fill(CGRect(x: 0, y: mid - 0.5, width: size.width, height: 1))
            }
            c.setFillColor(UIColor.white.withAlphaComponent(0.55).cgColor)
            for tick in ticks {
                c.fill(CGRect(x: tick * size.width - 0.5, y: size.height - 3, width: 1, height: 3))
            }
        }
        return SKTexture(image: image)
    }

    /// Light lying across the grooves. It stays still while the record turns under it.
    static func sheen(radius r: CGFloat) -> SKTexture {
        let size = CGSize(width: r * 2, height: r * 2)
        let image = UIGraphicsImageRenderer(size: size).image { context in
            let c = context.cgContext
            let mid = CGPoint(x: r, y: r)
            c.addEllipse(in: CGRect(x: 0, y: 0, width: r * 2, height: r * 2).insetBy(dx: r * 0.03, dy: r * 0.03))
            c.addEllipse(in: CGRect(x: 0, y: 0, width: r * 2, height: r * 2).insetBy(dx: r * 0.63, dy: r * 0.63))
            c.clip(using: .evenOdd)
            let wedges: [(CGFloat, UIColor)] = [(-0.5, Palette.orange), (.pi - 0.5, Palette.magenta)]
            for (angle, tint) in wedges {
                for k in 0..<16 {
                    let narrow = CGFloat(k) / 16 * 0.36
                    c.setFillColor(tint.withAlphaComponent(0.022).cgColor)
                    c.move(to: mid)
                    c.addArc(center: mid, radius: r, startAngle: angle - 0.38 + narrow, endAngle: angle + 0.38 - narrow, clockwise: false)
                    c.closePath()
                    c.fillPath()
                }
            }
        }
        return SKTexture(image: image)
    }

    /// A soft radial stage-light wash cast from the upper left or right of the room onto the floor.
    static func stageWash(size: CGSize, tint: UIColor, fromLeft: Bool) -> SKTexture {
        let w = max(16, size.width), h = max(16, size.height)
        let image = UIGraphicsImageRenderer(size: CGSize(width: w, height: h)).image { context in
            let c = context.cgContext
            let start = CGPoint(x: fromLeft ? w * 0.14 : w * 0.86, y: 0)
            let end = CGPoint(x: fromLeft ? w * 0.32 : w * 0.68, y: h * 0.85)
            let colours = [
                tint.withAlphaComponent(0.75).cgColor,
                tint.withAlphaComponent(0.24).cgColor,
                tint.withAlphaComponent(0).cgColor,
            ] as CFArray
            if let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colours, locations: [0, 0.45, 1]) {
                c.drawRadialGradient(grad, startCenter: start, startRadius: 0,
                                     endCenter: end, endRadius: max(w * 0.52, h * 1.15), options: [])
            }
        }
        return SKTexture(image: image)
    }
}

/// A tonearm lying along +x from its pivot (the node's origin); turn the node to move the needle.
func makeTonearm(length: CGFloat, unit u: CGFloat) -> SKNode {
    let arm = SKNode()
    let base = SKShapeNode(circleOfRadius: 9 * u)
    base.fillColor = Palette.darkMetal
    base.strokeColor = Palette.metal
    base.lineWidth = 1
    arm.addChild(base)
    let weight = SKShapeNode(rectOf: CGSize(width: 15 * u, height: 11 * u), cornerRadius: 3 * u)
    weight.fillColor = Palette.metal
    weight.strokeColor = .clear
    weight.position = CGPoint(x: -13 * u, y: 0)
    arm.addChild(weight)
    let tube = SKShapeNode(rectOf: CGSize(width: length, height: 3 * u), cornerRadius: 1.5 * u)
    tube.fillColor = Palette.metal
    tube.strokeColor = .clear
    tube.position = CGPoint(x: length / 2, y: 0)
    arm.addChild(tube)
    let shell = SKShapeNode(rectOf: CGSize(width: 15 * u, height: 8 * u), cornerRadius: 1.5 * u)
    shell.fillColor = Palette.slot
    shell.strokeColor = Palette.metal
    shell.lineWidth = 1
    shell.position = CGPoint(x: length - 4 * u, y: 0)
    arm.addChild(shell)
    return arm
}
