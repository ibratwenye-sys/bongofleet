import { StyleSheet, Text, View } from 'react-native';
import { useDriverData } from '../context/DriverDataContext';
import type { DriverType } from '../types';

// Stage DM1 - bare minimum on purpose: name + category label, nothing else.
// Months-on-fleet, on-time rate, lifetime paid, and licence/insurance info
// are stage DM3 - licence/insurance expiry isn't even in the schema yet.
const CATEGORY_LABELS: Record<DriverType, string> = {
  RIDER: 'Rider',
  CAR_DRIVER: 'Car driver',
  TRUCK_DRIVER: 'Truck driver',
};

export function MimiScreen() {
  const { me } = useDriverData();
  const category = me?.driverType ? CATEGORY_LABELS[me.driverType] : 'Rider';

  return (
    <View style={styles.container}>
      <Text style={styles.name}>{me ? `${me.firstName} ${me.lastName}` : ''}</Text>
      <Text style={styles.category}>{category}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
  },
  name: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 4 },
  category: { fontSize: 14, color: '#6b7280' },
});
