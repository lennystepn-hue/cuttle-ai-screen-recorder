// cuttle-capture: one display through ScreenCaptureKit, as raw BGRA frames on stdout at a steady
// frame rate, without the windows of the given processes (Cuttle's own: its HUD, pill and pickers).
// ffmpeg reads the frames (rawvideo) and does the rest, as with the other platforms' captures.
//
//   cuttle-capture --display <CGDirectDisplayID> [--crop x,y,w,h] [--fps 30] [--cursor] [--exclude-pid <pid>]...
//   cuttle-capture --display <CGDirectDisplayID> --window <CGWindowID> --size w,h [--fps 30] [--cursor]
//
// The crop is in the display's backing pixels. With --window the window itself is captured, at
// --size pixels: what lies over it, and what is done elsewhere meanwhile, is not in the take. ScreenCaptureKit delivers a frame only when the screen
// changes; the last one is written again on every tick, so ffmpeg gets a constant frame rate. Exits when
// ffmpeg closes the pipe; exit code 3 when screen recording is not allowed, 2 for other failures.
//
//   cuttle-capture audio --display <CGDirectDisplayID> [--window <CGWindowID>] [--exclude-pid <pid>]...
//
// What the computer plays, through ScreenCaptureKit: the display's sound without the given processes
// (Cuttle's own), or with --window the sound of that window's app alone. 48 kHz stereo 32-bit float
// samples on stdout, silence where nothing played, so they keep time with the clock; first a line on
// stderr that says when the first sample played, `start <Unix seconds>`. Exit codes as above.
//
//   cuttle-capture shot --display <CGDirectDisplayID> [--crop x,y,w,h] [--cursor] [--exclude-pid <pid>]... --out <file.png>
//   cuttle-capture shot --display <CGDirectDisplayID> --window <CGWindowID> [--cursor] --out <file.png>
//
// One picture of the display (a screenshot) as a PNG, without the windows of the given processes,
// cropped in its backing pixels; or with --window that window by itself, at its own pixels, without
// its shadow, what lies outside its rounded corners transparent. The PNG says its resolution (144 dpi
// from a Retina display), and a line on stdout its size and scale ({"width", "height", "scale"}).
// Exit codes as above.
//
//   cuttle-capture ocr
//
// Reads the text of pictures with the Vision framework, for the privacy masks: as Windows' OCR helper
// in core's privacy/ocr.ts, one request per line on stdin ({"path"}), one JSON line per answer
// ({"lines": [[{"t", "r": [x, y, w, h]}]]}, in the picture's pixels), after a first line that says it
// prepares Vision ({"preparing": true}: that can take a minute, see readText) and one that says it
// is ready and in which languages. Nothing leaves this computer.
import CoreGraphics
import CoreMedia
import CoreText
import CoreVideo
import Foundation
import ImageIO
import ScreenCaptureKit
import VideoToolbox
import Vision

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
  var window: CGWindowID?
  var size: CGSize?
  var out: String?
}

/** The options after the command (`audio` and `shot` take --window without --size). */
func parse(_ given: ArraySlice<String>, audio: Bool = false, shot: Bool = false) -> Options {
  var options = Options()
  var args = given.makeIterator()
  while let arg = args.next() {
    switch arg {
    case "--display": options.display = required(args.next().flatMap(UInt32.init), "--display needs a display id")
    case "--fps": options.fps = required(args.next().flatMap(Int.init), "--fps needs a number")
    case "--cursor": options.cursor = true
    case "--verbose": options.verbose = true
    case "--exclude-pid": options.excluded.insert(required(args.next().flatMap(Int32.init), "--exclude-pid needs a process id"))
    case "--window": options.window = required(args.next().flatMap(UInt32.init), "--window needs a window id")
    case "--size":
      let parts = (args.next() ?? "").split(separator: ",").compactMap { Double($0) }
      guard parts.count == 2, parts[0] >= 2, parts[1] >= 2 else { fail(2, "--size needs w,h") }
      options.size = CGSize(width: parts[0], height: parts[1])
    case "--crop":
      let parts = (args.next() ?? "").split(separator: ",").compactMap { Double($0) }
      guard parts.count == 4 else { fail(2, "--crop needs x,y,w,h") }
      options.crop = CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3])
    case "--out": options.out = required(args.next(), "--out needs a file")
    default: fail(2, "unknown argument \(arg)")
    }
  }
  if options.window != nil && options.size == nil && !audio && !shot { fail(2, "--window needs --size") }
  if shot && options.out == nil { fail(2, "shot needs --out <file.png>") }
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

