// The gesture under way: a drag on the timeline, in the source view or on the video (the webcam
// bubble). Esc, playing, or its view going away ends it without an edit (its preview goes too).

type Owner = 'timeline' | 'source' | 'stage';

let current: { cancel: () => void; owner: Owner } | undefined;

/** Starts a gesture whose `cancel` undoes what it showed; returns the call that ends it normally. */
export function beginGesture(owner: Owner, cancel: () => void): () => void {
  current?.cancel();
  const gesture = { cancel, owner };
  current = gesture;
  return () => {
    if (current === gesture) current = undefined;
  };
}

/** Ends the gesture under way (only `owner`'s, when given) without an edit; whether there was one. */
export function cancelGesture(owner?: Owner): boolean {
  const gesture = current;
  if (!gesture || (owner && gesture.owner !== owner)) return false;
  current = undefined;
  gesture.cancel();
  return true;
}
