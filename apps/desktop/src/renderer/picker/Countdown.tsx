// The countdown over what will be recorded: the target stays visible behind a ring; Esc cancels.
import { useEffect, useState } from 'react';
import { bridge } from '../bridge';

export function Countdown() {
  const [seconds, setSeconds] = useState<number>();
  const [restart, setRestart] = useState(false);
  useEffect(
    () =>
      bridge.on('countdown:tick', ({ seconds: left, restart: again }) => {
        setSeconds(left);
        setRestart(again === true);
      }),
    [],
  );
  return (
    <div className="countdown" aria-live="assertive">
      {restart && <em>Restarting · the last take is kept</em>}
      {seconds !== undefined && <b key={seconds}>{seconds}</b>}
      <small>Esc to cancel</small>
    </div>
  );
}