/** The sound's sample rate and channels, as `cuttle-capture audio` writes them. */
let soundRate = 48_000.0
/** While nothing comes, silence is written up to this long before now (seconds): a buffer comes within it. */
let soundLag = 0.03
/** Silence fills in once the samples are this far behind the clock (seconds). */
let soundBehind = 0.06
/** A buffer this far from where the samples so far end (seconds) goes at its own time: silence before it, or its start left out. */
let soundSlack = 0.01

/**
 * The sound as it comes, at its time on the host clock from `origin` (the first sample): silence
 * where none came (macOS sends nothing while nothing plays), a buffer that overlaps what was written
 * without its start. Everything runs on one queue.
 */
final class Sound: NSObject, SCStreamOutput, SCStreamDelegate {
  let origin: Double
  private var written: Int64 = 0
  private let out = FileHandle.standardOutput.fileDescriptor
  private var warned = false

  init(origin: Double) {
    self.origin = origin
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .audio, buffer.isValid, let description = buffer.formatDescription?.audioStreamBasicDescription else { return }
    let frames = buffer.numSamples
    // ScreenCaptureKit's sound is 32-bit float at the rate asked for, a buffer per channel
    guard frames > 0, description.mFormatID == kAudioFormatLinearPCM, description.mFormatFlags & kAudioFormatFlagIsFloat != 0,
          description.mBitsPerChannel == 32, description.mSampleRate == soundRate else {
      if !warned { FileHandle.standardError.write("cuttle-capture: sound in a format it does not read: \(description)\n".data(using: .utf8)!) }
      warned = true
      return
    }
    var samples = [Float](repeating: 0, count: frames * 2)
    let separate = description.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0
    let channels = Int(description.mChannelsPerFrame)
    try? buffer.withAudioBufferList { list, _ in
      guard let first = list.first?.mData?.assumingMemoryBound(to: Float.self) else { return }
      if separate {
        let second = list.count > 1 ? list[1].mData?.assumingMemoryBound(to: Float.self) ?? first : first
        for i in 0..<frames {
          samples[2 * i] = first[i]
          samples[2 * i + 1] = second[i]
        }
      } else {
        for i in 0..<frames {
          samples[2 * i] = first[i * channels]
          samples[2 * i + 1] = first[i * channels + (channels > 1 ? 1 : 0)]
        }
      }
    }
    put(samples, frames: frames, at: buffer.presentationTimeStamp.seconds)
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    fail(2, "the sound capture stopped: \(error.localizedDescription)")
  }

  /** `samples` (`frames` stereo frames) at host time `time`. */
  private func put(_ samples: [Float], frames: Int, at time: Double) {
    let at = Int64(((time - origin) * soundRate).rounded())
    let gap = at - written
    let slack = Int64(soundSlack * soundRate)
    var skip = 0
    if gap > slack { silence(gap) } else if gap < -slack { skip = Int(min(Int64(frames), -gap)) }
    guard skip < frames else { return }
    samples.withUnsafeBytes { bytes in write(UnsafeRawBufferPointer(rebasing: bytes[(skip * 8)...])) }
    written += Int64(frames - skip)
  }

  /** Silence up to a moment ago, when nothing came for a while. */
  func keepTime(now: Double) {
    let due = Int64(((now - soundLag - origin) * soundRate).rounded())
    if due - written > Int64((soundBehind - soundLag) * soundRate) { silence(due - written) }
  }

  private func silence(_ frames: Int64) {
    let zeros = [UInt8](repeating: 0, count: 4_800 * 8)
    var left = frames
    while left > 0 {
      let now = Int(min(left, 4_800))
      zeros.withUnsafeBytes { bytes in write(UnsafeRawBufferPointer(rebasing: bytes[..<(now * 8)])) }
      left -= Int64(now)
    }
    written += frames
  }

  private func write(_ bytes: UnsafeRawBufferPointer) {
    var offset = 0
    while offset < bytes.count {
      let done = Darwin.write(out, bytes.baseAddress! + offset, bytes.count - offset)
      if done <= 0 { exit(0) } // ffmpeg is done (or gone)
      offset += done
    }
  }
}

