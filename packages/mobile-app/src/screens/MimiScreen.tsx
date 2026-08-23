import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useDriverData } from '../context/DriverDataContext';
import type { DriverType } from '../types';
import type { RiderTabParamList } from '../navigation/RiderTabNavigator';

// Stage DM1 - bare minimum on purpose: name + category label, nothing else.
// Months-on-fleet, on-time rate, lifetime paid, and licence/insurance info
// are stage DM3 - licence/insurance expiry isn't even in the schema yet.
const CATEGORY_LABELS: Record<DriverType, string> = {
  RIDER: 'Rider',
  CAR_DRIVER: 'Car driver',
  TRUCK_DRIVER: 'Truck driver',
};

type Props = BottomTabScreenProps<RiderTabParamList, 'Mimi'>;

export function MimiScreen({ navigation }: Props) {
  const { me } = useDriverData();
  const category = me?.driverType ? CATEGORY_LABELS[me.driverType] : 'Rider';

  return (
    <View style={styles.container}>
      <Text style={styles.name}>{me ? `${me.firstName} ${me.lastName}` : ''}</Text>
      <Text style={styles.category}>{category}</Text>

      {/* Stage DM2 - Mkataba wangu isn't a tab of its own (see
          RiderTabNavigator); Mimi is its natural home. */}
      <TouchableOpacity style={styles.link} onPress={() => navigation.navigate('Mkataba')}>
        <Text style={styles.linkText}>Mkataba wangu</Text>
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
  },
  name: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 4 },
  category: { fontSize: 14, color: '#6b7280' },
  link: { marginTop: 24 },
  linkText: { fontSize: 15, color: '#2563eb', fontWeight: '600' },
});
