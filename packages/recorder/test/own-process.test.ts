import { describe, expect, it } from 'vitest';
import { APP_PID_VARIABLE, ownPids } from '../src/own-process';

describe('ownPids', () => {
  it("takes the app's pid with this process's when the app names it", () => {
    expect([...ownPids(4321, { [APP_PID_VARIABLE]: '1234' })]).toEqual([4321, 1234]);
  });

  it("keeps this process's alone without the variable or with no pid in it (the CLI)", () => {
    expect([...ownPids(4321, {})]).toEqual([4321]);
    for (const value of ['', 'abc', '0', '-5', '12.5']) expect([...ownPids(4321, { [APP_PID_VARIABLE]: value })]).toEqual([4321]);
  });
});
