/**
 * @format
 */

// Must be the first import: gesture-handler patches the native view hierarchy
// before anything renders. React Navigation's gestures depend on it.
import 'react-native-gesture-handler';

// Before anything reads a string. Hermes has no Intl.PluralRules, i18next uses
// it, and a polyfill installed after i18next initialises is a polyfill that
// arrived too late. See src/i18n/intl.ts.
import './src/i18n/intl';

import { AppRegistry, I18nManager } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// The spec calls for RTL support. Allowing it means a right-to-left bundle lays
// out correctly when one is contributed; forcing it is a debugging tool and is
// deliberately not done here.
I18nManager.allowRTL(true);

AppRegistry.registerComponent(appName, () => App);
