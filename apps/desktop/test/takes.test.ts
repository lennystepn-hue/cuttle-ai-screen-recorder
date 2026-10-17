import { describe, expect, it } from 'vitest';
import { deletableTakes, sizeText, trashName } from '../src/shared/takes';

describe('the takes a person may delete', () => {
  it('lists every numbered take but the one in use, newest first', () => {
    expect(deletableTakes(['1', '9', '.discarded', '10', '2', 'notes'], '9')).toEqual(['10', '2', '1']);
    expect(deletableTakes(['1', '2'], undefined)).toEqual(['2', '1']);
    expect(deletableTakes(['3'], '3')).toEqual([]);
  });

  it('says sizes and the Trash as people know them', () => {
    expect([sizeText(820_000), sizeText(142_400_000), sizeText(1_430_000_000), sizeText(10)]).toEqual(['820 KB', '142 MB', '1.4 GB', '1 KB']);
    expect([trashName('darwin'), trashName('win32')]).toEqual(['Trash', 'Recycle Bin']);
  });
});
