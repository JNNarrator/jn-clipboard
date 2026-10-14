// Build the macOS icon container without changing the cross-platform artwork.
// macOS app tiles occupy about 80% of their canvas; the rest is transparent.
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let source = root.appendingPathComponent("src-tauri/icons/app-icon-source.png")
let icons = root.appendingPathComponent("src-tauri/icons")
let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
let iconset = temporary.appendingPathComponent("TieZ.iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: temporary) }

guard let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(imageSource, 0, nil),
      image.width == image.height else {
    fatalError("The app icon source must be a readable square image")
}

let sizes: [(String, Int)] = [
    ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024)
]
for (name, size) in sizes {
    guard let context = CGContext(data: nil, width: size, height: size,
                                  bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        fatalError("Unable to create icon bitmap")
    }
    context.clear(CGRect(x: 0, y: 0, width: size, height: size))
    context.interpolationQuality = .high
    // 824px tile + 100px margin on each side at 1024px. Pixel-align the
    // margins at small sizes to keep the outside transparent and symmetric.
    let inset = CGFloat((Double(size) * 100.0 / 1024.0).rounded())
    context.draw(image, in: CGRect(x: inset, y: inset,
                                  width: CGFloat(size) - inset * 2,
                                  height: CGFloat(size) - inset * 2))
    guard let bitmap = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(iconset.appendingPathComponent(name) as CFURL,
                                                           UTType.png.identifier as CFString, 1, nil) else {
        fatalError("Unable to write icon bitmap")
    }
    CGImageDestinationAddImage(destination, bitmap, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Unable to save icon") }
}
let output = icons.appendingPathComponent("app.icns")
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
process.arguments = ["-c", "icns", "-o", output.path, iconset.path]
try process.run()
process.waitUntilExit()
guard process.terminationStatus == 0 else { fatalError("iconutil failed") }
let secondary = icons.appendingPathComponent("icon.icns")
try Data(contentsOf: output).write(to: secondary, options: .atomic)
print("Generated macOS icons with a centered 824px tile on a 1024px transparent canvas")
