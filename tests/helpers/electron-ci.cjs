// Make startup failures visible in CI instead of waiting on a native dialog.
const { app, dialog } = require('electron');
dialog.showErrorBox = (title, message) => {
  console.error(`${title}: ${message}`);
  app.exit(1);
};
process.on('unhandledRejection', error => {
  console.error(error);
  app.exit(1);
});
