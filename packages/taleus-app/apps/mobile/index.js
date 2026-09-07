/**
 * @format
 */

// Must be the first import: gesture-handler patches the native view hierarchy
// before anything renders. React Navigation's gestures depend on it.
import 'react-native-gesture-handler';

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
