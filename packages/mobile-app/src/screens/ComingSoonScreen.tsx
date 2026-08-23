import { StyleSheet, Text, View } from 'react-native';

// Stage DM4 - recreated for the Matumizi placeholder (car/truck driver
// expenses, genuinely Stage H scope: driver-submitted expenses don't exist
// on the backend yet - ExpenseController is OWNER/MANAGER only, no RIDER
// route anywhere). Same component DM1 used for Malipo/Pikipiki before they
// got real screens in DM2 - deleted then as unused, not because the pattern
// was wrong.
export function ComingSoonScreen({ label }: { label: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{label}</Text>
      <Text style={styles.body}>Coming soon.</Text>
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
  title: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  body: { fontSize: 14, color: '#6b7280' },
});
