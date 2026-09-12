import AppKit
let size = NSSize(width: 512, height: 512)
let image = NSImage(size: size)
image.lockFocus()
NSColor(calibratedRed: 0.208, green: 0.361, blue: 0.808, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(origin: .zero, size: size), xRadius: 108, yRadius: 108).fill()
NSColor.white.setStroke()
let line = NSBezierPath()
line.lineWidth = 26
line.lineCapStyle = .round
line.move(to: NSPoint(x: 168, y: 150))
line.line(to: NSPoint(x: 168, y: 352))
line.move(to: NSPoint(x: 168, y: 248))
line.curve(to: NSPoint(x: 340, y: 352), controlPoint1: NSPoint(x: 340, y: 248), controlPoint2: NSPoint(x: 340, y: 248))
line.stroke()
for p in [NSPoint(x:168,y:150),NSPoint(x:168,y:352),NSPoint(x:340,y:352)] {
    NSColor.white.setFill()
    NSBezierPath(ovalIn: NSRect(x:p.x-31,y:p.y-31,width:62,height:62)).fill()
}
image.unlockFocus()
let bitmap = NSBitmapImageRep(data:image.tiffRepresentation!)!
try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
