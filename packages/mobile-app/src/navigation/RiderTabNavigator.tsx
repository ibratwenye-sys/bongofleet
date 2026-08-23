import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { LeoScreen } from '../screens/LeoScreen';
import { LipaScreen } from '../screens/LipaScreen';
import { MimiScreen } from '../screens/MimiScreen';
import { PikipikiScreen } from '../screens/PikipikiScreen';
import { MalipoYanguScreen } from '../screens/MalipoYanguScreen';
import { MkatabaWanguScreen } from '../screens/MkatabaWanguScreen';
import { MatumiziScreen } from '../screens/MatumiziScreen';

// Stage DM1 rider tab bar per the task spec (Leo/Malipo/Pikipiki/Mimi).
// Lipa, Mkataba (Stage DM2), and Matumizi (Stage H4) are deliberately NOT
// among the four tabs - they're reached from a button on Leo/Mimi/Leo
// respectively, kept as tab-navigator screens (not a separate stack
// package) with tabBarButton: () => null so each gets a real, navigable
// route without an extra visible icon.
export type RiderTabParamList = {
  Leo: undefined;
  Malipo: undefined;
  Pikipiki: undefined;
  Mimi: undefined;
  Lipa: undefined;
  Mkataba: undefined;
  Matumizi: undefined;
};

const Tab = createBottomTabNavigator<RiderTabParamList>();

export function RiderTabNavigator() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Leo" component={LeoScreen} />
      <Tab.Screen name="Malipo" component={MalipoYanguScreen} />
      <Tab.Screen name="Pikipiki" component={PikipikiScreen} />
      <Tab.Screen name="Mimi" component={MimiScreen} />
      <Tab.Screen name="Lipa" component={LipaScreen} options={{ tabBarButton: () => null }} />
      <Tab.Screen
        name="Mkataba"
        component={MkatabaWanguScreen}
        options={{ tabBarButton: () => null }}
      />
      <Tab.Screen
        name="Matumizi"
        component={MatumiziScreen}
        options={{ tabBarButton: () => null }}
      />
    </Tab.Navigator>
  );
}
