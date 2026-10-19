// Make startup failures visible in CI instead of waiting on a native dialog.
const { app, dialog } = require('electron');
dialog.showErrorBox = (title, message) => {
  console.error(`${title}: ${message}`);
  app.exit(1);
};
process.on('unhandledRejection', (error) => {
  console.error(error);
  app.exit(1);
});

// SSH workers do not have a Dock session. Keep desktop tests from changing
// the host's Dock icon or waiting for its unavailable native service.
if (process.platform === 'darwin') {
  app.setActivationPolicy('accessory');
  if (app.dock) app.dock.setIcon = () => {};
}
