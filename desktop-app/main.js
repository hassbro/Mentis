// Add this at the very top of your main Electron process file
app.commandLine.appendSwitch('ignore-certificate-errors');
const { app, BrowserWindow, screen } = require('electron');

let adminWindow = null;
let castWindow = null;

function createWindow() {
  const displays = screen.getAllDisplays();
  
  // Find the external display (TV/projector), fallback to primary if none is attached
  const externalDisplay = displays.find((display) => display.id !== screen.getPrimaryDisplay().id) || displays[0];
  const primaryDisplay = screen.getPrimaryDisplay();

  // 1. ADMIN CONTROLLER WINDOW (Opens on your MacBook screen)
  adminWindow = new BrowserWindow({
    x: primaryDisplay.bounds.x + 50,
    y: primaryDisplay.bounds.y + 50,
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });
  adminWindow.loadURL('https://mentis-amber.vercel.app/admin');

  // 2. CAST / GAME BOARD WINDOW (Opens automatically in fullscreen on the TV/external monitor)
  castWindow = new BrowserWindow({
    x: externalDisplay.bounds.x,
    y: externalDisplay.bounds.y,
    width: externalDisplay.bounds.width,
    height: externalDisplay.bounds.height,
    fullscreen: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });
  castWindow.loadURL('https://mentis-amber.vercel.app/cast');
}

function moveCastWindowToExternalDisplay() {
  if (!castWindow) return;
  
  const displays = screen.getAllDisplays();
  const externalDisplay = displays.find((display) => display.id !== screen.getPrimaryDisplay().id);
  
  if (externalDisplay) {
    console.log('External display detected, moving cast window to external screen');
    castWindow.setPosition(externalDisplay.bounds.x, externalDisplay.bounds.y);
    castWindow.setSize(externalDisplay.bounds.width, externalDisplay.bounds.height);
    castWindow.setFullScreen(true);
  } else {
    console.log('No external display detected, keeping cast window on primary screen');
    const primaryDisplay = screen.getPrimaryDisplay();
    castWindow.setPosition(primaryDisplay.bounds.x + 100, primaryDisplay.bounds.y + 100);
    castWindow.setSize(800, 600);
    castWindow.setFullScreen(false);
  }
}

app.whenReady().then(() => {
  createWindow();

  // Dynamic screen detection
  screen.on('display-added', (event, newDisplay) => {
    console.log('Display added:', newDisplay);
    if (castWindow) {
      moveCastWindowToExternalDisplay();
    }
  });

  screen.on('display-removed', (event, oldDisplay) => {
    console.log('Display removed:', oldDisplay);
    if (castWindow) {
      moveCastWindowToExternalDisplay();
    }
  });

  screen.on('display-metrics-changed', (event, display, changedMetrics) => {
    console.log('Display metrics changed:', display, changedMetrics);
    if (castWindow) {
      moveCastWindowToExternalDisplay();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});