import { listDevices, type Backend, type Devices } from '@cuttle/recorder';
import type { Output } from '../output';

/** `cuttle devices`: monitors (index, size, position), windows, cameras and microphones. */
export async function devices(backend: Backend, output: Output): Promise<Devices> {
  const result = await listDevices({ backend });
  output.result(result, () => describe(result));
  return result;
}

function describe({ monitors, windows, cameras, mics }: Devices): string {
  const list = (items: string[]) => (items.length === 0 ? ['  (none)'] : items.map((item) => `  ${item}`));
  return [
    'monitors (--monitor N):',
    ...list(
      monitors.map(
        ({ index, name, bounds, scale, primary }) =>
          `${index}  ${bounds.width}×${bounds.height} at ${bounds.x},${bounds.y}  ${Math.round(scale * 100)} %  ${name}${primary ? '  (primary)' : ''}`,
      ),
    ),
    'windows (--window "title"):',
    ...list(windows.map(({ title, bounds, monitor }) => `${JSON.stringify(title)}  ${bounds.width}×${bounds.height} on monitor ${monitor}`)),
    'cameras (--webcam "name"):',
    ...list(cameras.map((name) => JSON.stringify(name))),
    'microphones (--mic "name"):',
    ...list(mics.map((name) => JSON.stringify(name))),
  ].join('\n');
}
