// cuttle-loopback: what Windows plays, as a track of the take beside the mic. WASAPI's loopback of
// the default output device (what the speakers or headphones play), as 48 kHz stereo 32-bit float
// samples on stdout, silence where nothing played, so the samples keep time with the clock; first a
// line on stderr that says when the first sample played, `start <Unix seconds>`. The counterpart of
// `cuttle-capture audio` on macOS.
//
//   cuttle-loopback [--verbose]
//
// Windows sends nothing while nothing plays, and a device that goes away (headphones unplugged) or
// another one made the default ends its stream: this helper writes silence meanwhile and carries on
// with the default device. Exits when ffmpeg closes the pipe; exit code 2 when there is no output
// device to record at the start.
//
// Built by native/build-windows.mjs with the C# compiler of .NET Framework 4, which every Windows 10
// and 11 has: C# 5, nothing newer.
using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace Cuttle
{
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumerator { }

  // Each interface declares its methods in the order of its vtable, up to the last one called.
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator
  {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice
  {
    [PreserveSig] int Activate(ref Guid iid, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    [PreserveSig] int OpenPropertyStore(int access, out IntPtr store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  }

  [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioClient
  {
    [PreserveSig] int Initialize(int shareMode, uint flags, long bufferDuration, long periodicity, IntPtr format, IntPtr session);
    [PreserveSig] int GetBufferSize(out uint frames);
    [PreserveSig] int GetStreamLatency(out long latency);
    [PreserveSig] int GetCurrentPadding(out uint frames);
    [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
    [PreserveSig] int GetMixFormat(out IntPtr format);
    [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
    [PreserveSig] int Start();
    [PreserveSig] int Stop();
    [PreserveSig] int Reset();
    [PreserveSig] int SetEventHandle(IntPtr handle);
    [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
  }

  [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioCaptureClient
  {
    [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
    [PreserveSig] int ReleaseBuffer(uint frames);
    [PreserveSig] int GetNextPacketSize(out uint frames);
  }

  /** The device's own sample format, turned into 48 kHz stereo float where Windows does not convert for a loopback. */
  sealed class Converter
  {
    readonly int channels;
    readonly int block;
    readonly int width;
    readonly bool isFloat;
    readonly double step;
    byte[] raw = new byte[0];
    float[] output = new float[0];
    double phase;
    float lastLeft;
    float lastRight;
    bool primed;

    Converter(int channels, int block, bool isFloat, int rate)
    {
      this.channels = channels;
      this.block = block;
      width = block / channels;
      this.isFloat = isFloat;
      step = rate / (double)Program.Rate;
    }

    /** A converter for a WAVEFORMATEX (or WAVEFORMATEXTENSIBLE), or null for a format it does not read. */
    public static Converter From(IntPtr format)
    {
      int tag = Marshal.ReadInt16(format, 0) & 0xffff;
      int channels = Marshal.ReadInt16(format, 2);
      int rate = Marshal.ReadInt32(format, 4);
      int block = Marshal.ReadInt16(format, 12);
      // WAVE_FORMAT_EXTENSIBLE: the subformat's first two bytes are the format's tag
      if (tag == 0xfffe) tag = Marshal.ReadInt16(format, 24) & 0xffff;
      if (channels < 1 || rate < 8000 || block % channels != 0) return null;
      int width = block / channels;
      bool isFloat = tag == 3 && width == 4;
      if (!isFloat && !(tag == 1 && (width == 2 || width == 3 || width == 4))) return null;
      return new Converter(channels, block, isFloat, rate);
    }

    float Sample(int frame, int channel)
    {
      int at = frame * block + channel * width;
      if (isFloat) return BitConverter.ToSingle(raw, at);
      if (width == 2) return BitConverter.ToInt16(raw, at) / 32768f;
      if (width == 3) return ((raw[at] | raw[at + 1] << 8 | raw[at + 2] << 16) << 8 >> 8) / 8388608f;
      return BitConverter.ToInt32(raw, at) / 2147483648f;
    }

    /** The packet's frames as 48 kHz stereo (linear between the device's samples); returns how many. */
    public int Run(IntPtr data, int frames, bool silent, out float[] samples)
    {
      if (raw.Length < frames * block) raw = new byte[frames * block];
      if (silent) Array.Clear(raw, 0, frames * block);
      else Marshal.Copy(data, raw, 0, frames * block);
      int most = (int)Math.Ceiling(frames / step) + 2;
      if (output.Length < most * 2) output = new float[most * 2];
      int n = 0;
      for (int i = 0; i < frames; i++)
      {
        float left = Sample(i, 0);
        float right = channels > 1 ? Sample(i, 1) : left;
        if (!primed)
        {
          lastLeft = left;
          lastRight = right;
          primed = true;
        }
        while (phase < 1.0)
        {
          output[2 * n] = lastLeft + (left - lastLeft) * (float)phase;
          output[2 * n + 1] = lastRight + (right - lastRight) * (float)phase;
          n++;
          phase += step;
        }
        phase -= 1.0;
        lastLeft = left;
        lastRight = right;
      }
      samples = output;
      return n;
    }
  }

  /** The default output device's loopback stream. */
  sealed class Device : IDisposable
  {
    /** eRender, eConsole and CLSCTX_ALL. */
    const int RenderFlow = 0;
    const int ConsoleRole = 0;
    const int AnyContext = 0x17;
    const uint Loopback = 0x00020000;
    const uint AutoConvertPcm = 0x80000000;
    const uint SrcDefaultQuality = 0x08000000;
    const uint Silent = 0x2;
    const uint TimestampError = 0x4;
    /** The stream's buffer: 200 ms, in 100-ns units. */
    const long BufferDuration = 2000000;

    public string Id;
    IAudioClient client;
    IAudioCaptureClient capture;
    /** Null where Windows converts to 48 kHz stereo float itself. */
    Converter convert;
    float[] direct = new float[0];

    static IMMDevice Default()
    {
      var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      IMMDevice device;
      return enumerator.GetDefaultAudioEndpoint(RenderFlow, ConsoleRole, out device) == 0 ? device : null;
    }

    /** The default output device's id, or null when there is none. */
    public static string DefaultId()
    {
      try
      {
        IMMDevice device = Default();
        string id;
        return device != null && device.GetId(out id) == 0 ? id : null;
      }
      catch (Exception)
      {
        return null;
      }
    }

    static IAudioClient Client(IMMDevice endpoint)
    {
      Guid iid = typeof(IAudioClient).GUID;
      object instance;
      return endpoint.Activate(ref iid, AnyContext, IntPtr.Zero, out instance) == 0 ? (IAudioClient)instance : null;
    }

    /** 48 kHz stereo 32-bit float, as a WAVEFORMATEX the caller frees. */
    static IntPtr Ours()
    {
      IntPtr format = Marshal.AllocHGlobal(18);
      Marshal.WriteInt16(format, 0, 3); // WAVE_FORMAT_IEEE_FLOAT
      Marshal.WriteInt16(format, 2, 2);
      Marshal.WriteInt32(format, 4, Program.Rate);
      Marshal.WriteInt32(format, 8, Program.Rate * 8);
      Marshal.WriteInt16(format, 12, 8);
      Marshal.WriteInt16(format, 14, 32);
      Marshal.WriteInt16(format, 16, 0);
      return format;
    }

    /** The default output device's loopback, started; null when there is none or it cannot be opened. */
    public static Device Open()
    {
      try
      {
        IMMDevice endpoint = Default();
        string id;
        if (endpoint == null || endpoint.GetId(out id) != 0) return null;
        IAudioClient client = Client(endpoint);
        if (client == null) return null;
        Converter convert = null;
        IntPtr ours = Ours();
        int result = client.Initialize(0, Loopback | AutoConvertPcm | SrcDefaultQuality, BufferDuration, 0, ours, IntPtr.Zero);
        Marshal.FreeHGlobal(ours);
        if (result != 0)
        {
          // Windows does not convert for this loopback: the device's own format, converted here
          Marshal.ReleaseComObject(client);
          client = Client(endpoint);
          IntPtr mix;
          if (client == null || client.GetMixFormat(out mix) != 0) return null;
          convert = Converter.From(mix);
          result = convert == null ? -1 : client.Initialize(0, Loopback, BufferDuration, 0, mix, IntPtr.Zero);
          Marshal.FreeCoTaskMem(mix);
          if (result != 0) return null;
        }
        Guid iid = typeof(IAudioCaptureClient).GUID;
        object service;
        if (client.GetService(ref iid, out service) != 0 || client.Start() != 0) return null;
        var device = new Device();
        device.Id = id;
        device.client = client;
        device.capture = (IAudioCaptureClient)service;
        device.convert = convert;
        return device;
      }
      catch (Exception)
      {
        return null;
      }
    }

    static void Check(int result)
    {
      if (result < 0) Marshal.ThrowExceptionForHR(result);
    }

    /** Hands every packet that came to `put` (48 kHz stereo, its frames, its time in 100 ns or -1); throws when the device is gone. */
    public void Drain(Action<float[], int, long> put)
    {
      uint next;
      Check(capture.GetNextPacketSize(out next));
      while (next > 0)
      {
        IntPtr data;
        uint frames;
        uint flags;
        ulong position;
        ulong qpc;
        Check(capture.GetBuffer(out data, out frames, out flags, out position, out qpc));
        bool silent = (flags & Silent) != 0;
        float[] samples;
        int count;
        if (convert == null)
        {
          count = (int)frames;
          if (direct.Length < count * 2) direct = new float[count * 2];
          if (silent) Array.Clear(direct, 0, count * 2);
          else Marshal.Copy(data, direct, 0, count * 2);
          samples = direct;
        }
        else count = convert.Run(data, (int)frames, silent, out samples);
        Check(capture.ReleaseBuffer(frames));
        put(samples, count, (flags & TimestampError) != 0 ? -1 : (long)qpc);
        Check(capture.GetNextPacketSize(out next));
      }
    }

    public void Dispose()
    {
      try
      {
        client.Stop();
      }
      catch (Exception)
      {
        // gone already
      }
      Marshal.ReleaseComObject(capture);
      Marshal.ReleaseComObject(client);
    }
  }

  static class Program
  {
    public const int Rate = 48000;
    /** While nothing comes, silence is written up to this long before now (100 ns): a packet comes within it. */
    const long Lag = 300000;
    /** Silence fills in once the samples are this far behind the clock (100 ns). */
    const long Behind = 600000;
    /** A packet this many frames from where the samples so far end goes at its own time: silence before it, or its start left out (10 ms). */
    const long Slack = Rate / 100;
    /** The default device is looked at this often (100 ns): one second. */
    const long Recheck = 10000000;

    static Stream output;
    static byte[] bytes = new byte[0];
    /** The first sample's time on the performance counter, in 100 ns. */
    static long origin;
    /** Frames written since. */
    static long written;
    static bool verbose;

    [DllImport("kernel32.dll")]
    static extern void GetSystemTimePreciseAsFileTime(out long time);

    /** The performance counter in 100 ns, the clock WASAPI stamps its packets on. */
    static long Now()
    {
      long ticks = Stopwatch.GetTimestamp();
      long frequency = Stopwatch.Frequency;
      return ticks / frequency * 10000000 + ticks % frequency * 10000000 / frequency;
    }

    /** The wall clock in Unix seconds, to the microsecond. */
    static double Wall()
    {
      long time;
      GetSystemTimePreciseAsFileTime(out time);
      return (time - 116444736000000000L) / 1e7;
    }

    static void Say(string text)
    {
      if (verbose) System.Console.Error.WriteLine("cuttle-loopback: " + text);
    }

    static long FrameAt(long time)
    {
      return (long)Math.Round((time - origin) * (double)Rate / 1e7);
    }

    static void Write(float[] samples, int offset, int frames)
    {
      if (bytes.Length < frames * 8) bytes = new byte[frames * 8];
      Buffer.BlockCopy(samples, offset * 8, bytes, 0, frames * 8);
      output.Write(bytes, 0, frames * 8);
      written += frames;
    }

    static void Silence(long frames)
    {
      var zeros = new byte[4800 * 8];
      for (long left = frames; left > 0; left -= 4800) output.Write(zeros, 0, (int)Math.Min(left, 4800) * 8);
      written += frames;
    }

    /** A packet at its time: silence before it where it comes after a gap, its start left out where it overlaps what was written. */
    static void Put(float[] samples, int frames, long time)
    {
      long gap = time < 0 ? 0 : FrameAt(time) - written;
      int skip = 0;
      if (gap > Slack) Silence(gap);
      else if (gap < -Slack) skip = (int)Math.Min(frames, -gap);
      if (skip < frames) Write(samples, skip, frames - skip);
    }

    [MTAThread]
    static int Main(string[] args)
    {
      verbose = Array.IndexOf(args, "--verbose") >= 0;
      output = System.Console.OpenStandardOutput();
      Device device = Device.Open();
      if (device == null)
      {
        System.Console.Error.WriteLine("cuttle-loopback: there is no sound output device to record");
        return 2;
      }
      origin = Now();
      System.Console.Error.WriteLine("start " + Wall().ToString("F6", CultureInfo.InvariantCulture));
      Say("recording " + device.Id);
      long looked = origin;
      try
      {
        for (;;)
        {
          if (device != null)
          {
            try
            {
              device.Drain(Put);
            }
            catch (IOException)
            {
              throw; // stdout: below
            }
            catch (Exception error)
            {
              // the device went away (unplugged, disabled): silence until there is another
              Say("the device stopped: " + error.Message);
              device.Dispose();
              device = null;
            }
          }
          long now = Now();
          if (now - looked >= Recheck)
          {
            looked = now;
            string id = Device.DefaultId();
            if (id != null && (device == null || id != device.Id))
            {
              if (device != null) device.Dispose();
              device = Device.Open();
              Say(device == null ? "the default device cannot be opened" : "recording " + device.Id);
            }
          }
          long due = FrameAt(now - Lag);
          if (due - written > (Behind - Lag) * Rate / 10000000) Silence(due - written);
          Thread.Sleep(5);
        }
      }
      catch (IOException)
      {
        return 0; // ffmpeg is done (or gone)
      }
    }
  }
}
