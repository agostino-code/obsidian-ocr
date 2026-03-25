const Electron = require('electron')

const {
    remote: { safeStorage }
} = Electron

export default safeStorage;