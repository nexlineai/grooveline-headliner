import UIKit

/// The game's colours: a night palette with Grooveline teal as the thread.
enum Palette {
    static let night = UIColor(red: 0.027, green: 0.035, blue: 0.063, alpha: 1)
    static let panel = UIColor(red: 0.062, green: 0.075, blue: 0.110, alpha: 1)
    static let slot = UIColor(red: 0.02, green: 0.025, blue: 0.04, alpha: 1)
    static let edge = UIColor(white: 1, alpha: 0.09)
    static let metal = UIColor(red: 0.62, green: 0.65, blue: 0.70, alpha: 1)
    static let darkMetal = UIColor(red: 0.17, green: 0.19, blue: 0.23, alpha: 1)
    static let teal = UIColor(red: 0.10, green: 0.83, blue: 0.77, alpha: 1)
    static let magenta = UIColor(red: 1.00, green: 0.24, blue: 0.65, alpha: 1)
    static let orange = UIColor(red: 1.00, green: 0.60, blue: 0.24, alpha: 1)
    static let red = UIColor(red: 1.00, green: 0.27, blue: 0.27, alpha: 1)
    static let ink = UIColor(white: 0.93, alpha: 1)
    static let dim = UIColor(white: 1, alpha: 0.38)
}

enum Art {
    /// A picture shipped in the app (`App/Art/<name>.jpg`).
    static func image(_ name: String) -> UIImage? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "jpg") else { return nil }
        return UIImage(contentsOfFile: url.path)
    }

    /// A story picture (`App/Story/<name>.jpg`); same lookup, the bundle is flat.
    static func storyImage(_ name: String) -> UIImage? { image(name) }
}
