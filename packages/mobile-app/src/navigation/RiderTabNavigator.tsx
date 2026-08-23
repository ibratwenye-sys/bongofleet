import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { LeoScreen } from '../screens/LeoScreen';
import { LipaScreen } from '../screens/LipaScreen';
import { MimiScreen } from '../screens/MimiScreen';
import { ComingSoonScreen } from '../screens/ComingSoonScreen';

// Stage DM1 rider tab bar per the task spec (Leo/Malipo/Pikipiki/Mimi).
// Lipa is deliberately NOT one of the four tabs - it's the payment screen
// reached by tapping Pay from Leo, kept as a tab-navigator screen (not a
// separate stack package) with tabBarButton: () => null so it gets a real,
// navigable route without a fifth visible icon.
export type RiderTabParamList = {
  Leo: undefined;
  Malipo: undefined;
  Pikipiki: undefined;
  Mimi: undefined;
  Lipa: undefined;
};

const Tab = createBottomTabNavigator<RiderTabParamList>();

export function RiderTabNavigator() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Leo" component={LeoScreen} />
      <Tab.Screen name="Malipo">{() => <ComingSoonScreen label="Malipo" />}</Tab.Screen>
      <Tab.Screen name="Pikipiki">{() => <ComingSoonScreen label="Pikipiki" />}</Tab.Screen>
      <Tab.Screen name="Mimi" component={MimiScreen} />
      <Tab.Screen name="Lipa" component={LipaScreen} options={{ tabBarButton: () => null }} />
    </Tab.Navigator>
  );
}
