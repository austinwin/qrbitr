/**
 * Checks if storage (localStorage or sessionStorage) is available
 * 
 * @param {string} type - The type of storage to check ('localStorage' or 'sessionStorage')
 * @returns {boolean} Whether the storage is available
 */
export function storageAvailable(type) {
  let storage;
  try {
    storage = window[type];
    const x = '__storage_test__';
    storage.setItem(x, x);
    storage.removeItem(x);
    return true;
  } catch (e) {
    return e instanceof DOMException && (
      // everything except Firefox
      e.code === 22 ||
      // Firefox
      e.code === 1014 ||
      // test name field too, because code might not be present
      // everything except Firefox
      e.name === 'QuotaExceededError' ||
      // Firefox
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    ) &&
    // acknowledge QuotaExceededError only if there's something already stored
    storage && storage.length !== 0;
  }
}

/**
 * Saves the current session data
 * 
 * @param {Object} sessionData - The data to save
 */
export function saveSession(sessionData) {
  if (storageAvailable('localStorage')) {
    try {
      localStorage.setItem('qrbitr_session', JSON.stringify(sessionData));
    } catch (e) {
      console.error('Failed to save session:', e);
    }
  }
}

/**
 * Clears the saved session data
 */
export function clearSession() {
  if (storageAvailable('localStorage')) {
    localStorage.removeItem('qrbitr_session');
  }
}

export const storage = {
  save(key, data) { localStorage.setItem(key, JSON.stringify(data)); },
  load(key) { return JSON.parse(localStorage.getItem(key)) || null; },
};