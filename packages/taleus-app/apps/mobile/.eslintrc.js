module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      // jest.setup.js runs inside the test runner, where `jest` is a global.
      files: ['jest.setup.js'],
      env: {jest: true},
    },
  ],
};
