import admin from "firebase-admin";

const email =
  process.argv[2] || "admin@swad.in";

try {
  const serviceAccountJSON =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  const databaseURL =
    process.env.FIREBASE_DATABASE_URL;

  if (!serviceAccountJSON) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing."
    );
  }

  if (!databaseURL) {
    throw new Error(
      "FIREBASE_DATABASE_URL is missing."
    );
  }

  const serviceAccount =
    JSON.parse(
      serviceAccountJSON
    );

  admin.initializeApp({
    credential:
      admin.credential.cert(
        serviceAccount
      ),
    databaseURL
  });

  const user =
    await admin
      .auth()
      .getUserByEmail(email);

  const existingClaims =
    user.customClaims || {};

  await admin
    .auth()
    .setCustomUserClaims(
      user.uid,
      {
        ...existingClaims,
        admin: true
      }
    );

  console.log("");
  console.log(
    "========================================"
  );
  console.log(
    "       THE SWAD ADMIN CLAIM"
  );
  console.log(
    "========================================"
  );
  console.log(
    `Email: ${user.email}`
  );
  console.log(
    `UID: ${user.uid}`
  );
  console.log(
    "admin: true"
  );
  console.log(
    "========================================"
  );
  console.log(
    "Admin claim successfully assigned."
  );
  console.log("");

  process.exit(0);

} catch (error) {

  console.error("");
  console.error(
    "Failed to assign admin claim:"
  );
  console.error(
    error.message
  );
  console.error("");

  process.exit(1);
}