/** The host clock's time now, in seconds (the clock ScreenCaptureKit stamps its buffers on). */
func hostNow() -> Double {
  CMClockGetTime(CMClockGetHostTimeClock()).seconds
}

/** One JSON line on stdout. */
func answer(_ value: [String: Any]) {
  let data = (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{\"error\":\"no JSON\"}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

/** The words of a recognized line (as Windows' OCR splits them: at spaces), each with its rect in the picture's pixels. */
func words(of candidate: VNRecognizedText, in size: CGSize) -> [[String: Any]] {
  let text = candidate.string
  let tenth = { (value: CGFloat) in (Double(value) * 10).rounded() / 10 }
  return text.split(whereSeparator: { $0.isWhitespace }).compactMap { word in
    guard let box = try? candidate.boundingBox(for: word.startIndex..<word.endIndex)?.boundingBox else { return nil }
    // Vision's rects are shares of the picture from its bottom-left corner
    let rect = VNImageRectForNormalizedRect(box, Int(size.width), Int(size.height))
    return ["t": String(word), "r": [tenth(rect.minX), tenth(size.height - rect.maxY), tenth(rect.width), tenth(rect.height)]]
  }
}

/** A request for a picture's text in `languages`. */
func textRequest(_ languages: [String]) -> VNRecognizeTextRequest {
  let read = VNRecognizeTextRequest()
  read.recognitionLevel = .accurate
  read.recognitionLanguages = languages
  // what is on the screen as it is written: no words "corrected" into others (addresses, keys)
  read.usesLanguageCorrection = false
  read.minimumTextHeight = 0
  return read
}

/** A line of text of its own, black on white: what Vision is prepared on. */
func sampleLine() -> CGImage? {
  let width = 320, height = 64
  guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
  context.setFillColor(gray: 1, alpha: 1)
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  let attributes: [NSAttributedString.Key: Any] = [
    NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName("Helvetica" as CFString, 28, nil),
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1),
  ]
  context.textPosition = CGPoint(x: 16, y: 20)
  CTLineDraw(CTLineCreateWithAttributedString(NSAttributedString(string: "Cuttle 0123", attributes: attributes)), context)
  return context.makeImage()
}

/**
 * `cuttle-capture ocr`: pictures' text through Vision until stdin closes. Vision is prepared first, on
 * a line of its own: macOS compiles its text recognition's networks for the Neural Engine on this
 * helper's first use of them, and again once another program had them compiled for itself (it kept
 * them for one at a time here). That took a minute for one helper on an M1, one network at a time
 * for all processes that ask (two helpers at once: 87 s and 113 s); compiled, preparing takes a
 * fraction of a second.
 */
func readText() -> Never {
  answer(["preparing": true])
  let probe = VNRecognizeTextRequest()
  probe.recognitionLevel = .accurate
  let supported = (try? probe.supportedRecognitionLanguages()) ?? []
  // the person's languages Vision reads, in their order; English where none is
  var languages = Locale.preferredLanguages.compactMap { wanted in
    supported.first { $0 == wanted } ?? supported.first { $0.split(separator: "-").first == wanted.split(separator: "-").first }
  }
  if languages.isEmpty { languages = ["en-US"] }
  languages = languages.reduce(into: []) { if !$0.contains($1) { $0.append($1) } }
  // should Vision fail on it, each picture asked for says why
  if let sample = sampleLine() { try? VNImageRequestHandler(cgImage: sample, options: [:]).perform([textRequest(languages)]) }
  answer(["ready": true, "language": languages.joined(separator: ","), "max": 16384])
  while let line = readLine() {
    autoreleasepool {
      guard let request = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any], let path = request["path"] as? String else {
        return answer(["error": "a request is {\"path\": …}"])
      }
      guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        return answer(["error": "cannot open \(path)"])
      }
      let read = textRequest(languages)
      do {
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([read])
      } catch {
        return answer(["error": error.localizedDescription])
      }
      let size = CGSize(width: image.width, height: image.height)
      let lines = (read.results ?? []).compactMap { $0.topCandidates(1).first }.map { words(of: $0, in: size) }.filter { !$0.isEmpty }
      answer(["lines": lines])
    }
  }
  exit(0)
}

