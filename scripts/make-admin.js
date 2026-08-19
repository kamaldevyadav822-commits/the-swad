import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

/*
==========================================================
THE SWAD — MAKE FIREBASE USER ADMIN
==========================================================

Usage:

ADMIN_EMAIL=your@email.com node scripts/make-admin.js

This script:

1. Connects to Firebase Admin SDK
2. Finds the Firebase Authentication user
3. Adds the custom claim:

   {
     "admin": true
   }

4. Does NOT expose your Firebase private key
5. Does NOT run inside the browser

IMPORTANT:
Run this ONLY on your trusted local machine
or a secure server environment.

Never put this script inside public/.
==========================================================
*/

function fail(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

/* -------------------------------------------------------
   Validate environment
------------------------------------------------------- */

if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  fail(
    "FIREBASE_SERVICE_ACCOUNT_JSON is missing from .env"
  );
}

if (!process.env.ADMIN_EMAIL) {
  fail(
    "ADMIN_EMAIL is missing.\n\nExample:\nADMIN_EMAIL=admin@example.com"
  );
}

/* -------------------------------------------------------
   Initialize Firebase Admin
------------------------------------------------------- */

let serviceAccount;

try {
  serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  );
} catch (error) {
  fail(
    "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON."
  );
}

try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential:
        admin.credential.cert(serviceAccount),

      databaseURL:
        process.env.FIREBASE_DATABASE_URL,
    });
  }
} catch (error) {
  fail(
    `Firebase initialization failed: ${error.message}`
  );
}

/* -------------------------------------------------------
   Find user
------------------------------------------------------- */

const email =
  process.env.ADMIN_EMAIL
    .trim()
    .toLowerCase();

if (!email.includes("@")) {
  fail(
    "ADMIN_EMAIL does not appear to be a valid email."
  );
}

try {
  console.log(
    `\nLooking for Firebase user: ${email}`
  );

  const user =
    await admin
      .auth()
      .getUserByEmail(email);

  console.log(
    `Firebase user found: ${user.uid}`
  );

  /* -----------------------------------------------------
     Preserve existing claims
  ----------------------------------------------------- */

  const existingClaims =
    user.customClaims || {};

  /* -----------------------------------------------------
     Add admin claim
  ----------------------------------------------------- */

  await admin
    .auth()
    .setCustomUserClaims(
      user.uid,
      {
        ...existingClaims,
        admin: true,
      }
    );

  console.log(
    "\n✅ ADMIN ACCESS ENABLED"
  );

  console.log(
    `Email: ${email}`
  );

  console.log(
    `UID: ${user.uid}`
  );

  console.log(
    "\nCustom claim:"
  );

  console.log(
    JSON.stringify(
      {
        admin: true,
      },
      null,
      2
    )
  );

  console.log(
    "\nIMPORTANT:"
  );

  console.log(
    "The user must sign out and sign in again,"
  );

  console.log(
    "or refresh their Firebase ID token,"
  );

  console.log(
    "before the new admin claim is available."
  );

  console.log(
    "\nThe Swad admin dashboard can now verify"
  );

  console.log(
    "this account through the backend."
  );

  console.log("");

  process.exit(0);

} catch (error) {

  if (
    error.code ===
    "auth/user-not-found"
  ) {
    fail(
      `No Firebase Authentication user exists for ${email}.\n\nCreate the user first in:\nFirebase Console → Authentication → Users`
    );
  }

  fail(
    `Unable to make user admin: ${error.message}`
  );
}
