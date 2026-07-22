import Constants from 'expo-constants';

// The backend URL the phone talks to. On a real phone this must be your
// computer's LAN IP (NOT localhost - that would be the phone itself), e.g.
// "http://192.168.1.50:3000". Set it in app.json under expo.extra.apiUrl,
// or rely on the fallback below while developing.
const FALLBACK_API_URL = 'http://192.168.1.100:3000';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };

export const API_URL: string = extra.apiUrl ?? FALLBACK_API_URL;
