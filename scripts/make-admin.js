import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

/*
============================================================
THE SWAD
ADMIN CLAIM SETUP
============================================================

Purpose:
Make one Firebase Authentication user an administrator.

This script must NEVER be inside public/.

It runs only in a trusted Node.js environment.

It adds:

{
  admin: true
}

to the Firebase user's custom claims.
============================================================
*/

function fail(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

/* ----------------------------------------------------------
   Read admin email

   ADMIN_EMAIL is intentionally used only when running
   this script. It does not need to be a permanent
   production environment variable.
---------------------------------------------------------- */

const email =
  process.env.ADMIN_EMAIL
    ?.trim()
    .toLowerCase();

if (!email) {
  fail(
    "ADMIN_EMAIL is missing.\n\n" +
    "Example:\n" +
    "ADMIN_EMAIL=your@email.com node scripts/make-admin.js"
  );
}

if (!email.includes("@")) {
  fail(
    "ADMIN_EMAIL does not appear to be valid."
  );
}

/* ----------------------------------------------------------
   Firebase service account
---------------------------------------------------------- */

const serviceAccountJSON =
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!serviceAccountJSON) {
  fail(
    "FIREBASE_SERVICE_ACCOUNT_JSON is missing."
  );
}

let serviceAccount;

try {
  serviceAccount =
    JSON.parse(
      serviceAccountJSON
    );
} catch (error) {
  fail(
    "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON."
  );
}

/* ----------------------------------------------------------
   Initialize Firebase Admin
---------------------------------------------------------- */

try {

  if (!admin.apps.length) {

    admin.initializeApp({
      credential:
        admin.credential.cert(
          serviceAccount
        )
    });

  }

} catch (error) {

  fail(
    `Firebase initialization failed: ${error.message}`
  );

}

/* ----------------------------------------------------------
   Find Firebase Authentication user
---------------------------------------------------------- */

try {

  console.log(
    `\nSearching Firebase Authentication for: ${email}`
  );

  const user =
    await admin
      .auth()
      .getUserByEmail(
        email
      );

  console.log(
    `✓ User found`
  );

  console.log(
    `UID: ${user.uid}`
  );


  /* --------------------------------------------------------
     Preserve existing custom claims
  -------------------------------------------------------- */

  const existingClaims =
    user.customClaims || {};


  /* --------------------------------------------------------
     Add administrator claim
  -------------------------------------------------------- */

  await admin
    .auth()
    .setCustomUserClaims(
      user.uid,
      {
        ...existingClaims,

        admin: true
      }
    );


  /* --------------------------------------------------------
     Success
  -------------------------------------------------------- */

  console.log(
    "\n========================================"
  );

  console.log(
    "       THE SWAD ADMIN ENABLED"
  );

  console.log(
    "========================================"
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
        admin: true
      },
      null,
      2
    )
  );

  console.log(
    "\n✓ Admin access has been assigned."
  );

  console.log(
    "\nIMPORTANT:"
  );

  console.log(
    "Sign out and sign in again in the Admin Dashboard."
  );

  console.log(
    "This refreshes the Firebase ID token and loads the new claim."
  );

  console.log(
    "========================================\n"
  );

  process.exit(0);

} catch (error) {

  if (
    error.code ===
    "auth/user-not-found"
  ) {

    fail(
      `Firebase Authentication user not found: ${email}\n\n` +
      "Create this user first in:\n" +
      "Firebase Console → Authentication → Users"
    );

  }

  fail(
    `Unable to assign admin access: ${error.message}`
  );

}