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

// The web APIs the Sereus stack reads that Hermes lacks (crypto.getRandomValues
// for keys, among others), from Sereus's React Native kit. After our own Intl
// on purpose: the kit carries an English-only `Intl.PluralRules` that installs
// only when none exists, and ours -- real plural rules, every locale -- must be
// the one that does. Before everything else, since stack modules read these
// globals as they load. Then the development-build audit of what is missing.
import '@serfab/cadre-rn/polyfills';
import '@serfab/cadre-rn/boot-check';

import { AppRegistry, I18nManager } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// The spec calls for RTL support. Allowing it means a right-to-left bundle lays
// out correctly when one is contributed; forcing it is a debugging tool and is
// deliberately not done here.
I18nManager.allowRTL(true);

AppRegistry.registerComponent(appName, () => App);