signal(SIGPIPE, SIG_IGN)
let command = CommandLine.arguments.dropFirst().first
if command == "ocr" { readText() }
let audio = command == "audio"
let shot = command == "shot"
let options = parse(CommandLine.arguments.dropFirst(audio || shot ? 2 : 1), audio: audio, shot: shot)
func say(_ message: String) {
  if options.verbose { FileHandle.standardError.write("cuttle-capture: \(message)\n".data(using: .utf8)!) }
}
if !CGPreflightScreenCaptureAccess() { fail(3, "screen recording is not allowed for this app") }

/** The stream and its timer live as long as the process: released, they would stop. */
var running: (stream: SCStream, frames: Frames, timer: DispatchSourceTimer)?
var sounding: (stream: SCStream, sound: Sound, timer: DispatchSourceTimer)?

/**
 * `cuttle-capture audio`: the sound of the display without the processes left out, or of the window's
 * app alone. A stream needs a picture too: the smallest, once a second, and dropped.
 */
func startSound(_ content: SCShareableContent, _ display: SCDisplay) async throws {
  let excluded = content.applications.filter { options.excluded.contains($0.processID) }
  let owner = options.window.flatMap { id in content.windows.first(where: { $0.windowID == id })?.owningApplication }
  let filter = owner.map { SCContentFilter(display: display, including: [$0], exceptingWindows: []) }
    ?? SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
  let config = SCStreamConfiguration()
  config.capturesAudio = true
  config.sampleRate = Int(soundRate)
  config.channelCount = 2
  config.excludesCurrentProcessAudio = true
  config.width = 2
  config.height = 2
  config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
  config.showsCursor = false
  let queue = DispatchQueue(label: "cuttle.sound")
  let origin = hostNow()
  let sound = Sound(origin: origin)
  let stream = SCStream(filter: filter, configuration: config, delegate: sound)
  try stream.addStreamOutput(sound, type: .audio, sampleHandlerQueue: queue)
  try stream.addStreamOutput(sound, type: .screen, sampleHandlerQueue: queue)
  try await stream.startCapture()
  // the first sample is the start's: what came before it is left out, silence fills in until sound comes
  FileHandle.standardError.write(String(format: "start %.6f\n", Date().timeIntervalSince1970 - (hostNow() - origin)).data(using: .utf8)!)
  say(owner.map { "recording the sound of \($0.applicationName)" } ?? "recording the sound, leaving out \(excluded.map(\.applicationName))")
  let timer = DispatchSource.makeTimerSource(queue: queue)
  timer.schedule(deadline: .now(), repeating: .milliseconds(10), leeway: .milliseconds(2))
  timer.setEventHandler { sound.keepTime(now: hostNow()) }
  timer.resume()
  sounding = (stream, sound, timer)
}

/** The first complete frame of a stream, as a picture: a screenshot where SCScreenshotManager is missing (macOS 13). */
final class FirstFrame: NSObject, SCStreamOutput, SCStreamDelegate {
  private let lock = NSLock()
  private var waiting: CheckedContinuation<CGImage, Error>?

  func wait(for stream: SCStream) async throws -> CGImage {
    try await withCheckedThrowingContinuation { continuation in
      lock.lock()
      waiting = continuation
      lock.unlock()
      Task {
        do { try await stream.startCapture() } catch { self.finish(.failure(error)) }
      }
    }
  }

  private func finish(_ result: Result<CGImage, Error>) {
    lock.lock()
    let continuation = waiting
    waiting = nil
    lock.unlock()
    continuation?.resume(with: result)
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, buffer.isValid,
          let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
          let status = attachments.first?[.status] as? Int, SCFrameStatus(rawValue: status) == .complete,
          let pixels = CMSampleBufferGetImageBuffer(buffer) else { return }
    var image: CGImage?
    VTCreateCGImageFromCVPixelBuffer(pixels, options: nil, imageOut: &image)
    if let image { finish(.success(image)) }
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    finish(.failure(error))
  }
}

