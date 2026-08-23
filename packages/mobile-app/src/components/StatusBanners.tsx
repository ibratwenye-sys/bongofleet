import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDriverData } from '../context/DriverDataContext';

/**
 * Shared by Leo and Lipa - the offline/queue/notice strip that used to sit
 * at the top of the single HomeScreen. testID="notice-banner" on the notice
 * view specifically: this is what replaces all eight former Alert.alert(...)
 * calls, and is what web-preview verification should assert against to
 * confirm a real UI element renders instead of a silent no-op.
 */
export function StatusBanners() {
  const { offline, queueCount, banner, trySync } = useDriverData();

  return (
    <>
      {offline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            Offline{queueCount > 0 ? ` - ${queueCount} payment(s) waiting to sync` : ''}
          </Text>
        </View>
      )}
      {!offline && queueCount > 0 && (
        <TouchableOpacity style={styles.queueBanner} onPress={() => void trySync()}>
          <Text style={styles.queueText}>{queueCount} payment(s) queued - tap to sync now</Text>
        </TouchableOpacity>
      )}
      {banner && (
        <View
          testID="notice-banner"
          style={banner.kind === 'error' ? styles.errorBanner : styles.successBanner}
        >
          <Text style={banner.kind === 'error' ? styles.errorText : styles.successText}>
            {banner.message}
          </Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  offlineBanner: { backgroundColor: '#fef3c7', padding: 10 },
  offlineText: { color: '#92400e', textAlign: 'center', fontSize: 13 },
  queueBanner: { backgroundColor: '#dbeafe', padding: 10 },
  queueText: { color: '#1e40af', textAlign: 'center', fontSize: 13, fontWeight: '600' },
  successBanner: { backgroundColor: '#dcfce7', padding: 10 },
  successText: { color: '#166534', textAlign: 'center', fontSize: 13 },
  errorBanner: { backgroundColor: '#fee2e2', padding: 10 },
  errorText: { color: '#991b1b', textAlign: 'center', fontSize: 13 },
});
