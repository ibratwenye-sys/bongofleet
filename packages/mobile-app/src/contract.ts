import { Linking, Platform } from 'react-native';
import { apiFetchBlob } from './api';

/**
 * Extracted from MkatabaWanguScreen.tsx (Stage DM2) unchanged, now that
 * Stage G2's Leo card needs the exact same "view contract" action - not
 * reimplemented, not approximated.
 *
 * Verified live against the web preview: Chrome refuses to navigate a new
 * tab to a data: URI at all (blocked outright, since ~Chrome 88, as a
 * security restriction on data: as a top-level navigation target) - a
 * data-URI-only approach silently opened a blank tab, not the contract.
 * blob: URLs are exempt from that restriction, so web gets one, kept alive
 * deliberately (never revoked) since the opened tab reads it asynchronously
 * and revoking on a timer would be a guess at how long that takes.
 *
 * React Native has no URL.createObjectURL, so native keeps the data: URI +
 * Linking.openURL path - not blocked there, and contracts are small enough
 * (a few KB - tens of KB of PDF) that the encoding overhead doesn't matter.
 * Untested on native (this app is only verified via the web preview per
 * this project's established method) - flagging that rather than claiming
 * a platform I have no way to check.
 */
function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the contract file'));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

/** Fetches and opens an ownership plan's contract PDF. Throws NetworkError/
 *  ApiError same as any other apiFetch* call - the caller's own try/catch
 *  and error-banner wording stays with the caller, not here. */
export async function openPlanContract(planId: string): Promise<void> {
  const blob = await apiFetchBlob(`/ownership-plans/${planId}/contract`);
  if (Platform.OS === 'web') {
    // Intentionally never revoked - see the comment above blobToDataUri.
    await Linking.openURL(URL.createObjectURL(blob));
  } else {
    const dataUri = await blobToDataUri(blob);
    await Linking.openURL(dataUri);
  }
}
