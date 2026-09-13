const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

// Call appendSwitch AFTER app is required
app.commandLine.appendSwitch('ignore-certificate-errors');

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
  adminWindow.loadURL('https://mentis-git-main-hassbro.vercel.app/admin');

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
      preload: path.join(__dirname, 'preload.js')
    }
  });
  castWindow.loadURL('https://mentis-amber.vercel.app/cast');
}

function moveCastWindowToExternalDisplay() {
  if (!castWindow || castWindow.isDestroyed()) return;
  
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  
  // Find a true external display (ignoring mirrored duplicates if possible)
  const externalDisplay = displays.find((display) => display.id !== primaryDisplay.id);
  
  if (externalDisplay) {
    console.log('External display detected, moving cast window to external screen:', externalDisplay.id);
    castWindow.setPosition(externalDisplay.bounds.x, externalDisplay.bounds.y);
    castWindow.setSize(externalDisplay.bounds.width, externalDisplay.bounds.height);
    castWindow.setFullScreen(true);
  } else {
    console.log('No external display detected (or screens are mirrored), keeping cast window on primary screen');
    castWindow.setPosition(primaryDisplay.bounds.x + 50, primaryDisplay.bounds.y + 50);
    castWindow.setSize(1200, 800);
    castWindow.setFullScreen(false);
  }
}


// IPC handler for cast page to request moving to external display
ipcMain.handle('move-to-external-display', () => {
  moveCastWindowToExternalDisplay();
  return { success: true };
});

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