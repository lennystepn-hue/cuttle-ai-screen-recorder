// A Lottie animation (an After Effects animation as JSON, as LottieFiles' free animations come) as
// a motion page: lottie-web from the kit plays it frame by frame on the video's clock.
import { CoreError } from '../errors';

export interface LottieInfo {
  /** Its frame rate, first and last frame, size and name. */
  fr: number;
  ip: number;
  op: number;
  w: number;
  h: number;
  nm?: string;
}

/** What a Lottie file says about itself, or an `invalid-media` error when it is no Lottie. */
export function lottieInfo(json: unknown, from: string): LottieInfo {
  const data = json as Partial<LottieInfo> & { layers?: unknown };
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  if (!data || typeof data !== 'object' || !number(data.fr) || !number(data.ip) || !number(data.op) || !number(data.w) || !number(data.h) || !Array.isArray(data.layers) || data.op! <= data.ip! || data.fr! <= 0) {
    throw new CoreError('invalid-media', `${from} is not a Lottie animation (a JSON with fr, ip, op, w, h and layers)`);
  }
  return { fr: data.fr!, ip: data.ip!, op: data.op!, w: data.w!, h: data.h!, ...(typeof data.nm === 'string' && { nm: data.nm }) };
}

/** Seconds the animation plays once. */
export const lottieSeconds = (info: LottieInfo): number => Math.round(((info.op - info.ip) / info.fr) * 1000) / 1000;

/** The page that plays `animation.json` beside it: once or looping, at a speed, fitted into the frame. */
export function lottiePage(info: LottieInfo, source: string): string {
  const params = [
    { name: 'fit', label: 'Fit into the frame', type: 'select', default: 'contain', options: ['contain', 'cover'] },
    { name: 'loop', label: 'Loop', type: 'bool', default: false },
    { name: 'speed', label: 'Speed', type: 'number', default: 1, min: 0.1, max: 4 },
    { name: 'start', label: 'Starts (seconds into the item)', type: 'number', default: 0, min: 0, max: 600 },
  ];
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${(info.nm ?? 'Lottie').replace(/[<>&"]/g, '')}</title>
    <!-- A Lottie animation (animation.json, ${info.w}×${info.h}, ${lottieSeconds(info)} s at ${info.fr} fps) from
         ${source.replace(/--/g, '-')}, played by lottie-web on the video's clock: once, or looping, at a speed. -->
    <script type="application/json" id="cuttle-params">
      ${JSON.stringify(params)}
    </script>
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
        overflow: hidden;
      }
      #stage {
        position: absolute;
        inset: 0;
      }
    </style>
  </head>
  <body>
    <div id="stage"></div>
    <script type="module">
      import lottie from 'lottie-web';

      const { params } = cuttle;
      const speed = Math.min(4, Math.max(0.1, Number(params.speed) || 1));
      const start = Math.max(0, Number(params.start) || 0);
      let animation;
      let frames = 1;
      let fps = 30;
      cuttle.ready(
        fetch('./animation.json')
          .then((response) => response.json())
          .then((data) => {
            frames = data.op - data.ip;
            fps = data.fr;
            animation = lottie.loadAnimation({
              container: document.getElementById('stage'),
              renderer: 'svg',
              loop: false,
              autoplay: false,
              animationData: data,
              rendererSettings: { preserveAspectRatio: params.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet' },
            });
            return new Promise((resolve) => (animation.isLoaded ? resolve() : animation.addEventListener('DOMLoaded', resolve)));
          }),
      );
      cuttle.onFrame((t) => {
        if (!animation) return;
        const played = Math.max(0, t - start) * speed * fps;
        animation.goToAndStop(params.loop ? played % frames : Math.min(played, frames - 0.001), true);
      });
    </script>
  </body>
</html>
`;
}
