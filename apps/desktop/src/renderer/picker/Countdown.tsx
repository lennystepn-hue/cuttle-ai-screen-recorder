// The countdown over what will be recorded: the target stays visible behind a ring; Esc cancels.
import { useEffect, useState } from 'react';
import { bridge } from '../bridge';

export function Countdown() {
  const [seconds, setSeconds] = useState<number>();
  useEffect(() => bridge.on('countdown:tick', ({ seconds: left }) => setSeconds(left)), []);
  return (
    <div className="countdown" aria-live="assertive">
      {seconds !== undefined && <b key={seconds}>{seconds}</b>}
      <small>Esc to cancel</small>
    </div>
  );
}
