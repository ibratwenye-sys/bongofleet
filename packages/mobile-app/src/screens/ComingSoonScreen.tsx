import { StyleSheet, Text, View } from 'react-native';

// Stage DM1 placeholder for the Malipo and Pikipiki tabs - real screens land
// in stage DM2. Deliberately not blank/broken: a driver tapping either tab
// sees a clear "not yet" message instead of an empty white screen.
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
