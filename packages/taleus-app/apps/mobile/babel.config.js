module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // `@formatjs/intl-pluralrules` and `@formatjs/intl-displaynames` ship
  // untranspiled and use static class blocks, which the React Native preset does
  // not transform. Needed by Metro and by jest alike.
  plugins: [
    '@babel/plugin-transform-class-static-block',
    // Reanimated 4's worklet transform, which react-native-keyboard-controller
    // needs. It MUST be the last plugin.
    'react-native-worklets/plugin',
  ],
};
