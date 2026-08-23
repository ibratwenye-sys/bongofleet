import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { DriverType } from '../types';

const CATEGORY_LABELS: Record<DriverType, string> = {
  RIDER: 'Rider',
  CAR_DRIVER: 'Car driver',
  TRUCK_DRIVER: 'Truck driver',
};

/**
 * Stage DM1 covers rider mode only - car/truck driver mode needs a backend
 * decision that's a later stage. Shown instead of guessing at rider UI for
 * a non-rider driverType: explicit and honest rather than silently wrong.
 */
export function ModeNotAvailableScreen({
  driverType,
  onLogout,
}: {
  driverType: DriverType;
  onLogout: () => void;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Not available yet</Text>
      <Text style={styles.body}>
        {CATEGORY_LABELS[driverType]} mode isn't available in this app yet. Check back soon.
      </Text>
      <TouchableOpacity style={styles.button} onPress={onLogout}>
        <Text style={styles.buttonText}>Log out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    padding: 24,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  body: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 24 },
  button: {
    backgroundColor: '#111827',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
