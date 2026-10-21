// The permissions a take needs on macOS (System Settings > Privacy & Security): what each is now, and
// its pane opened for the person. Windows asks for none but the camera and the mic.
import { shell, systemPreferences } from 'electron';
import { inputAllowed } from '@cuttle/recorder';
import type { Permission, PermissionView } from '../shared/ipc';
import { CHECK } from './check';

/** Each permission's pane in System Settings > Privacy & Security. */
const MAC_PANES: Record<Permission, string> = {
  screen: 'Privacy_ScreenCapture',
  input: 'Privacy_ListenEvent',
  accessibility: 'Privacy_Accessibility',
  camera: 'Privacy_Camera',
  microphone: 'Privacy_Microphone',
};
const WINDOWS_PAGES: Partial<Record<Permission, string>> = { camera: 'ms-settings:privacy-webcam', microphone: 'ms-settings:privacy-microphone' };

/** Opens where a permission is given: its pane of System Settings, or Windows' privacy page. */
export function openPermission(permission: Permission): void {
  const url = process.platform === 'darwin' ? `x-apple.systempreferences:com.apple.preference.security?${MAC_PANES[permission]}` : WINDOWS_PAGES[permission];
  if (url && !CHECK) void shell.openExternal(url);
}

/** macOS: each permission, granted, refused or not asked for yet (undefined); none elsewhere or in the checks. */
export async function permissionStates(): Promise<PermissionView[]> {
  if (process.platform !== 'darwin' || CHECK) return [];
  const media = (kind: 'screen' | 'camera' | 'microphone') => {
    const status = systemPreferences.getMediaAccessStatus(kind);
    return status === 'granted' ? true : status === 'not-determined' ? undefined : false;
  };
  return [
    { permission: 'screen', granted: media('screen') },
    { permission: 'input', granted: await inputAllowed().catch(() => undefined) },
    { permission: 'accessibility', granted: systemPreferences.isTrustedAccessibilityClient(false) },
    { permission: 'camera', granted: media('camera') },
    { permission: 'microphone', granted: media('microphone') },
  ];
}
