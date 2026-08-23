import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useDriverData } from '../context/DriverDataContext';
import { RiderTabNavigator } from '../navigation/RiderTabNavigator';
import { DriverTabNavigator } from '../navigation/DriverTabNavigator';

/**
 * Stage DM1/DM4. driverType decides which tab bar renders: missing (no
 * Driver row, e.g. OWNER/MANAGER testing the app) or RIDER gets the rider
 * tab bar; CAR_DRIVER/TRUCK_DRIVER gets the car/truck driver tab bar
 * (Stage DM4 - Safari/Matumizi/Mimi). DriverType is exhaustively RIDER |
 * CAR_DRIVER | TRUCK_DRIVER, so these two branches cover every case -
 * ModeNotAvailableScreen (DM1's placeholder for this same gate) is deleted
 * as unused, matching how ComingSoonScreen was deleted in DM2 and
 * recreated here once it was needed again.
 */
export function DriverModeGate() {
  const { me, loading } = useDriverData();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#111827" />
      </View>
    );
  }

  if (me?.driverType === 'CAR_DRIVER' || me?.driverType === 'TRUCK_DRIVER') {
    return (
      <NavigationContainer>
        <DriverTabNavigator />
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer>
      <RiderTabNavigator />
    </NavigationContainer>
  );
}
