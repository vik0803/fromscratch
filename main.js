/* eslint no-path-concat: 0, func-names:0 */
const electron = require('electron');
const fs = require('fs');
const JSONStorage = require('node-localstorage').JSONStorage;
const APPVERSION = require('./package.json').version;
const https = require('https');
const compareVersions = require('compare-versions');
const minimist = require('minimist');

const { app, BrowserWindow, ipcMain: ipc, Menu: menu, globalShortcut: gsc, shell } = electron;

if (process.env.NODE_ENV === 'development') {
  require('electron-debug')(); // eslint-disable-line global-require
}

const argv = minimist(process.argv.slice(process.env.NODE_ENV === 'development' ? 2 : 1), {
  boolean: ['help'],
  string: ['portable'],
  alias: {
    help: 'h',
    portable: 'p',
  },
});

if (argv.help) {
  console.log(`Usage: fromscratch [OPTION]...

Optional arguments:
  -p, --portable [DIRECTORY] run in portable mode, saving data in executable directory, or in alternate path
  -h, --help                 show this usage text.
  `);

  process.exit(0);
}

// get data location
const getDataLocation = () => {
  let location = process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME']
    + '/.fromscratch'
    + (process.env.NODE_ENV === 'development' ? '/dev' : '');

  if (typeof argv.portable !== 'undefined') {
    location = argv.portable !== '' ? argv.portable : process.cwd() + '/userdata';
    app.setPath('userData', location);
  }

  return location;
};

const storageLocation = getDataLocation();

global.nodeStorage = new JSONStorage(storageLocation);

global.handleContent = {
  filename: storageLocation + '/content.txt',
  write(content) {
    fs.writeFileSync(this.filename, content, 'utf8');
  },
  read() {
    return fs.existsSync(this.filename) ? fs.readFileSync(this.filename, 'utf8') : false;
  }
};

const installExtensions = () => {
  if (process.env.NODE_ENV === 'development') {
    const installer = require('electron-devtools-installer'); // eslint-disable-line global-require
    const extensions = [
      'REACT_DEVELOPER_TOOLS'
    ];
    const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
    for (const name of extensions) {
      try {
        installer.default(installer[name], forceDownload);
      } catch (e) {} // eslint-disable-line
    }
  }
};

// app init
let mainWindow = null;
app.on('window-all-closed', () => {
  app.quit();
});