/** `cuttle-capture shot`: one picture of the display or of a window, written as a PNG. */
func takeShot(_ content: SCShareableContent, _ display: SCDisplay) async throws -> Never {
  let out = options.out!
  let mode = CGDisplayCopyDisplayMode(options.display)
  let pixelWidth = mode?.pixelWidth ?? display.width
  let pixelHeight = mode?.pixelHeight ?? display.height
  var scale = Double(pixelWidth) / Double(display.width)
  let config = SCStreamConfiguration()
  let filter: SCContentFilter
  if let id = options.window {
    // the window by itself, without its shadow, at its own pixels (on the display it is on)
    guard let window = content.windows.first(where: { $0.windowID == id }) else { fail(2, "there is no window \(id) (closed, or on another desktop)") }
    filter = SCContentFilter(desktopIndependentWindow: window)
    var size = window.frame.size
    if #available(macOS 14.0, *) {
      scale = Double(filter.pointPixelScale)
      size = filter.contentRect.size
      config.ignoreShadowsSingleWindow = true
    }
    config.width = Int((size.width * scale).rounded())
    config.height = Int((size.height * scale).rounded())
  } else {
    let excluded = content.applications.filter { options.excluded.contains($0.processID) }
    filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
    let crop = options.crop ?? CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight)
    if options.crop != nil {
      config.sourceRect = CGRect(x: crop.minX / scale, y: crop.minY / scale, width: crop.width / scale, height: crop.height / scale)
    }
    config.width = Int(crop.width)
    config.height = Int(crop.height)
  }
  config.pixelFormat = kCVPixelFormatType_32BGRA
  config.colorSpaceName = CGColorSpace.sRGB
  config.showsCursor = options.cursor
  config.capturesAudio = false
  let image: CGImage
  if #available(macOS 14.0, *) {
    image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
  } else {
    let first = FirstFrame()
    let stream = SCStream(filter: filter, configuration: config, delegate: first)
    try stream.addStreamOutput(first, type: .screen, sampleHandlerQueue: DispatchQueue(label: "cuttle.shot"))
    image = try await first.wait(for: stream)
    try? await stream.stopCapture()
  }
  // the resolution says the scale: 72 dpi a point
  guard let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, "public.png" as CFString, 1, nil) else { fail(2, "cannot write \(out)") }
  let dpi = 72 * scale
  CGImageDestinationAddImage(destination, image, [kCGImagePropertyDPIWidth: dpi, kCGImagePropertyDPIHeight: dpi] as CFDictionary)
  guard CGImageDestinationFinalize(destination) else { fail(2, "cannot write \(out)") }
  answer(["width": image.width, "height": image.height, "scale": scale])
  exit(0)
}

Task {
  do {
    say("listing the displays")
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    say("\(content.displays.count) displays, \(content.applications.count) apps")
    guard let display = content.displays.first(where: { $0.displayID == options.display }) else { fail(2, "there is no display \(options.display)") }
    if audio { return try await startSound(content, display) }
    if shot { try await takeShot(content, display) }
    let mode = CGDisplayCopyDisplayMode(options.display)
    let pixelWidth = mode?.pixelWidth ?? display.width
    let pixelHeight = mode?.pixelHeight ?? display.height
    let scale = Double(pixelWidth) / Double(display.width)
    let excluded = content.applications.filter { options.excluded.contains($0.processID) }
    let config = SCStreamConfiguration()
    let filter: SCContentFilter
    if let id = options.window, let size = options.size {
      // the window by itself, wherever it is and whatever lies over it, without its shadow
      guard let window = content.windows.first(where: { $0.windowID == id }) else { fail(2, "there is no window \(id) (closed, or on another desktop)") }
      filter = SCContentFilter(desktopIndependentWindow: window)
      config.width = Int(size.width)
      config.height = Int(size.height)
      if #available(macOS 14.0, *) {
        config.ignoreShadowsSingleWindow = true
        config.preservesAspectRatio = true
      }
    } else {
      filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
      let crop = options.crop ?? CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight)
      if options.crop != nil {
        config.sourceRect = CGRect(x: crop.minX / scale, y: crop.minY / scale, width: crop.width / scale, height: crop.height / scale)
      }
      config.width = Int(crop.width)
      config.height = Int(crop.height)
    }
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
    say(options.window.map { "capturing window \($0) at \(config.width)x\(config.height)" } ?? "capturing \(config.width)x\(config.height), leaving out \(excluded.map(\.applicationName))")

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
