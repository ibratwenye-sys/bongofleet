import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafariZanguScreen } from '../screens/SafariZanguScreen';
import { SafariJobDetailScreen } from '../screens/SafariJobDetailScreen';
import { ComingSoonScreen } from '../screens/ComingSoonScreen';
import { MimiScreen } from '../screens/MimiScreen';
import { MkatabaWanguScreen } from '../screens/MkatabaWanguScreen';

// Stage DM4 - the car/truck-driver tab bar (Safari/Matumizi/Mimi, per the
// design doc's three-tab truck-driver layout). SafariDetail and Mkataba are
// hidden routes (tabBarButton: () => null), same convention as
// RiderTabNavigator's Lipa/Mkataba: a real navigable screen without a
// visible fourth/fifth icon. Matumizi (driver-submitted expenses) stays a
// ComingSoonScreen placeholder - genuinely Stage H scope, ExpenseController
// has no RIDER route today.
export type DriverTabParamList = {
  Safari: undefined;
  Matumizi: undefined;
  Mimi: undefined;
  SafariDetail: { jobId: string };
  Mkataba: undefined;
};

const Tab = createBottomTabNavigator<DriverTabParamList>();

export function DriverTabNavigator() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Safari" component={SafariZanguScreen} />
      <Tab.Screen name="Matumizi">{() => <ComingSoonScreen label="Matumizi" />}</Tab.Screen>
      <Tab.Screen name="Mimi" component={MimiScreen} />
      <Tab.Screen
        name="SafariDetail"
        component={SafariJobDetailScreen}
        options={{ tabBarButton: () => null }}
      />
      <Tab.Screen
        name="Mkataba"
        component={MkatabaWanguScreen}
        options={{ tabBarButton: () => null }}
      />
    </Tab.Navigator>
  );
}
