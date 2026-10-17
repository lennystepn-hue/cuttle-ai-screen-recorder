// cuttle-capture: one display through ScreenCaptureKit, as raw BGRA frames on stdout at a steady
// frame rate, without the windows of the given processes (Cuttle's own: its HUD, pill and pickers).
// ffmpeg reads the frames (rawvideo) and does the rest, as with the other platforms' captures.
//
//   cuttle-capture --display <CGDirectDisplayID> [--crop x,y,w,h] [--fps 30] [--cursor] [--exclude-pid <pid>]...
//
// The crop is in the display's backing pixels. ScreenCaptureKit delivers a frame only when the screen
// changes; the last one is written again on every tick, so ffmpeg gets a constant frame rate. Exits when
// ffmpeg closes the pipe; exit code 3 when screen recording is not allowed, 2 for other failures.
import CoreGraphics
import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit

func fail(_ code: Int32, _ message: String) -> Never {
  FileHandle.standardError.write("cuttle-capture: \(message)\n".data(using: .utf8)!)
  exit(code)
}

/** `value`, or a usage failure. */
func required<T>(_ value: T?, _ message: String) -> T {
  guard let value else { fail(2, message) }
  return value
}

struct Options {
  var display: CGDirectDisplayID = CGMainDisplayID()
  var crop: CGRect?
  var fps = 30
  var cursor = false
  var excluded: Set<pid_t> = []
  var verbose = false
}

func parse() -> Options {
  var options = Options()
  var args = CommandLine.arguments.dropFirst().makeIterator()
  while let arg = args.next() {
    switch arg {
    case "--display": options.display = required(args.next().flatMap(UInt32.init), "--display needs a display id")
    case "--fps": options.fps = required(args.next().flatMap(Int.init), "--fps needs a number")
    case "--cursor": options.cursor = true
    case "--verbose": options.verbose = true
    case "--exclude-pid": options.excluded.insert(required(args.next().flatMap(Int32.init), "--exclude-pid needs a process id"))
    case "--crop":
      let parts = (args.next() ?? "").split(separator: ",").compactMap { Double($0) }
      guard parts.count == 4 else { fail(2, "--crop needs x,y,w,h") }
      options.crop = CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3])
    default: fail(2, "unknown argument \(arg)")
    }
  }
  return options
}

/** The newest frame, tightly packed BGRA; the timer writes it out. */
final class Frames: NSObject, SCStreamOutput, SCStreamDelegate {
  private let lock = NSLock()
  private var latest: Data?
  let width: Int
  let height: Int

  init(width: Int, height: Int) {
    self.width = width
    self.height = height
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, buffer.isValid,
          let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
          let status = attachments.first?[.status] as? Int, SCFrameStatus(rawValue: status) == .complete,
          let pixels = CMSampleBufferGetImageBuffer(buffer) else { return }
    CVPixelBufferLockBaseAddress(pixels, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(pixels) else { return }
    if latestIsEmpty { say("first frame") }
    let stride = CVPixelBufferGetBytesPerRow(pixels)
    let rows = min(height, CVPixelBufferGetHeight(pixels))
    let row = min(width, CVPixelBufferGetWidth(pixels)) * 4
    var data = Data(count: width * height * 4)
    data.withUnsafeMutableBytes { (target: UnsafeMutableRawBufferPointer) in
      for y in 0..<rows { memcpy(target.baseAddress! + y * width * 4, base + y * stride, row) }
    }
    lock.lock()
    latest = data
    lock.unlock()
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    fail(2, "the capture stopped: \(error.localizedDescription)")
  }

  private var latestIsEmpty: Bool {
    lock.lock()
    defer { lock.unlock() }
    return latest == nil
  }

  func newest() -> Data? {
    lock.lock()
    defer { lock.unlock() }
    return latest
  }
}

signal(SIGPIPE, SIG_IGN)
let options = parse()
func say(_ message: String) {
  if options.verbose { FileHandle.standardError.write("cuttle-capture: \(message)\n".data(using: .utf8)!) }
}
if !CGPreflightScreenCaptureAccess() { fail(3, "screen recording is not allowed for this app") }

/** The stream and its timer live as long as the process: released, they would stop. */
var running: (stream: SCStream, frames: Frames, timer: DispatchSourceTimer)?

Task {
  do {
    say("listing the displays")
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    say("\(content.displays.count) displays, \(content.applications.count) apps")
    guard let display = content.displays.first(where: { $0.displayID == options.display }) else { fail(2, "there is no display \(options.display)") }
    let mode = CGDisplayCopyDisplayMode(options.display)
    let pixelWidth = mode?.pixelWidth ?? display.width
    let pixelHeight = mode?.pixelHeight ?? display.height
    let scale = Double(pixelWidth) / Double(display.width)
    let excluded = content.applications.filter { options.excluded.contains($0.processID) }
    let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])

    let config = SCStreamConfiguration()
    let crop = options.crop ?? CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight)
    if options.crop != nil {
      config.sourceRect = CGRect(x: crop.minX / scale, y: crop.minY / scale, width: crop.width / scale, height: crop.height / scale)
    }
    config.width = Int(crop.width)
    config.height = Int(crop.height)
    config.pixelFormat = kCVPixelFormatType_32BGRA
    config.colorSpaceName = CGColorSpace.sRGB
    config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(options.fps))
    config.queueDepth = 6
    config.showsCursor = options.cursor
    config.capturesAudio = false

    let frames = Frames(width: config.width, height: config.height)
    let stream = SCStream(filter: filter, configuration: config, delegate: frames)
    try stream.addStreamOutput(frames, type: .screen, sampleHandlerQueue: DispatchQueue(label: "cuttle.frames"))
    try await stream.startCapture()
    say("capturing \(config.width)x\(config.height), leaving out \(excluded.map(\.applicationName))")

    let out = FileHandle.standardOutput.fileDescriptor
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "cuttle.ticks"))
    timer.schedule(deadline: .now(), repeating: .nanoseconds(1_000_000_000 / options.fps), leeway: .milliseconds(1))
    timer.setEventHandler {
      guard let frame = frames.newest() else { return } // nothing before the first frame: ffmpeg's start is the screen's
      frame.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
        var offset = 0
        while offset < bytes.count {
          let written = write(out, bytes.baseAddress! + offset, bytes.count - offset)
          if written <= 0 { exit(0) } // ffmpeg is done (or gone)
          offset += written
        }
      }
    }
    timer.resume()
    running = (stream, frames, timer)
  } catch {
    let denied = (error as NSError).code == -3801 // SCStreamError.userDeclined
    fail(denied ? 3 : 2, "the capture could not start: \(error.localizedDescription)")
  }
}

signal(SIGTERM, SIG_IGN)
let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
terminate.setEventHandler { exit(0) }
terminate.resume()
dispatchMain()
