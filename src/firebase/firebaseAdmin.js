import admin from 'firebase-admin';

// Initialize Firebase Admin in a way that works locally and on Vercel.
// Priority for credentials:
// 1) If FIREBASE_SERVICE_ACCOUNT (stringified JSON) is provided, use it.
// 2) If FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY are provided, use them.
// 3) Otherwise rely on Application Default Credentials (GCP / Vercel service identity).

let initialized = false;

export function initFirebaseAdmin() {
  if (initialized) return admin;

  const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || undefined;

  try {
    if (serviceAccountEnv) {
      const svc = typeof serviceAccountEnv === 'string' ? JSON.parse(serviceAccountEnv) : serviceAccountEnv;
      admin.initializeApp({ credential: admin.credential.cert(svc), projectId: svc.project_id || projectId });
      initialized = true;
      return admin;
    }

    if (clientEmail && privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert({ project_id: projectId, client_email: clientEmail, private_key: privateKey }),
        projectId,
      });
      initialized = true;
      return admin;
    }

    // Fallback to Application Default Credentials
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
    initialized = true;
    return admin;
  } catch (err) {
    // If init fails because app already exists, reuse it.
    if (err?.message && err.message.includes('already exists') && admin.apps && admin.apps.length) {
      initialized = true;
      return admin;
    }
    // Re-throw for visibility in server logs
    throw err;
  }
}

export function getAuth() {
  initFirebaseAdmin();
  return admin.auth();
}

export function getFirestore() {
  initFirebaseAdmin();
  return admin.firestore();
}

export function getStorage() {
  initFirebaseAdmin();
  return admin.storage();
}

export default admin;