app.on('ready', () => {
  installExtensions();

  let windowState = {};
  try {
    windowState = global.nodeStorage.getItem('windowstate') || {};
  } catch (err) {
    console.log('empty window state file, creating new one.');
  }

  ipc.on('writeContent', (event, arg) => {
    global.handleContent.write(arg);
  });

  const windowSettings = {
    show: false,
    title: app.getName(),
    icon: __dirname + '/app/assets/img/icon.png',
    x: (windowState.bounds && windowState.bounds.x) || undefined,
    y: (windowState.bounds && windowState.bounds.y) || undefined,
    width: (windowState.bounds && windowState.bounds.width) || 550,
    height: (windowState.bounds && windowState.bounds.height) || 450,
    darkTheme: true,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true
  };

  if (process.platform === 'darwin') {
    ipc.on('setVibrancy', (event, lightTheme) => {
      if (lightTheme) {
        mainWindow.setVibrancy('medium-light');
      } else {
        mainWindow.setVibrancy('ultra-dark');
      }
    });
  } else {
    windowSettings.backgroundColor = '#002b36';
  }

  mainWindow = new BrowserWindow(windowSettings);
  mainWindow.loadURL('file://' + __dirname + '/app/app.html');

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
    // Restore maximised state if it is set. not possible via options so we do it here
    if (windowState.isMaximized) {
      mainWindow.maximize();
    }
    mainWindow.focus();
    checkForUpdates();
  });

  const dispatchShortcutEvent = (ev) => {
    mainWindow.webContents.send('executeShortCut', ev);
  };

  const registerShortcuts = () => {
    gsc.register('CmdOrCtrl+0', () => { dispatchShortcutEvent('reset-font'); });
    gsc.register('CmdOrCtrl+-', () => { dispatchShortcutEvent('decrease-font'); });
    gsc.register('CmdOrCtrl+=', () => { dispatchShortcutEvent('increase-font'); });
    gsc.register('CmdOrCtrl+Plus', () => { dispatchShortcutEvent('increase-font'); });
    gsc.register('CmdOrCtrl+i', () => { dispatchShortcutEvent('toggle-theme'); });
    gsc.register('CmdOrCtrl+s', () => { dispatchShortcutEvent('save'); });
    gsc.register('CmdOrCtrl+w', () => { app.quit(); });
    gsc.register('CmdOrCtrl+q ', () => { app.quit(); });
    gsc.register('CmdOrCtrl+r ', () => { });
    gsc.register('f11', () => { mainWindow.setFullScreen(!mainWindow.isFullScreen()); });
  };

  registerShortcuts();

  mainWindow.on('focus', () => {
    registerShortcuts();
  });

  mainWindow.on('blur', () => {
    gsc.unregisterAll();
  });

  const storeWindowState = () => {
    windowState.isMaximized = mainWindow.isMaximized();
    if (!windowState.isMaximized) {
      // only update bounds if the window isn't currently maximized
      windowState.bounds = mainWindow.getBounds();
    }
    global.nodeStorage.setItem('windowstate', windowState);
  };

  ['resize', 'move', 'close'].forEach((e) => {
    mainWindow.on(e, () => {
      storeWindowState();
    });
  });

  const checkForUpdates = () => {
    https.get('https://fromscratch.rocks/latest.json?current=' + APPVERSION, (res) => {
      let json = '';
      res.on('data', (d) => {
        json += d;
      });

      res.on('end', () => {
        const latestVersion = JSON.parse(json).version;
        if (compareVersions(latestVersion, APPVERSION) === 1) {
          global.latestVersion = latestVersion;
          dispatchShortcutEvent('show-update-msg');
        }
      });
    }).on('error', (e) => {
      console.error(e);
    });
  };

  let template = [{
    label: app.getName(),
    submenu: [
      {
        label: 'Website',
        click() { shell.openExternal('https://fromscratch.rocks'); }
      },
      {
        label: 'Support',
        click() { shell.openExternal('https://github.com/Kilian/fromscratch/issues'); }
      },
      {
        label: 'Check for updates (current: ' + APPVERSION + ')',
        click() { shell.openExternal('https://github.com/Kilian/fromscratch/releases'); }
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        accelerator: 'CmdOrCtrl+Q',
        click() { app.quit(); }
      }]
  }];

  if (process.platform === 'darwin') {
    template = [{
      label: app.getName(),
      submenu: [
        {
          label: 'About ' + app.getName(),
          click() { shell.openExternal('https://fromscratch.rocks'); }
        },
        {
          label: 'Support',
          click() { shell.openExternal('https://github.com/Kilian/fromscratch/issues'); }
        },
        {
          label: 'Check for updates (current: ' + APPVERSION + ')',
          click() { shell.openExternal('https://github.com/Kilian/fromscratch/releases'); }
        },
        {
          type: 'separator'
        },
        {
          label: 'Hide ' + app.getName(),
          accelerator: 'Command+H',
          role: 'hide'
        },
        {
          label: 'Hide Others',
          accelerator: 'Command+Alt+H',
          role: 'hideothers'
        },
        {
          label: 'Show All',
          role: 'unhide'
        },
        {
          type: 'separator'
        },
        {
          label: 'Quit',
          accelerator: 'Command+Q',
          click() { app.quit(); }
        }
      ]
    }, {
      label: 'Edit',
      submenu: [{
        label: 'Undo',
        accelerator: 'CmdOrCtrl+Z',
        selector: 'undo:'
      }, {
        label: 'Redo',
        accelerator: 'Shift+CmdOrCtrl+Z',
        selector: 'redo:'
      }, {
        type: 'separator'
      }, {
        label: 'Cut',
        accelerator: 'CmdOrCtrl+X',
        selector: 'cut:'
      }, {
        label: 'Copy',
        accelerator: 'CmdOrCtrl+C',
        selector: 'copy:'
      }, {
        label: 'Paste',
        accelerator: 'CmdOrCtrl+V',
        selector: 'paste:'
      }, {
        label: 'Select All',
        accelerator: 'CmdOrCtrl+A',
        selector: 'selectAll:'
      }]
    }];
  }

  const menuBar = menu.buildFromTemplate(template);
  menu.setApplicationMenu(menuBar);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.openDevTools();
  }
});
