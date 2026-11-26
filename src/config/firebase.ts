// Firebase project used for online CAD files (Cloud save).
//
// Setup: Firebase console → Project settings → Your apps → Web app → "SDK setup and configuration" → Config.
// Paste the values below (they are public identifiers, safe to commit), OR set the VITE_FIREBASE_* variables
// at build time (e.g. GitHub Actions secrets). Leave apiKey empty to turn the Cloud feature off.
// Firestore rules for the `cad` collection live in /firestore.rules.
const PASTE_HERE = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

const env = import.meta.env;
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || PASTE_HERE.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || PASTE_HERE.authDomain,
  projectId: env.VITE_FIREBASE_PROJECT_ID || PASTE_HERE.projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || PASTE_HERE.storageBucket,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || PASTE_HERE.messagingSenderId,
  appId: env.VITE_FIREBASE_APP_ID || PASTE_HERE.appId,
};

/** Firestore collection holding one document per CAD file; the document id is its 6-digit access code. */
export const CAD_COLLECTION = 'cad';

/** Custom parts shared with cloud files: `customParts/{contentId}` + `customParts/{id}/chunks/{n}` (base64 GLB). */
export const PARTS_COLLECTION = 'customParts';
